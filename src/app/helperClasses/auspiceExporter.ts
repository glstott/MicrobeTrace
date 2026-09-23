import {
  canonicalSplitKey,
  formatBootstrapSupportLabel,
  parseBootstrapSupportPercent,
} from '@app/workers/phylogenetic-bootstrap-utils';

export type AuspiceScalar = string | number | boolean;
export type AuspiceColoringType = 'boolean' | 'continuous' | 'temporal' | 'categorical';
export type AuspiceTreeScope = 'full' | 'visible';

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

export interface AuspiceGeographyField {
  key: string;
  title: string;
  field: string;
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
  fullTree?: AuspiceSourceTreeNode;
  attributeTree?: AuspiceSourceTreeNode;
  nodes?: any[];
  nodeFields?: string[];
  metadataFieldKeys?: string[];
  coloringFieldKeys?: string[];
  filterFieldKeys?: string[];
  treeScope?: AuspiceTreeScope;
  title?: string;
  updated?: Date | string;
  colorBy?: string;
  temporalFields?: string[];
  latitudeField?: string;
  longitudeField?: string;
  geographyFields?: AuspiceGeographyField[];
  bootstrap?: AuspiceBootstrapMetadata | null;
}

interface ExportField {
  sourceKey: string;
  auspiceKey: string;
  coloring: AuspiceColoring;
}

interface BuiltGeography {
  resolutions: AuspiceGeoResolution[];
  traitsByLeaf: Map<string, Map<string, string>>;
  defaultResolutionKey?: string;
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
  'length',
  'depth',
  'height',
  'parent',
  'children',
  '_guid',
  'representing',
  'respresenting',
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
  const nodeByName = indexNodesByName(nodes);
  const exportTree = resolveExportTree(options);
  const leafNames = collectLeafNamesAndValidate(exportTree);
  const attributeTree = options.attributeTree ?? options.fullTree;
  const attributeNodes = [
    ...nodes,
    ...collectTreeAttributeNodes(exportTree),
    ...collectTreeAttributeNodes(attributeTree),
  ];
  const availableExportFields = buildExportFields(options, attributeNodes);
  const exportFields = selectExportFields(availableExportFields, options.metadataFieldKeys);
  const geography = buildGeography(options, leafNames, nodeByName);
  const usedNames = new Set(leafNames);
  const attributeDataByClade = indexTreeDataByDescendantLeaves(attributeTree);
  const exportCladeKeyByNode = indexDescendantLeafKeys(exportTree);
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
    const attributeData = attributeDataByClade.get(exportCladeKeyByNode.get(source) ?? '');

    exportFields.forEach(field => {
      const rawValue = getNodeAttributeValue(source, sessionNode, attributeData, field.sourceKey);
      if (isExportableScalar(rawValue)) {
        nodeAttrs[field.auspiceKey] = { value: rawValue };
      }
    });

    if (isLeaf) {
      geography.traitsByLeaf.get(name)?.forEach((value, key) => {
        nodeAttrs[key] = { value };
      });
    }

    const labels: Record<string, string> = Object.create(null);
    if (!isLeaf) {
      const sourceLabel = String(source.id ?? '').trim();
      const attributeLabel = String(attributeData?._id ?? attributeData?.id ?? '').trim();
      const originalLabel = sourceLabel || attributeLabel;
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

  const tree = convertTree(exportTree, 0, true);
  const selectedColoringKeys = normalizeSelectedKeys(options.coloringFieldKeys);
  const colorings = exportFields
    .filter(field => selectedColoringKeys === null || selectedColoringKeys.has(field.auspiceKey))
    .map(field => field.coloring);
  const geoResolutions = geography.resolutions;
  geoResolutions.forEach(resolution => {
    if ((selectedColoringKeys === null || selectedColoringKeys.has(resolution.key))
        && !colorings.some(coloring => coloring.key === resolution.key)) {
      colorings.push({
        key: resolution.key,
        title: resolution.title || resolution.key,
        type: 'categorical',
      });
    }
  });

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
  if (geography.defaultResolutionKey) {
    displayDefaults.geo_resolution = geography.defaultResolutionKey;
  }

  const meta: AuspiceMeta = {
    title: String(options.title ?? '').trim() || DEFAULT_TITLE,
    updated: formatUpdatedDate(options.updated),
    panels: geoResolutions.length ? ['tree', 'map'] : ['tree'],
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
  geoResolutions.forEach(resolution => {
    if (selectedFilterKeys.has(resolution.key) && !filters.includes(resolution.key)) {
      filters.push(resolution.key);
    }
  });
  if (filters.length) {
    meta.filters = filters;
  }
  if (geoResolutions.length) {
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
  const exportTree = resolveExportTree(options);
  const attributeNodes = [
    ...nodes,
    ...collectTreeAttributeNodes(exportTree),
    ...collectTreeAttributeNodes(options.attributeTree ?? options.fullTree),
  ];
  const fields: AuspiceExportFieldOption[] = buildExportFields(options, attributeNodes)
    .map(field => ({ ...field.coloring }));

  if (options.tree) {
    const nodeByName = indexNodesByName(nodes);
    const leafNames = collectLeafNamesAndValidate(exportTree);
    const existingKeys = new Set(fields.map(field => field.key));
    buildGeography(options, leafNames, nodeByName).resolutions.forEach(resolution => {
      if (existingKeys.has(resolution.key)) return;
      existingKeys.add(resolution.key);
      fields.push({
        key: resolution.key,
        title: resolution.title || resolution.key,
        type: 'categorical',
        synthetic: true,
      });
    });
  }

  return fields;
}

function resolveExportTree(options: AuspiceExportOptions): AuspiceSourceTreeNode {
  if (options.treeScope === 'full' && options.fullTree) return options.fullTree;
  return options.tree;
}

function getTreeNodeData(source: AuspiceSourceTreeNode): Record<string, any> | null {
  const data = source?.data;
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
}

function collectTreeAttributeNodes(tree: AuspiceSourceTreeNode | undefined): any[] {
  if (!tree) return [];
  const attributeNodes: any[] = [];
  const visit = (node: AuspiceSourceTreeNode): void => {
    const data = getTreeNodeData(node);
    if (data) attributeNodes.push(data);
    (Array.isArray(node.children) ? node.children : []).forEach(visit);
  };
  visit(tree);
  return attributeNodes;
}

function getNodeAttributeValue(
  source: AuspiceSourceTreeNode,
  sessionNode: any,
  attributeData: Record<string, any> | undefined,
  field: string,
): unknown {
  if (sessionNode && Object.prototype.hasOwnProperty.call(sessionNode, field)) {
    return sessionNode[field];
  }
  const sourceData = getTreeNodeData(source);
  if (sourceData && Object.prototype.hasOwnProperty.call(sourceData, field)) {
    return sourceData[field];
  }
  return attributeData && Object.prototype.hasOwnProperty.call(attributeData, field)
    ? attributeData[field]
    : undefined;
}

function indexDescendantLeafKeys(
  tree: AuspiceSourceTreeNode | undefined,
): Map<AuspiceSourceTreeNode, string> {
  const keys = new Map<AuspiceSourceTreeNode, string>();
  if (!tree) return keys;

  const visit = (node: AuspiceSourceTreeNode): string[] => {
    const children = Array.isArray(node.children) ? node.children : [];
    const leaves = children.length
      ? children.flatMap(visit)
      : [String(node.id ?? '')];
    keys.set(node, createLeafSetKey(leaves));
    return leaves;
  };
  visit(tree);
  return keys;
}

function indexTreeDataByDescendantLeaves(
  tree: AuspiceSourceTreeNode | undefined,
): Map<string, Record<string, any>> {
  const result = new Map<string, Record<string, any>>();
  const ambiguousKeys = new Set<string>();
  if (!tree) return result;

  const keys = indexDescendantLeafKeys(tree);
  const visit = (node: AuspiceSourceTreeNode): void => {
    const key = keys.get(node) ?? '';
    const data = getTreeNodeData(node);
    if (key && data && !ambiguousKeys.has(key)) {
      if (result.has(key)) {
        result.delete(key);
        ambiguousKeys.add(key);
      } else {
        result.set(key, data);
      }
    }
    (Array.isArray(node.children) ? node.children : []).forEach(visit);
  };
  visit(tree);
  return result;
}

function createLeafSetKey(leafNames: string[]): string {
  return [...leafNames]
    .sort()
    .map(name => `${name.length}:${name}`)
    .join('|');
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

function buildGeography(
  options: AuspiceExportOptions,
  leafNames: string[],
  nodeByName: Map<string, any>,
): BuiltGeography {
  const coordinateByLeaf = buildCoordinateIndex(options, leafNames, nodeByName);
  const traitsByLeaf = new Map<string, Map<string, string>>();
  if (!coordinateByLeaf.size) return { resolutions: [], traitsByLeaf };

  const geographyFields = normalizeGeographyFields(options.geographyFields);
  const siteField = geographyFields.find(definition => definition.key === 'site');
  const namedFields = geographyFields.filter(definition => definition.key !== 'site');
  const resolutions: AuspiceGeoResolution[] = [];

  namedFields.forEach(definition => {
    const groups = new Map<string, { coordinates: AuspiceGeoCoordinates[]; leaves: string[] }>();
    coordinateByLeaf.forEach((coordinates, leafName) => {
      const deme = readDemeName(nodeByName.get(leafName)?.[definition.field]);
      if (!deme) return;
      const group = groups.get(deme) || { coordinates: [], leaves: [] };
      group.coordinates.push(coordinates);
      group.leaves.push(leafName);
      groups.set(deme, group);
    });
    if (!groups.size) return;

    const demes: Record<string, AuspiceGeoCoordinates> = Object.create(null);
    Array.from(groups.keys()).sort((left, right) => left.localeCompare(right)).forEach(deme => {
      const group = groups.get(deme)!;
      demes[deme] = geographicCentroid(group.coordinates);
      group.leaves.forEach(leafName => setGeographyTrait(
        traitsByLeaf,
        leafName,
        definition.key,
        deme,
      ));
    });
    resolutions.push({ key: definition.key, title: definition.title, demes });
  });

  const coordinateGroups = new Map<string, {
    coordinates: AuspiceGeoCoordinates;
    leaves: string[];
    namesByPriority: Array<Set<string>>;
  }>();
  const pointNameFields = [
    ...(siteField ? [siteField] : []),
    ...[...namedFields].reverse(),
  ];
  coordinateByLeaf.forEach((coordinates, leafName) => {
    const coordinateKey = createCoordinateKey(coordinates);
    const group = coordinateGroups.get(coordinateKey) || {
      coordinates,
      leaves: [],
      namesByPriority: pointNameFields.map(() => new Set<string>()),
    };
    group.leaves.push(leafName);
    const node = nodeByName.get(leafName);
    pointNameFields.some((definition, priority) => {
      const candidate = readDemeName(node?.[definition.field]);
      if (!candidate) return false;
      group.namesByPriority[priority].add(candidate);
      return true;
    });
    coordinateGroups.set(coordinateKey, group);
  });

  const pointKey = siteField ? 'site' : SYNTHETIC_LOCATION_KEY;
  const pointTitle = siteField?.title || 'MicrobeTrace location';
  const pointDemes: Record<string, AuspiceGeoCoordinates> = Object.create(null);
  const usedDemeNames = new Set<string>();
  Array.from(coordinateGroups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([, group], index) => {
      const preferredNames = group.namesByPriority.find(names => names.size > 0);
      const preferredName = Array.from(preferredNames || [])
        .sort((left, right) => left.localeCompare(right))[0];
      const fallbackName = `${siteField ? 'Site' : 'Location'} ${index + 1}`;
      const deme = allocateDemeName(preferredName || fallbackName, usedDemeNames);
      pointDemes[deme] = group.coordinates;
      group.leaves.forEach(leafName => setGeographyTrait(
        traitsByLeaf,
        leafName,
        pointKey,
        deme,
      ));
    });
  resolutions.push({ key: pointKey, title: pointTitle, demes: pointDemes });

  return {
    resolutions,
    traitsByLeaf,
    defaultResolutionKey: pointKey,
  };
}

function normalizeGeographyFields(
  fields: AuspiceGeographyField[] | undefined,
): AuspiceGeographyField[] {
  const normalized: AuspiceGeographyField[] = [];
  const usedKeys = new Set<string>();
  const usedFields = new Set<string>();
  (Array.isArray(fields) ? fields : []).forEach(definition => {
    const field = String(definition?.field ?? '').trim();
    const key = String(definition?.key ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!field || field.toLowerCase() === 'none' || !key || key === 'div'
        || usedKeys.has(key) || usedFields.has(field.toLowerCase())) {
      return;
    }
    usedKeys.add(key);
    usedFields.add(field.toLowerCase());
    normalized.push({
      key,
      title: String(definition?.title ?? '').trim() || key,
      field,
    });
  });
  return normalized;
}

function readDemeName(value: unknown): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.toLowerCase() !== 'none' ? name : null;
}

function setGeographyTrait(
  traitsByLeaf: Map<string, Map<string, string>>,
  leafName: string,
  key: string,
  value: string,
): void {
  const traits = traitsByLeaf.get(leafName) || new Map<string, string>();
  traits.set(key, value);
  traitsByLeaf.set(leafName, traits);
}

function createCoordinateKey(coordinates: AuspiceGeoCoordinates): string {
  const latitude = Object.is(coordinates.latitude, -0) ? 0 : coordinates.latitude;
  const longitude = Object.is(coordinates.longitude, -0) ? 0 : coordinates.longitude;
  return `${latitude}|${longitude}`;
}

function allocateDemeName(preferredName: string, usedNames: Set<string>): string {
  let candidate = preferredName;
  let suffix = 2;
  while (usedNames.has(candidate)) candidate = `${preferredName} (${suffix++})`;
  usedNames.add(candidate);
  return candidate;
}

function geographicCentroid(coordinates: AuspiceGeoCoordinates[]): AuspiceGeoCoordinates {
  if (coordinates.length === 1) return { ...coordinates[0] };
  let x = 0;
  let y = 0;
  let z = 0;
  coordinates.forEach(coordinate => {
    const latitude = coordinate.latitude * Math.PI / 180;
    const longitude = coordinate.longitude * Math.PI / 180;
    const latitudeCosine = Math.cos(latitude);
    x += latitudeCosine * Math.cos(longitude);
    y += latitudeCosine * Math.sin(longitude);
    z += Math.sin(latitude);
  });
  const horizontal = Math.sqrt(x * x + y * y);
  if (horizontal < 1e-12 && Math.abs(z) < 1e-12) {
    return {
      latitude: roundCoordinate(coordinates.reduce((sum, value) => sum + value.latitude, 0) / coordinates.length),
      longitude: roundCoordinate(coordinates.reduce((sum, value) => sum + value.longitude, 0) / coordinates.length),
    };
  }
  return {
    latitude: roundCoordinate(Math.atan2(z, horizontal) * 180 / Math.PI),
    longitude: roundCoordinate(Math.atan2(y, x) * 180 / Math.PI),
  };
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(8));
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
