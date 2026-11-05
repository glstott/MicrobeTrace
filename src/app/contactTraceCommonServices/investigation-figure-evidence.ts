import {
  InvestigationFigureEvidence, InvestigationFigureEvidenceSummary, InvestigationFigure, InvestigationCalculationSummary,
  InvestigationWorkspace, INVESTIGATION_OPERATIONS, investigationChecksum, investigationNodeId, investigationEdgeId,
  investigationEndpointId, investigationOutputSummary, investigationCopy, investigationEvidencePath, canonicalInvestigationJson,
} from './investigation-state';

const object = (value: any) => value && typeof value === 'object' && !Array.isArray(value);
const ids = (value: any) => Array.isArray(value) && value.every(id => typeof id === 'string' && !!id);
const operations = new Set<string>(INVESTIGATION_OPERATIONS.map(operation => operation.id));
const same = (left: any, right: any) => canonicalInvestigationJson(left) === canonicalInvestigationJson(right);

/** Historical references are checked against their own retained data, never the current investigation. */
export function validateFigureEvidence(archives: InvestigationWorkspace['figureEvidence'], figures: InvestigationFigure[], required: boolean): void {
  if (archives === undefined && !required && !figures.some(figure => figure.evidenceId)) return;
  if (!object(archives)) throw new Error('The figure supporting-record archive is invalid.');
  const referenced = new Set<string>();
  for (const figure of figures) {
    if (required && figure.evidenceId === undefined) throw new Error('A figure is missing its supporting-record status.');
    if (figure.evidenceId == null) continue;
    if (typeof figure.evidenceId !== 'string' || !/^[a-f0-9]{64}$/.test(figure.evidenceId) || !archives[figure.evidenceId]) throw new Error('A figure refers to missing supporting records.');
    const evidence = archives[figure.evidenceId];
    if (!evidence?.data || !Array.isArray(evidence.data.nodes) || !Array.isArray(evidence.data.links)) throw new Error('The figure supporting data is invalid.');
    const context = figure.context;
    if (!same(context.nodeIds, evidence.data.nodes.map(investigationNodeId))
      || !same(context.edgeIds, evidence.data.links.map(investigationEdgeId))
      || !same(context.visibleNodeIds, evidence.data.nodes.filter(node => node.visible !== false).map(investigationNodeId))
      || !same(context.visibleEdgeIds, evidence.data.links.filter(link => link.visible !== false).map(investigationEdgeId))
      || !same(context.selectedCohortIds, evidence.selectedCohortIds)
      || !Array.isArray(evidence.edgeLayers) || !object(evidence.calculations)
      || !same(context.enabledLayerIds, evidence.edgeLayers.filter(layer => layer.enabled).map(layer => layer.id))
      || !same(context.calculationIds, Object.values(evidence.calculations).map(run => run?.id))) throw new Error('A figure does not match its supporting records.');
    referenced.add(figure.evidenceId);
  }
  for (const [id, evidence] of Object.entries(archives)) {
    if (!/^[a-f0-9]{64}$/.test(id) || !referenced.has(id) || !object(evidence) || evidence.version !== 1
      || !object(evidence.data) || !Array.isArray(evidence.data.nodes) || !Array.isArray(evidence.data.links)
      || !Array.isArray(evidence.files) || evidence.files.some(file => !object(file)) || !Array.isArray(evidence.cohorts) || !ids(evidence.selectedCohortIds)
      || !Array.isArray(evidence.edgeLayers) || !object(evidence.scopes) || !object(evidence.calculations)) throw new Error('The figure supporting-record archive is invalid.');
    const nodes = new Set(evidence.data.nodes.map(investigationNodeId));
    const links = new Set(evidence.data.links.map(investigationEdgeId));
    if (nodes.has('') || nodes.size !== evidence.data.nodes.length || links.size !== evidence.data.links.length
      || evidence.data.links.some(link => !nodes.has(investigationEndpointId(link.source)) || !nodes.has(investigationEndpointId(link.target)))) throw new Error('The figure supporting data contains invalid node or relationship references.');
    const cohorts = new Set(evidence.cohorts.map(cohort => cohort?.id));
    if (cohorts.size !== evidence.cohorts.length || evidence.cohorts.some(cohort => !cohort?.id || typeof cohort.name !== 'string'
      || !cohort.name.trim() || !ids(cohort.nodeIds) || cohort.nodeIds.some(id => !nodes.has(id)))
      || evidence.selectedCohortIds.some(id => !cohorts.has(id))) throw new Error('A historical figure cohort is invalid.');
    const layers = new Set(evidence.edgeLayers.map(layer => layer?.id));
    if (layers.size !== evidence.edgeLayers.length || evidence.edgeLayers.some(layer => !layer?.id || typeof layer.source !== 'string'
      || !layer.source || typeof layer.name !== 'string' || typeof layer.enabled !== 'boolean'
      || (layer.color !== undefined && !/^#[0-9a-f]{6}$/i.test(layer.color))
      || (layer.opacity !== undefined && (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1)))) throw new Error('A historical figure relationship layer is invalid.');
    if (Object.entries(evidence.scopes).some(([operation, scope]) => !operations.has(operation) || !['full', 'visible', 'cohort'].includes(scope))) throw new Error('A historical figure calculation scope is invalid.');
    const runIds = new Set<string>();
    for (const [operation, run] of Object.entries(evidence.calculations)) {
      if (!run || !operations.has(operation) || operation !== run.operation || !run.id || runIds.has(run.id)
        || !['completed', 'stale'].includes(run.status) || !['full', 'visible', 'cohort'].includes(run.scope)
        || !ids(run.nodeIds) || !ids(run.edgeIds) || !ids(run.cohortIds) || !object(run.parameters)
        || !Array.isArray(run.inputs?.nodes) || !Array.isArray(run.inputs?.links)
        || !same(run.nodeIds, run.inputs.nodes.map(investigationNodeId)) || !same(run.edgeIds, run.inputs.links.map(investigationEdgeId))
        || !/^[a-f0-9]{64}$/.test(run.inputChecksum) || !Number.isFinite(Date.parse(run.startedAt)) || !Number.isFinite(Date.parse(run.completedAt))
        || run.software?.name !== 'MicrobeTrace' || !['version', 'commit', 'buildDate'].every(key => typeof run.software[key] === 'string' && !!run.software[key])) throw new Error('A figure supporting calculation record is invalid.');
      runIds.add(run.id);
    }
  }
}

export async function verifyFigureEvidence(archives: InvestigationWorkspace['figureEvidence'], figures: InvestigationFigure[]): Promise<void> {
  const checksums = new Map<string, string>();
  for (const [id, evidence] of Object.entries(archives || {})) {
    if (await investigationChecksum(evidence) !== id) throw new Error('The figure supporting-record checksum does not match its contents.');
    checksums.set(id, await investigationChecksum(evidence.data));
    for (const run of Object.values(evidence.calculations)) {
      const { __scopeOptions, ...parameters } = run.parameters;
      if (await investigationChecksum({ inputs: run.inputs, parameters }) !== run.inputChecksum) throw new Error('A figure calculation input checksum does not match its retained inputs.');
    }
  }
  for (const figure of figures) if (figure.evidenceId && checksums.get(figure.evidenceId) !== figure.context.inputChecksum) throw new Error('A figure input checksum does not match its retained data.');
}

export async function summarizeFigureEvidence(id: string, evidence: InvestigationFigureEvidence): Promise<InvestigationFigureEvidenceSummary> {
  const calculations: Partial<Record<keyof InvestigationFigureEvidence['calculations'], InvestigationCalculationSummary>> = {};
  for (const [operation, run] of Object.entries(evidence.calculations)) {
    const { inputs, output, ...metadata } = run;
    calculations[operation] = { ...metadata, outputChecksum: await investigationChecksum(output), outputSummary: investigationOutputSummary(run.operation, output) };
  }
  return investigationCopy({ path: investigationEvidencePath(id), inputChecksum: await investigationChecksum(evidence.data),
    counts: { nodes: evidence.data.nodes.length, edges: evidence.data.links.length },
    sources: await Promise.all(evidence.files.map(async file => {
      const contents = file.contents ?? file.content ?? file.data;
      return { name: String(file.name ?? 'Unnamed input'), sha256: contents === undefined ? 'not recorded' : await investigationChecksum(contents),
        representation: contents === undefined ? 'not recorded' : 'canonical saved content (including binary encoding)' };
    })), cohorts: evidence.cohorts, selectedCohortIds: evidence.selectedCohortIds, edgeLayers: evidence.edgeLayers,
    scopes: evidence.scopes, calculations });
}
