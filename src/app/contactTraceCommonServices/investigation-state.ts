import { isActiveNetworkSubsetRule, networkSubsetValueMatches } from './network-subset-rule';

/** The portable investigation contract. Runtime renderers and workers never belong here. */
export type CalculationScope = 'full' | 'visible' | 'cohort';
export const INVESTIGATION_OPERATIONS = [
  { id: 'network-statistics', label: 'Network statistics', scope: 'visible' },
  { id: 'threshold-analysis', label: 'Threshold analysis', scope: 'full' },
  { id: 'mst', label: 'Minimum spanning tree', scope: 'full' },
  { id: 'nearest-neighbor', label: 'Nearest neighbors', scope: 'full' },
  { id: 'directionality', label: 'Directionality', scope: 'full' },
  { id: 'alignment', label: 'Sequence alignment', scope: 'full' },
  { id: 'ambiguity', label: 'Sequence ambiguity', scope: 'full' },
  { id: 'consensus', label: 'Consensus sequence', scope: 'full' },
  { id: 'consensus-distances', label: 'Consensus distances', scope: 'full' },
  { id: 'pairwise-distances', label: 'Genetic distances', scope: 'full' },
  { id: 'distance-matrix', label: 'Distance matrix', scope: 'full' },
  { id: 'tree', label: 'Tree inference', scope: 'full' },
  { id: 'patristic', label: 'Patristic distances', scope: 'full' },
  { id: 'bootstrap', label: 'Bootstrap support', scope: 'full' },
] as const;
export type InvestigationOperation = typeof INVESTIGATION_OPERATIONS[number]['id'];

export interface InvestigationCohort {
  id: string;
  name: string;
  nodeIds: string[];
}
export interface InvestigationLayer {
  id: string;
  source: string;
  name: string;
  enabled: boolean;
  color?: string;
  opacity?: number;
}
export interface InvestigationAnnotation {
  id: string;
  target: { type: 'investigation' | 'node' | 'edge' | 'cohort'; id?: string };
  text: string;
  createdAt: string;
  updatedAt: string;
}
export interface InvestigationSoftware {
  name: 'MicrobeTrace';
  version: string;
  commit: string;
  buildDate: string;
}
export interface InvestigationCalculation {
  id: string;
  operation: InvestigationOperation;
  scope: CalculationScope;
  cohortIds: string[];
  nodeIds: string[];
  edgeIds: string[];
  parameters: Record<string, any>;
  inputs: { nodes: any[]; links: any[]; tree?: string };
  inputChecksum: string;
  /** Fingerprint after applying this run; detects later changes without invalidating its own output. */
  currentInputKey: string;
  startedAt: string;
  completedAt: string;
  software: InvestigationSoftware;
  status: 'completed' | 'stale';
  output: any;
}
export interface InvestigationWorkspace {
  cohorts: InvestigationCohort[];
  selectedCohortIds: string[];
  edgeLayers: InvestigationLayer[];
  annotations: InvestigationAnnotation[];
  scopes: Partial<Record<InvestigationOperation, CalculationScope>>;
  calculations: Partial<Record<InvestigationOperation, InvestigationCalculation>>;
  viewStates: Record<string, any>;
}
export interface InvestigationState extends InvestigationWorkspace {
  threshold: { value: number; metric: string; distanceMetric: string; displayFormat: string; nearestNeighbor: boolean };
  filters: { state: any; exclusions: string[]; minimumClusterSize: number; tables: Record<string, any> };
  layout: {
    tabs: any[]; dashboardLayout?: any; dashboardState?: any; legacyLayout: any;
    camera: any; nodes: Array<{ id: string; x?: number; y?: number; fixed?: boolean; selected: boolean }>;
    widgets: Record<string, any>; network: { allPinned: boolean; timelinePinned: boolean };
  };
  grouping: { widgets: Record<string, any>; groups: Array<{ id: string; label?: string; field?: string; nodeIds: string[] }> };
}
export interface InvestigationManifest {
  schemaVersion: 1 | 2;
  snapshotId: string;
  capturedAt: string;
  stateChecksum: string;
  software: InvestigationSoftware;
  sources: Array<{ name: string; sha256: string; representation: string }>;
  counts: { nodes: number; edges: number; visibleNodes: number; visibleEdges: number };
  investigation: Omit<InvestigationState, 'calculations'> & {
    calculations: Partial<Record<InvestigationOperation, Omit<InvestigationCalculation, 'inputs' | 'output'> & { outputChecksum: string }>>;
  };
  historicalProvenance: 'recorded' | 'not recorded';
}

export function createInvestigationWorkspace(): InvestigationWorkspace {
  return { cohorts: [], selectedCohortIds: [], edgeLayers: [], annotations: [], scopes: {}, calculations: {}, viewStates: {} };
}
export function investigationNodeId(node: any): string {
  return String(node?._id ?? node?.id ?? '');
}
export function investigationEndpointId(endpoint: any): string {
  return endpoint && typeof endpoint === 'object' ? investigationNodeId(endpoint) : String(endpoint ?? '');
}
export function investigationEdgeId(edge: any): string {
  return String(edge?.id ?? JSON.stringify([investigationEndpointId(edge?.source), investigationEndpointId(edge?.target)].sort()));
}
export function investigationOrigins(link: any): string[] {
  const origins = link?._originAll?.length ? link._originAll : link?.origin;
  return Array.from(new Set((Array.isArray(origins) ? origins : [origins]).filter(value => value != null && String(value).length).map(String)));
}
export function investigationScope(workspace: InvestigationWorkspace, operation: InvestigationOperation): CalculationScope {
  return workspace.scopes[operation] ?? INVESTIGATION_OPERATIONS.find(item => item.id === operation)?.scope ?? 'full';
}

/** Copies JSON-compatible data, binary file contents, and dates; omits cycles and live objects. */
export function investigationCopy<T>(value: T): T {
  const ancestors = new Set<object>();
  const copy = (item: any): any => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') return Number.isFinite(item) ? item : null;
    if (typeof item !== 'object') return undefined;
    if (item instanceof Date) return item.toISOString();
    if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) {
      const bytes = item instanceof ArrayBuffer ? new Uint8Array(item) : new Uint8Array(item.buffer, item.byteOffset, item.byteLength);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
      return { __microbetraceBinary: item instanceof ArrayBuffer ? 'ArrayBuffer' : item.constructor.name, base64: btoa(binary) };
    }
    if (typeof Node !== 'undefined' && item instanceof Node) return undefined;
    if (ancestors.has(item)) return undefined;
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) return undefined;
    ancestors.add(item);
    const result: any = Array.isArray(item) ? [] : {};
    for (const key of Object.keys(item)) {
      if (['__proto__', 'constructor', 'prototype', '_seqInt'].includes(key)) continue;
      const next = copy(item[key]);
      if (next !== undefined) result[key] = next;
    }
    ancestors.delete(item);
    return result;
  };
  return copy(value);
}

export function canonicalInvestigationJson(value: any): string {
  const ordered = (item: any): any => {
    if (Array.isArray(item)) return item.map(ordered);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, ordered(item[key])]));
  };
  return JSON.stringify(ordered(investigationCopy(value)));
}

export function reviveInvestigationBinary(value: any): any {
  if (!value || typeof value !== 'object') return value;
  if (typeof value.__microbetraceBinary === 'string' && typeof value.base64 === 'string') {
    const bytes = Uint8Array.from(atob(value.base64), char => char.charCodeAt(0));
    if (value.__microbetraceBinary === 'ArrayBuffer') return bytes.buffer;
    const constructors = { Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array };
    const Constructor = constructors[value.__microbetraceBinary];
    if (!Constructor) throw new Error('The session contains an unsupported binary data type.');
    return new Constructor(bytes.buffer);
  }
  for (const key of Object.keys(value)) value[key] = reviveInvestigationBinary(value[key]);
  return value;
}
export async function investigationChecksum(value: any): Promise<string> {
  const data = new TextEncoder().encode(canonicalInvestigationJson(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
/** A fast change key; the saved cryptographic input digest is calculated separately. */
export function investigationChangeKey(value: any): string {
  const text = canonicalInvestigationJson(value);
  let first = 2166136261;
  let second = 5381;
  for (let i = 0; i < text.length; i++) {
    first = Math.imul(first ^ text.charCodeAt(i), 16777619);
    second = Math.imul(second, 33) ^ text.charCodeAt(i);
  }
  return `${text.length}:${first >>> 0}:${second >>> 0}`;
}

export function enabledInvestigationOrigins(workspace: InvestigationWorkspace, link: any): string[] {
  return investigationOrigins(link).filter(source => workspace.edgeLayers.find(layer => layer.source === source)?.enabled !== false);
}

/** Source eligibility is independent of display filters and never rewrites complete origins. */
export function eligibleInvestigationOrigins(session: any, workspace: InvestigationWorkspace, link: any, sweep = false, unpruned = false): string[] {
  const widgets = session.style?.widgets || {};
  const metric = widgets['link-sort-variable'] || 'distance';
  const value = link[metric];
  const distanceOrigins = Array.isArray(link.distanceOrigins) ? link.distanceOrigins : [link.distanceOrigin].filter(Boolean);
  return enabledInvestigationOrigins(workspace, link).filter(source => {
    if (source === 'Genetic Distance' && metric === 'distance' && link._investigationDistanceMetric
      && link._investigationDistanceMetric !== widgets['default-distance-metric']) return false;
    const distanceBacked = distanceOrigins.includes(source) || /genetic distance|newick|auspice/i.test(source);
    if (!distanceBacked || !link.hasDistance) return true;
    if (value == null || !Number.isFinite(Number(value))) return false;
    if (unpruned || sweep) return true;
    if (Number(value) > Number(widgets['link-threshold'])) return false;
    return !widgets['link-show-nn'] || !!link.nn;
  });
}

export interface ResolvedInvestigationInputs { scope: CalculationScope; cohortIds: string[]; nodes: any[]; links: any[] }
export function investigationDistanceSourceEnabled(session: any, workspace: InvestigationWorkspace, link: any, sweep = false, unpruned = false): boolean {
  if (!link.hasDistance) return false;
  const distanceSources = Array.isArray(link.distanceOrigins) && link.distanceOrigins.length ? link.distanceOrigins
    : link.distanceOrigin ? [link.distanceOrigin] : investigationOrigins(link);
  return eligibleInvestigationOrigins(session, workspace, link, sweep, unpruned).some(source => distanceSources.some(origin => source.includes(origin)));
}

export function resolveInvestigationInputs(session: any, workspace: InvestigationWorkspace, operation: InvestigationOperation,
  options: { sequence?: boolean; sweep?: boolean; unpruned?: boolean; nodes?: any[]; allowEmpty?: boolean } = {}): ResolvedInvestigationInputs {
  const scope = investigationScope(workspace, operation);
  const cohortIds = scope === 'cohort' ? [...workspace.selectedCohortIds] : [];
  const members = new Set<string>();
  for (const id of cohortIds) {
    const cohort = workspace.cohorts.find(item => item.id === id);
    if (!cohort) throw new Error('A selected cohort is unavailable. Choose the calculation scope again.');
    cohort.nodeIds.forEach(nodeId => members.add(nodeId));
  }
  const candidates = options.nodes ?? session.data?.nodes ?? [];
  let nodes = candidates.filter(node => {
    if (scope === 'visible' && node.visible === false) return false;
    if (scope === 'cohort' && !members.has(investigationNodeId(node))) return false;
    return !options.sequence || (typeof node.seq === 'string' && !!node.seq.trim());
  });
  // Distance-based trees historically prefer sequence-bearing taxa when present.
  // Apply that eligibility rule within the chosen population, including hidden cohorts.
  if (operation === 'tree' || operation === 'distance-matrix') {
    const sequenceNodes = nodes.filter(node => typeof node.seq === 'string' && /[acgt]/i.test(node.seq));
    if (sequenceNodes.length) nodes = sequenceNodes;
  }
  if (!nodes.length && !options.allowEmpty) throw new Error(`The ${scope} scope contains no eligible ${options.sequence ? 'sequences' : 'nodes'}.`);
  const ids = new Set(nodes.map(investigationNodeId));
  const links = (session.data?.links || []).filter(link => {
    if (!ids.has(investigationEndpointId(link.source)) || !ids.has(investigationEndpointId(link.target))) return false;
    if (scope === 'visible') {
      // Reintroducing threshold/NN candidates must never undo an explicit link rule.
      const rule = session.state?.networkSubsetFilter?.link;
      if (isActiveNetworkSubsetRule(rule) && !networkSubsetValueMatches(
        rule.field === 'origin' ? investigationOrigins(link) : link[rule.field], rule.operator, rule.value)) return false;
      if (link.visible === false && !options.unpruned && !options.sweep) return false;
    }
    if (operation === 'threshold-analysis' && !investigationDistanceSourceEnabled(session, workspace, link, !!options.sweep)) return false;
    if (operation === 'mst' || operation === 'nearest-neighbor') {
      const metric = session.style?.widgets?.['link-sort-variable'] || 'distance';
      if (!Number.isFinite(link[metric])) return false;
      if (metric === 'distance' && link.hasDistance && !investigationDistanceSourceEnabled(session, workspace, link, false, !!options.unpruned)) return false;
    }
    return !investigationOrigins(link).length || eligibleInvestigationOrigins(session, workspace, link, options.sweep, options.unpruned).length > 0;
  });
  return { scope, cohortIds, nodes, links };
}

export function investigationInputKey(inputs: ResolvedInvestigationInputs, parameters: any): string {
  const operation = parameters?.operation;
  if (operation) {
    const sequence = ['alignment', 'ambiguity', 'consensus', 'consensus-distances', 'pairwise-distances', 'bootstrap'].includes(operation);
    const metric = parameters['link-sort-variable'] || 'distance';
    const nodes = inputs.nodes.map(node => sequence
      ? { id: investigationNodeId(node), seq: node.seq, ambiguity: operation === 'pairwise-distances' ? node._ambiguity : undefined }
      : { id: investigationNodeId(node) });
    const links = sequence ? [] : inputs.links.map(link => ({ id: investigationEdgeId(link),
      source: investigationEndpointId(link.source), target: investigationEndpointId(link.target),
      value: link[metric], origins: [...investigationOrigins(link)].sort(),
      nn: parameters['link-show-nn'] ? !!link.nn : undefined, distanceMetric: link._investigationDistanceMetric }));
    return investigationChangeKey({ scope: inputs.scope, cohortIds: [...inputs.cohortIds].sort(), nodes, links, parameters });
  }
  const transient = new Set(['index', 'x', 'y', 'vx', 'vy', 'fx', 'fy', 'fixed', 'selected', 'visible', 'degree', 'cluster', 'foci', '_ambiguity', '_diff', '_score', '_padding', '_cigar']);
  const clean = (object: any) => Object.fromEntries(Object.entries(object).filter(([key]) => !transient.has(key)));
  return investigationChangeKey({ scope: inputs.scope, cohortIds: inputs.cohortIds, nodes: inputs.nodes.map(clean), links: inputs.links.map(clean), parameters });
}

export function investigationAnnotationResolved(note: InvestigationAnnotation, session: any, workspace: InvestigationWorkspace): boolean {
  if (note.target.type === 'investigation') return true;
  if (note.target.type === 'cohort') return workspace.cohorts.some(cohort => cohort.id === note.target.id);
  const values = note.target.type === 'node' ? session.data.nodes : session.data.links;
  return values.some(value => (note.target.type === 'node' ? investigationNodeId(value) : investigationEdgeId(value)) === note.target.id);
}
