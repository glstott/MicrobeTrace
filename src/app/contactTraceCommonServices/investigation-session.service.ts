import { Injectable } from '@angular/core';
import { buildDate, commitHash, version } from '../../environments/version';
import type { StashObjects } from '../helperClasses/interfaces';
import { buildNetworkGroupingModel } from './network-grouping.model';
import {
  createInvestigationWorkspace, investigationCopy, investigationChecksum, investigationNodeId,
  investigationEdgeId, investigationOrigins, InvestigationManifest, InvestigationSoftware,
  InvestigationState, InvestigationWorkspace, INVESTIGATION_OPERATIONS, reviveInvestigationBinary, canonicalInvestigationJson,
} from './investigation-state';

export const INVESTIGATION_SCHEMA_VERSION = 2;
export function investigationSoftware(): InvestigationSoftware {
  return { name: 'MicrobeTrace', version, commit: commitHash, buildDate };
}

@Injectable({ providedIn: 'root' })
export class InvestigationSessionService {
  workspace(session: any): InvestigationWorkspace {
    if (!session.investigation) session.investigation = createInvestigationWorkspace();
    return session.investigation;
  }

  /** Discovery changes the workspace only when a source first appears. Renaming never changes its identity. */
  syncLayers(session: any): InvestigationWorkspace {
    const workspace = this.workspace(session);
    const known = new Set(workspace.edgeLayers.map(layer => layer.source));
    for (const link of session.data.links) {
      for (const source of investigationOrigins(link)) {
        if (known.has(source)) continue;
        known.add(source);
        workspace.edgeLayers.push({ id: `source:${source}`, source, name: source, enabled: true });
      }
    }
    return workspace;
  }

  async capture(stash: StashObjects): Promise<StashObjects> {
    // Never convert files or serialize Angular/renderer objects in the running investigation.
    const session: any = {};
    for (const key of ['data', 'files', 'state', 'style', 'layout', 'timeline', 'warnings', 'messages']) {
      if (stash.session[key] !== undefined) session[key] = investigationCopy(stash.session[key]);
    }
    session.meta = investigationCopy({
      rendererViewState: stash.session.meta?.rendererViewState,
      anySequences: stash.session.meta?.anySequences,
    });
    session.network = investigationCopy({
      allPinned: !!stash.session.network?.allPinned,
      timelinePinned: !!stash.session.network?.timelinePinned,
    });
    const workspace: InvestigationWorkspace = investigationCopy(stash.session.investigation || createInvestigationWorkspace());
    this.syncLayers({ ...session, investigation: workspace });
    const result: StashObjects = {
      schemaVersion: INVESTIGATION_SCHEMA_VERSION,
      snapshotId: crypto.randomUUID(),
      session,
      tabs: investigationCopy(stash.tabs || []),
      dashboardLayout: investigationCopy(stash.dashboardLayout),
      dashboardState: investigationCopy(stash.dashboardState),
    };
    result.investigation = this.stateFromSession(session, workspace, result);
    // Validate what we will actually write, including all required references.
    this.validate(result);
    const summaries: InvestigationManifest['investigation']['calculations'] = {};
    for (const [operation, calculation] of Object.entries(workspace.calculations)) {
      if (!calculation) continue;
      const { inputs, output, ...summary } = calculation;
      summaries[operation] = { ...summary, outputChecksum: await investigationChecksum(output) };
    }
    const sources = await Promise.all((session.files || []).map(async (file: any) => {
      const contents = file.contents ?? file.content ?? file.data;
      return { name: String(file.name ?? 'Unnamed input'), sha256: contents === undefined ? 'not recorded' : await investigationChecksum(contents), representation: contents === undefined ? 'not recorded' : 'canonical saved content (including binary encoding)' };
    }));
    result.provenance = {
      schemaVersion: INVESTIGATION_SCHEMA_VERSION,
      snapshotId: result.snapshotId,
      capturedAt: new Date().toISOString(),
      stateChecksum: '',
      software: investigationSoftware(),
      sources,
      counts: this.counts(session),
      investigation: investigationCopy({ ...result.investigation, calculations: summaries }),
      historicalProvenance: stash.session.investigationHistoricalProvenance === 'not recorded' ? 'not recorded' : 'recorded',
    };
    result.provenance.stateChecksum = await investigationChecksum(this.checksumPayload(result));
    return result;
  }

  private stateFromSession(session: any, workspace: InvestigationWorkspace, stash: StashObjects): InvestigationState {
    const widgets = session.style.widgets;
    const field = String(widgets['polygons-foci'] || 'None');
    const grouping = buildNetworkGroupingModel(session.data.nodes.map(node => ({ id: investigationNodeId(node),
      values: node, selected: !!node.selected, visible: node.visible !== false })), field === 'None' ? [] : [field]);
    const tables = Object.fromEntries(Object.entries(session.data).filter(([key]) => /Filter$|TableColumns$/.test(key)));
    return {
      ...workspace,
      threshold: {
        value: Number(widgets['link-threshold']), metric: String(widgets['link-sort-variable'] ?? 'distance'),
        distanceMetric: String(widgets['default-distance-metric'] ?? 'snps'),
        displayFormat: String(widgets['tn93-distance-display-format'] ?? 'decimal'),
        nearestNeighbor: !!widgets['link-show-nn'],
      },
      filters: { state: session.state || {}, exclusions: session.data.nodeExclusions || [], minimumClusterSize: Number(widgets['cluster-minimum-size'] ?? 1), tables },
      layout: {
        tabs: stash.tabs, dashboardLayout: stash.dashboardLayout, dashboardState: stash.dashboardState,
        legacyLayout: session.layout, camera: session.meta.rendererViewState || null,
        nodes: session.data.nodes.map(node => ({ id: investigationNodeId(node), x: node.x, y: node.y, fixed: node.fixed, selected: !!node.selected })),
        widgets, network: session.network,
      },
      grouping: {
        widgets: Object.fromEntries(Object.entries(widgets).filter(([key]) => /polygon|group|collapse/.test(key))),
        groups: grouping.groups.map(group => ({ id: group.id, label: group.label, field: group.field, nodeIds: group.memberIds })),
      },
    };
  }

  private checksumPayload(stash: StashObjects): any {
    const state = { schemaVersion: stash.schemaVersion, snapshotId: stash.snapshotId, session: stash.session,
      tabs: stash.tabs, dashboardLayout: stash.dashboardLayout, dashboardState: stash.dashboardState, investigation: stash.investigation };
    // Schema 1 checksummed only state. Schema 2 also binds every provenance field,
    // excluding the checksum itself to avoid a circular digest.
    if (stash.schemaVersion === 2) {
      const { stateChecksum, ...provenance } = stash.provenance;
      return { ...state, provenance };
    }
    return state;
  }

  private counts(session: any): InvestigationManifest['counts'] {
    return {
      nodes: session.data.nodes.length, edges: session.data.links.length,
      visibleNodes: session.data.nodes.filter(node => node.visible !== false).length,
      visibleEdges: session.data.links.filter(link => link.visible !== false).length,
    };
  }

  private validateProvenance(stash: StashObjects): void {
    const manifest = stash.provenance;
    if (!manifest || manifest.snapshotId !== stash.snapshotId || manifest.schemaVersion !== stash.schemaVersion) {
      throw new Error('The investigation manifest is missing or invalid.');
    }
    const software = manifest.software;
    if (typeof manifest.capturedAt !== 'string' || !Number.isFinite(Date.parse(manifest.capturedAt))
      || !software || software.name !== 'MicrobeTrace'
      || [software.version, software.commit, software.buildDate].some(value => typeof value !== 'string' || !value.trim())
      || !Number.isFinite(Date.parse(software.buildDate))
      || !['recorded', 'not recorded'].includes(manifest.historicalProvenance)
      || typeof manifest.stateChecksum !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.stateChecksum)) {
      throw new Error('The investigation provenance metadata is invalid.');
    }
    if (canonicalInvestigationJson(manifest.counts) !== canonicalInvestigationJson(this.counts(stash.session))) {
      throw new Error('The investigation manifest counts do not match the saved network.');
    }
  }

  /** Parse and validate off to the side; no currently loaded state is touched here. */
  async prepare(payload: any): Promise<StashObjects> {
    const stash: StashObjects = investigationCopy(payload?.session ? payload : { session: payload, tabs: [] });
    this.validate(stash);
    if (stash.schemaVersion !== undefined) {
      this.validateProvenance(stash);
      const summaries: InvestigationManifest['investigation']['calculations'] = {};
      for (const [operation, run] of Object.entries(stash.investigation.calculations)) {
        const { inputs, output, ...summary } = run;
        const { __scopeOptions, ...parameters } = run.parameters;
        if (await investigationChecksum({ inputs, parameters }) !== run.inputChecksum) throw new Error('A calculation input checksum does not match its recorded inputs.');
        summaries[operation] = { ...summary, outputChecksum: await investigationChecksum(output) };
      }
      if (canonicalInvestigationJson({ ...stash.investigation, calculations: summaries }) !== canonicalInvestigationJson(stash.provenance.investigation)) {
        throw new Error('The investigation manifest does not match the saved settings and results.');
      }
      if (!Array.isArray(stash.provenance.sources) || stash.provenance.sources.length !== (stash.session.files || []).length) throw new Error('The input source manifest is invalid.');
      for (let index = 0; index < stash.provenance.sources.length; index++) {
        const file = stash.session.files[index], source = stash.provenance.sources[index];
        const contents = file.contents ?? file.content ?? file.data;
        const checksum = contents === undefined ? 'not recorded' : await investigationChecksum(contents);
        if (source.name !== String(file.name ?? 'Unnamed input') || source.sha256 !== checksum) throw new Error('The input source manifest does not match the saved contents.');
      }
      const actual = await investigationChecksum(this.checksumPayload(stash));
      if (actual !== stash.provenance.stateChecksum) throw new Error('The investigation checksum does not match its saved contents.');
      this.hydrateState(stash);
    } else {
      stash.session.investigation = createInvestigationWorkspace();
      stash.session.investigationHistoricalProvenance = 'not recorded';
    }
    stash.session = reviveInvestigationBinary(stash.session);
    return stash;
  }

  private hydrateState(stash: StashObjects): void {
    const state = stash.investigation;
    const session = stash.session;
    session.investigation = {
      cohorts: state.cohorts, selectedCohortIds: state.selectedCohortIds, edgeLayers: state.edgeLayers,
      annotations: state.annotations, scopes: state.scopes, calculations: state.calculations, viewStates: state.viewStates,
    };
    session.investigationHistoricalProvenance = stash.provenance.historicalProvenance;
    session.state = state.filters.state;
    session.data.nodeExclusions = state.filters.exclusions;
    Object.assign(session.data, state.filters.tables);
    session.style.widgets = { ...state.layout.widgets, ...state.grouping.widgets,
      'link-threshold': state.threshold.value, 'link-sort-variable': state.threshold.metric,
      'default-distance-metric': state.threshold.distanceMetric, 'tn93-distance-display-format': state.threshold.displayFormat,
      'link-show-nn': state.threshold.nearestNeighbor, 'cluster-minimum-size': state.filters.minimumClusterSize };
    session.meta = { ...session.meta, rendererViewState: state.layout.camera };
    session.network = { ...session.network, ...state.layout.network };
    const positions = new Map(state.layout.nodes.map(node => [node.id, node]));
    for (const node of session.data.nodes) {
      const saved = positions.get(investigationNodeId(node));
      if (saved) for (const key of ['x', 'y', 'fixed', 'selected']) if (saved[key] !== undefined) node[key] = saved[key];
    }
    stash.tabs = state.layout.tabs;
    stash.dashboardLayout = state.layout.dashboardLayout;
    stash.dashboardState = state.layout.dashboardState;
    session.layout = state.layout.legacyLayout;
  }

  validate(stash: StashObjects): void {
    if (stash.schemaVersion !== undefined && ![1, INVESTIGATION_SCHEMA_VERSION].includes(stash.schemaVersion)) throw new Error(`Unsupported investigation schema version: ${stash.schemaVersion}.`);
    const session = stash.session;
    if (!session?.data || !Array.isArray(session.data.nodes) || !Array.isArray(session.data.links)
      || !session.style?.widgets || typeof session.style.widgets !== 'object') throw new Error('The saved session does not contain a valid network and settings.');
    const ids = new Set<string>();
    for (const node of session.data.nodes) {
      const id = investigationNodeId(node);
      if (!id || ids.has(id)) throw new Error('The saved network contains missing or duplicate node IDs.');
      ids.add(id);
    }
    const edges = new Set<string>();
    for (const edge of session.data.links) {
      const source = typeof edge.source === 'object' ? investigationNodeId(edge.source) : String(edge.source ?? '');
      const target = typeof edge.target === 'object' ? investigationNodeId(edge.target) : String(edge.target ?? '');
      if (!ids.has(source) || !ids.has(target)) throw new Error('A saved edge refers to a missing node.');
      if (stash.schemaVersion && edges.has(investigationEdgeId(edge))) throw new Error('The saved network contains duplicate edge IDs.');
      edges.add(investigationEdgeId(edge));
    }
    if (!stash.schemaVersion) return;
    const state = stash.investigation;
    if (typeof stash.snapshotId !== 'string' || !state || !Array.isArray(state.cohorts) || !Array.isArray(state.edgeLayers)
      || !Array.isArray(state.annotations) || !Array.isArray(state.selectedCohortIds) || !state.scopes || !state.calculations || !state.viewStates
      || !state.threshold || !Number.isFinite(state.threshold.value) || !state.filters?.state || !Array.isArray(state.filters.exclusions)
      || !state.filters.tables || !state.layout?.widgets || !Array.isArray(state.layout.nodes) || !Array.isArray(state.layout.tabs)
      || !state.grouping?.widgets || !Array.isArray(state.grouping.groups)) throw new Error('The investigation state is incomplete.');
    const cohortIds = new Set<string>();
    for (const cohort of state.cohorts) {
      if (!cohort.id || cohortIds.has(cohort.id) || typeof cohort.name !== 'string' || !cohort.name.trim()
        || !Array.isArray(cohort.nodeIds) || cohort.nodeIds.some(id => !ids.has(id))) throw new Error('A saved cohort has invalid membership or identity.');
      cohortIds.add(cohort.id);
    }
    if (state.selectedCohortIds.some(id => !cohortIds.has(id))) throw new Error('The investigation selects a missing cohort.');
    const sourceIds = new Set<string>();
    const sources = new Set<string>();
    for (const layer of state.edgeLayers) {
      if (!layer.id || sourceIds.has(layer.id) || !layer.source || sources.has(layer.source) || typeof layer.name !== 'string'
        || typeof layer.enabled !== 'boolean' || (layer.color !== undefined && !/^#[0-9a-f]{6}$/i.test(layer.color))
        || (layer.opacity !== undefined && (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1))) throw new Error('A saved relationship layer is invalid.');
      sourceIds.add(layer.id); sources.add(layer.source);
    }
    const noteIds = new Set<string>();
    for (const note of state.annotations) {
      if (!note.id || noteIds.has(note.id) || typeof note.text !== 'string' || !note.text.trim()
        || !['investigation', 'node', 'edge', 'cohort'].includes(note.target?.type)
        || (note.target.type !== 'investigation' && !note.target.id)
        || !Number.isFinite(Date.parse(note.createdAt)) || !Number.isFinite(Date.parse(note.updatedAt))) throw new Error('A saved annotation is invalid.');
      noteIds.add(note.id);
    }
    const operations = new Set<string>(INVESTIGATION_OPERATIONS.map(item => item.id));
    for (const [operation, scope] of Object.entries(state.scopes)) {
      if (!operations.has(operation) || !['full', 'visible', 'cohort'].includes(scope)) throw new Error('A saved calculation scope is invalid.');
    }
    for (const [operation, run] of Object.entries(state.calculations)) {
      if (!run || run.operation !== operation || !operations.has(operation) || !['completed', 'stale'].includes(run.status)
        || !['full', 'visible', 'cohort'].includes(run.scope) || !Array.isArray(run.nodeIds) || !Array.isArray(run.edgeIds)
        || !Array.isArray(run.inputs?.nodes) || !Array.isArray(run.inputs?.links) || !run.inputChecksum || !run.software
        || !Number.isFinite(Date.parse(run.completedAt))) throw new Error('A saved calculation record is invalid.');
    }
    if (state.layout.nodes.length !== ids.size || new Set(state.layout.nodes.map(node => node.id)).size !== ids.size
      || state.layout.nodes.some(node => !ids.has(node.id) || ['x', 'y'].some(key => node[key] !== undefined && !Number.isFinite(node[key])))) throw new Error('A saved layout has invalid node references or positions.');
    if (state.grouping.groups.some(group => !Array.isArray(group.nodeIds) || group.nodeIds.some(id => !ids.has(id)))) throw new Error('A saved group refers to a missing node.');
  }

  readableRecord(manifest: InvestigationManifest): string {
    const escape = (value: any) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const section = (title: string, value: any) => `<section><h2>${escape(title)}</h2><pre>${escape(JSON.stringify(value, null, 2))}</pre></section>`;
    const state = manifest.investigation;
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MicrobeTrace investigation record</title><style>body{font:16px system-ui;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#172b4d}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6f8;padding:1rem}h2{margin-top:2rem}</style><h1>MicrobeTrace investigation record</h1><p>Snapshot ${escape(manifest.snapshotId)} · ${escape(manifest.capturedAt)}</p><p>State SHA-256: ${escape(manifest.stateChecksum)}</p>${section('Software', manifest.software)}${section('Input sources', manifest.sources)}${section('Network counts', manifest.counts)}${section('Threshold', state.threshold)}${section('Filters', state.filters)}${section('Layout', state.layout)}${section('Grouping', state.grouping)}${section('Cohorts', { cohorts: state.cohorts, selectedCohortIds: state.selectedCohortIds })}${section('Relationship layers', state.edgeLayers)}${section('Annotations', state.annotations)}${section('Calculation scopes and completed results', { scopes: state.scopes, calculations: state.calculations })}<p>Historical provenance: ${escape(manifest.historicalProvenance)}. Exact analytical inputs and completed outputs are retained in the accompanying session.</p></html>`;
  }
}
