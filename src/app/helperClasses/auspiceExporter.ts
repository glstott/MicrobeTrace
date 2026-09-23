import {
  canonicalSplitKey,
  formatBootstrapSupportLabel,
  parseBootstrapSupportPercent,
} from '@app/workers/phylogenetic-bootstrap-utils';

export type AuspiceScalar = string | number | boolean;
export type AuspiceColoringType = 'boolean' | 'continuous' | 'temporal' | 'categorical';

export interface AuspiceNodeAttribute {
  value: AuspiceScalar;
}

export interface AuspiceColoring {
  key: string;
  title: string;
  type: AuspiceColoringType;
}

export interface AuspiceExportFieldOption extends AuspiceColoring {
  synthetic?: boolean;
}

export interface AuspiceGeoCoordinates {
  latitude: number;
  longitude: number;
}

export interface AuspiceGeoResolution {
  key: string;
  title?: string;
  demes: Record<string, AuspiceGeoCoordinates>;
}

export interface AuspiceTreeNode {
  name: string;
  node_attrs: Record<string, number | AuspiceNodeAttribute>;
  branch_attrs?: {
    labels?: Record<string, string>;
  };
  children?: AuspiceTreeNode[];
}

export interface AuspiceMeta {
  title: string;
  updated: string;
  panels: Array<'tree' | 'map'>;
  colorings?: AuspiceColoring[];
  filters?: string[];
  geo_resolutions?: AuspiceGeoResolution[];
  display_defaults: {
    distance_measure: 'div';
    color_by?: string;
    geo_resolution?: string;
    branch_label?: string;
  };
}

export interface AuspiceV2Dataset {
  version: 'v2';
  meta: AuspiceMeta;
  tree: AuspiceTreeNode;
}

export interface AuspiceSourceTreeNode {
  id?: unknown;
  length?: unknown;
  children?: AuspiceSourceTreeNode[];
  [key: string]: any;
}

export interface AuspiceBootstrapMetadata {
  supportBySplitKey?: Record<string, number>;
  labels?: string[];
  decimalLength?: number;
}

export interface AuspiceExportOptions {
  tree: AuspiceSourceTreeNode;
  nodes?: any[];
  nodeFields?: string[];
  metadataFieldKeys?: string[];
  coloringFieldKeys?: string[];
  filterFieldKeys?: string[];
  title?: string;
  updated?: Date | string;
  colorBy?: string;
  temporalFields?: string[];
  latitudeField?: string;
  longitudeField?: string;
  bootstrap?: AuspiceBootstrapMetadata | null;
}

interface ExportField {
  sourceKey: string;
  auspiceKey: string;
  coloring: AuspiceColoring;
}

const SYNTHETIC_LOCATION_KEY = 'microbetrace_location';
const DEFAULT_TITLE = 'MicrobeTrace Auspice export';
const INTERNAL_NODE_PREFIX = 'NODE_';
const ISO_DATE_PATTERN = /^\d{4}-(?:(?:0[1-9]|1[0-2])|XX)-(?:(?:0[1-9]|[12]\d|3[01])|XX)$/i;

const EXCLUDED_FIELD_KEYS = new Set([
  'seq',
  'sequence',
  '_seq',
  '_seqint',
  '_cigar',
  '_diff',
  '_ambiguity',
  'mutations',
  'data',
  'x',
  'y',
  'vx',
  'vy',
  'fx',
  'fy',
  'foci',
  'index',
  'hasdistance',
  'nodesize',
  '_j',
  '_theta',
  '_jlat',
  '_jlon',
]);

const RESERVED_AUSPICE_KEYS = new Set([
  'div',
  'num_date',
  'vaccine',
  'hidden',
  'url',
  'author',
  'accession',
  'none',
  SYNTHETIC_LOCATION_KEY,
]);

const PROTOTYPE_SENSITIVE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export class AuspiceExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuspiceExportError';
  }
}

export function ensureAuspiceJsonFilename(value: unknown, fallback = 'microbetrace-auspice.json'): string {
  const trimmed = String(value ?? '').trim();
  const resolved = trimmed || fallback;
  return resolved.toLowerCase().endsWith('.json') ? resolved : `${resolved}.json`;
}

export function buildAuspiceV2Dataset(options: AuspiceExportOptions): AuspiceV2Dataset {
  if (!options?.tree) {
    throw new AuspiceExportError('A phylogenetic tree is required for Auspice export.');
  }

  const nodes = Array.isArray(options.nodes) ? options.nodes : [];
  const leafNames = collectLeafNamesAndValidate(options.tree);
  const nodeByName = indexNodesByName(nodes);
  const availableExportFields = buildExportFields(options, nodes);
  const exportFields = selectExportFields(availableExportFields, options.metadataFieldKeys);
  const coordinateByLeaf = buildCoordinateIndex(options, leafNames, nodeByName);
  const usedNames = new Set(leafNames);
  const bootstrapUniverse = options.bootstrap?.labels?.length
    ? options.bootstrap.labels.map(value => String(value))
    : leafNames;
  let nextInternalNodeId = 0;
  let exportedBootstrapLabel = false;

  const nextInternalName = (): string => {
    let candidate: string;
    do {
      candidate = `${INTERNAL_NODE_PREFIX}${String(nextInternalNodeId++).padStart(7, '0')}`;
    } while (usedNames.has(candidate));
    usedNames.add(candidate);
    return candidate;
  };

  const convertTree = (
    source: AuspiceSourceTreeNode,
    parentDivergence: number,
    isRoot: boolean,
  ): AuspiceTreeNode => {
    const children = Array.isArray(source.children) ? source.children : [];
    const branchLength = readBranchLength(source.length, isRoot);
    const divergence = isRoot ? 0 : parentDivergence + branchLength;
    const isLeaf = children.length === 0;
    const name = isLeaf ? String(source.id ?? '') : nextInternalName();
    const nodeAttrs: Record<string, number | AuspiceNodeAttribute> = Object.create(null);
    nodeAttrs.div = divergence;
    const sourceName = String(source.id ?? '');
    const sessionNode = sourceName.trim() ? nodeByName.get(sourceName) : undefined;

    exportFields.forEach(field => {
      const rawValue = sessionNode?.[field.sourceKey];
      if (isExportableScalar(rawValue)) {
        nodeAttrs[field.auspiceKey] = { value: rawValue };
      }
    });

    if (isLeaf) {
      if (coordinateByLeaf.has(name)) {
        nodeAttrs[SYNTHETIC_LOCATION_KEY] = { value: name };
      }
    }

    const labels: Record<string, string> = Object.create(null);
    if (!isLeaf) {
      const originalLabel = String(source.id ?? '').trim();
      const support = getBootstrapSupport(source, options.bootstrap, bootstrapUniverse, isRoot);
      if (support !== null) {
        labels.bootstrap = formatBootstrapSupportLabel(
          support,
          options.bootstrap?.decimalLength ?? 1,
        );
        exportedBootstrapLabel = true;
      }
      if (originalLabel && !(support !== null && parseBootstrapSupportPercent(originalLabel) !== null)) {
        labels.microbetrace = originalLabel;
      }
    }

    const output: AuspiceTreeNode = {
      name,
      node_attrs: nodeAttrs,
    };

    if (Object.keys(labels).length) {
      output.branch_attrs = { labels };
    }
    if (children.length) {
      // Auspice lays out sibling branches by traversing its serialized child
      // arrays in reverse. Serialize the current MicrobeTrace order in reverse
      // so rotations and flips retain their visible orientation in Auspice.
      output.children = children
        .map(child => convertTree(child, divergence, false))
        .reverse();
    }

    return output;
  };

  const tree = convertTree(options.tree, 0, true);
  const selectedColoringKeys = normalizeSelectedKeys(options.coloringFieldKeys);
  const colorings = exportFields
    .filter(field => selectedColoringKeys === null || selectedColoringKeys.has(field.auspiceKey))
    .map(field => field.coloring);
  let geoResolutions: AuspiceGeoResolution[] | undefined;

  if (coordinateByLeaf.size) {
    const demes: Record<string, AuspiceGeoCoordinates> = Object.create(null);
    coordinateByLeaf.forEach((coordinates, leafName) => {
      demes[leafName] = coordinates;
    });
    geoResolutions = [{
      key: SYNTHETIC_LOCATION_KEY,
      title: 'MicrobeTrace location',
      demes,
    }];
    if (selectedColoringKeys === null || selectedColoringKeys.has(SYNTHETIC_LOCATION_KEY)) {
      colorings.push({
        key: SYNTHETIC_LOCATION_KEY,
        title: 'MicrobeTrace location',
        type: 'categorical',
      });
    }
  }

  const fieldBySource = new Map(exportFields.map(field => [field.sourceKey, field]));
  const selectedColoring = fieldBySource.get(String(options.colorBy ?? ''));
  const displayDefaults: AuspiceMeta['display_defaults'] = {
    distance_measure: 'div',
  };
  if (selectedColoring && colorings.some(coloring => coloring.key === selectedColoring.auspiceKey)) {
    displayDefaults.color_by = selectedColoring.auspiceKey;
  }
  if (exportedBootstrapLabel) {
    displayDefaults.branch_label = 'bootstrap';
  }
  if (geoResolutions) {
    displayDefaults.geo_resolution = SYNTHETIC_LOCATION_KEY;
  }

  const meta: AuspiceMeta = {
    title: String(options.title ?? '').trim() || DEFAULT_TITLE,
    updated: formatUpdatedDate(options.updated),
    panels: coordinateByLeaf.size ? ['tree', 'map'] : ['tree'],
    display_defaults: displayDefaults,
  };
  if (colorings.length) {
    meta.colorings = colorings;
  }
  const selectedFilterKeys = normalizeSelectedKeys(options.filterFieldKeys)
    ?? new Set(colorings.map(coloring => coloring.key));
  const filters = exportFields
    .map(field => field.auspiceKey)
    .filter(key => selectedFilterKeys.has(key));
  if (coordinateByLeaf.size && selectedFilterKeys.has(SYNTHETIC_LOCATION_KEY)) {
    filters.push(SYNTHETIC_LOCATION_KEY);
  }
  if (filters.length) {
    meta.filters = filters;
  }
  if (geoResolutions) {
    meta.geo_resolutions = geoResolutions;
  }

  return {
    version: 'v2',
    meta,
    tree,
  };
}

export function getAuspiceExportFieldOptions(
  options: AuspiceExportOptions,
): AuspiceExportFieldOption[] {
  const nodes = Array.isArray(options.nodes) ? options.nodes : [];
  const fields: AuspiceExportFieldOption[] = buildExportFields(options, nodes)
    .map(field => ({ ...field.coloring }));

  if (options.tree) {
    const leafNames = collectLeafNamesAndValidate(options.tree);
    const nodeByName = indexNodesByName(nodes);
    if (buildCoordinateIndex(options, leafNames, nodeByName).size) {
      fields.push({
        key: SYNTHETIC_LOCATION_KEY,
        title: 'MicrobeTrace location',
        type: 'categorical',
        synthetic: true,
      });
    }
  }

  return fields;
}

function collectLeafNamesAndValidate(root: AuspiceSourceTreeNode): string[] {
  const leafNames: string[] = [];
  const seen = new Set<string>();

  const visit = (node: AuspiceSourceTreeNode): void => {
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length) {
      children.forEach(visit);
      return;
    }

    const name = String(node.id ?? '');
    if (!name.trim()) {
      throw new AuspiceExportError('Every exported tree tip must have a non-empty sample ID.');
    }
    if (seen.has(name)) {
      throw new AuspiceExportError(`The tree contains the duplicate sample ID "${name}".`);
    }
    seen.add(name);
    leafNames.push(name);
  };

  visit(root);
  if (!leafNames.length) {
    throw new AuspiceExportError('The current phylogenetic tree has no tips to export.');
  }
  return leafNames;
}

function indexNodesByName(nodes: any[]): Map<string, any> {
  const index = new Map<string, any>();
  const ambiguousNames = new Set<string>();
  nodes.forEach(node => {
    const nodeNames = new Set([node?._id, node?.id]);
    nodeNames.forEach(value => {
      if (value === undefined || value === null) return;
      const key = String(value);
      if (!key.trim() || ambiguousNames.has(key)) return;
      const existingNode = index.get(key);
      if (existingNode && existingNode !== node) {
        index.delete(key);
        ambiguousNames.add(key);
        return;
      }
      index.set(key, node);
    });
  });
  return index;
}

function buildExportFields(options: AuspiceExportOptions, nodes: any[]): ExportField[] {
  const sourceFields: string[] = [];
  const seenSourceFields = new Set<string>();
  const addSourceField = (value: unknown): void => {
    if (typeof value !== 'string' || !value.trim() || seenSourceFields.has(value)) return;
    seenSourceFields.add(value);
    sourceFields.push(value);
  };

  (options.nodeFields || []).forEach(addSourceField);
  nodes.forEach(node => Object.keys(node || {}).forEach(addSourceField));

  const temporalFields = new Set((options.temporalFields || []).map(field => String(field).toLowerCase()));
  const usedAuspiceKeys = new Set(['div', SYNTHETIC_LOCATION_KEY]);

  return sourceFields.flatMap(sourceKey => {
    if (EXCLUDED_FIELD_KEYS.has(sourceKey.toLowerCase())) return [];
    const values = nodes
      .map(node => node?.[sourceKey])
      .filter(isExportableScalar);
    if (!values.length) return [];

    const auspiceKey = allocateAuspiceKey(sourceKey, usedAuspiceKeys);
    return [{
      sourceKey,
      auspiceKey,
      coloring: {
        key: auspiceKey,
        title: sourceKey,
        type: inferColoringType(values, temporalFields.has(sourceKey.toLowerCase())),
      },
    }];
  });
}

function selectExportFields(fields: ExportField[], selectedKeys?: string[]): ExportField[] {
  const selected = normalizeSelectedKeys(selectedKeys);
  return selected === null
    ? fields
    : fields.filter(field => selected.has(field.auspiceKey));
}

function normalizeSelectedKeys(keys?: string[]): Set<string> | null {
  if (!Array.isArray(keys)) return null;
  return new Set(keys.map(key => String(key)));
}

function allocateAuspiceKey(sourceKey: string, usedKeys: Set<string>): string {
  const trimmed = sourceKey.trim();
  const lower = trimmed.toLowerCase();
  const safeAsIs = /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(trimmed)
    && !RESERVED_AUSPICE_KEYS.has(lower)
    && !PROTOTYPE_SENSITIVE_KEYS.has(lower)
    && !usedKeys.has(trimmed);

  if (safeAsIs) {
    usedKeys.add(trimmed);
    return trimmed;
  }

  const slug = lower
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^[_\-.]+|[_\-.]+$/g, '') || 'field';
  const base = `microbetrace_${slug}`;
  let candidate = base;
  let suffix = 2;
  while (usedKeys.has(candidate) || RESERVED_AUSPICE_KEYS.has(candidate.toLowerCase())) {
    candidate = `${base}_${suffix++}`;
  }
  usedKeys.add(candidate);
  return candidate;
}

function isExportableScalar(value: unknown): value is AuspiceScalar {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return typeof value === 'string' && value.trim().length > 0;
}

function inferColoringType(values: AuspiceScalar[], configuredTemporal: boolean): AuspiceColoringType {
  const temporalValues = values.every(value => (
    typeof value === 'number' || (typeof value === 'string' && ISO_DATE_PATTERN.test(value.trim()))
  ));
  if ((configuredTemporal || values.every(value => typeof value === 'string' && ISO_DATE_PATTERN.test(value.trim())))
      && temporalValues) {
    return 'temporal';
  }
  if (values.every(value => typeof value === 'boolean')) return 'boolean';
  if (values.every(value => typeof value === 'number')) return 'continuous';
  return 'categorical';
}

function buildCoordinateIndex(
  options: AuspiceExportOptions,
  leafNames: string[],
  nodeByName: Map<string, any>,
): Map<string, AuspiceGeoCoordinates> {
  const coordinates = new Map<string, AuspiceGeoCoordinates>();
  leafNames.forEach(leafName => {
    const node = nodeByName.get(leafName);
    const resolved = resolveCoordinates(node, options.latitudeField, options.longitudeField);
    if (resolved) coordinates.set(leafName, resolved);
  });
  return coordinates;
}

function resolveCoordinates(
  node: any,
  latitudeField?: string,
  longitudeField?: string,
): AuspiceGeoCoordinates | null {
  if (!node) return null;
  const candidates: Array<[unknown, unknown]> = [
    [node._lat, node._lon],
    [node.latitude, node.longitude],
  ];
  if (latitudeField && longitudeField && latitudeField !== 'None' && longitudeField !== 'None') {
    candidates.push([node[latitudeField], node[longitudeField]]);
  }

  for (const [latitudeValue, longitudeValue] of candidates) {
    const latitude = parseCoordinate(latitudeValue, 'S');
    const longitude = parseCoordinate(longitudeValue, 'W');
    if (latitude !== null && longitude !== null
        && latitude >= -90 && latitude <= 90
        && longitude >= -180 && longitude <= 180) {
      return { latitude, longitude };
    }
  }
  return null;
}

function parseCoordinate(value: unknown, negativeHemisphere: 'S' | 'W'): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const text = String(value).trim().toUpperCase();
  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed)) return null;
  if (text.includes(negativeHemisphere)) return -Math.abs(parsed);
  if (text.includes(negativeHemisphere === 'S' ? 'N' : 'E')) return Math.abs(parsed);
  return parsed;
}

function getBootstrapSupport(
  node: AuspiceSourceTreeNode,
  bootstrap: AuspiceBootstrapMetadata | null | undefined,
  allLeafIds: string[],
  isRoot: boolean,
): number | null {
  if (isRoot || !bootstrap?.supportBySplitKey) return null;
  const splitKey = canonicalSplitKey(collectLeafNames(node), allLeafIds);
  if (!splitKey || !Object.prototype.hasOwnProperty.call(bootstrap.supportBySplitKey, splitKey)) {
    return null;
  }
  const support = Number(bootstrap.supportBySplitKey[splitKey]);
  return Number.isFinite(support) && support >= 0 && support <= 100 ? support : null;
}

function collectLeafNames(node: AuspiceSourceTreeNode): string[] {
  const children = Array.isArray(node.children) ? node.children : [];
  if (!children.length) return [String(node.id ?? '')];
  return children.flatMap(collectLeafNames);
}

function readBranchLength(value: unknown, isRoot: boolean): number {
  if (value === undefined || value === null || value === '') return 0;
  const branchLength = Number(value);
  if (!Number.isFinite(branchLength)) {
    throw new AuspiceExportError('The current tree contains a non-finite branch length.');
  }
  if (branchLength < 0) {
    throw new AuspiceExportError('The current tree contains a negative branch length.');
  }
  return isRoot ? 0 : branchLength;
}

function formatUpdatedDate(value?: Date | string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}
