import { Injectable } from '@angular/core';
import {
  InvestigationOperation, ResolvedInvestigationInputs, InvestigationCalculation, InvestigationChangeBaseline,
  investigationCopy, investigationChecksum, investigationInputKey, investigationNodeId,
  investigationEdgeId, resolveInvestigationInputs, eligibleInvestigationOrigins,
  investigationChangeBaseline, investigationChangeKey,
} from './investigation-state';
import { InvestigationSessionService, investigationSoftware } from './investigation-session.service';

export interface InvestigationRunOptions {
  sequence?: boolean;
  sweep?: boolean;
  unpruned?: boolean;
  nodes?: any[];
  parameters?: Record<string, any>;
  allowEmpty?: boolean;
}

@Injectable({ providedIn: 'root' })
export class InvestigationCalculationService {
  private readonly jobs = new WeakMap<object, Map<string, string>>();
  private readonly reads = new WeakMap<object, Map<string, { key: string; promise: Promise<any> }>>();
  private readonly pending = new Set<Promise<any>>();
  constructor(private readonly snapshots: InvestigationSessionService) {}

  parameters(session: any, operation: InvestigationOperation, extra: any = {}): any {
    // Presentation widgets are excluded so moving a camera does not stale an analysis.
    const widgets = session.style?.widgets || {};
    const sequence = ['alignment', 'ambiguity', 'consensus', 'consensus-distances', 'pairwise-distances', 'bootstrap'].includes(operation);
    const relevant = sequence ? /^(default-distance-metric|ambiguity-.*|align-sw|tree-round|tree-bootstrap-(custom-replicates|stop-when-stable))$/
      : /^(default-distance-metric|link-sort-variable|link-threshold|link-show-nn|filtering-epsilon|tree-round)$/;
    const unpruned = ['tree', 'distance-matrix', 'mst', 'nearest-neighbor'].includes(operation);
    return { operation, ...Object.fromEntries(Object.entries(widgets).filter(([key]) => relevant.test(key)
      && !(operation === 'threshold-analysis' && key === 'link-threshold')
      && !(unpruned && ['link-threshold', 'link-show-nn'].includes(key)))),
      ...(sequence ? {} : { disabledSources: this.snapshots.workspace(session).edgeLayers.filter(layer => !layer.enabled).map(layer => layer.source).sort() }),
      ...(operation === 'network-statistics' ? { selectedNodeIds: (session.data.nodes || []).filter(node => node.selected).map(investigationNodeId) } : {}),
      ...(['bootstrap', 'patristic', 'threshold-analysis', 'directionality', 'mst', 'nearest-neighbor'].includes(operation) ? { tree: session.data.newickString || null } : {}),
      ...extra };
  }

  resolve(session: any, operation: InvestigationOperation, options: InvestigationRunOptions = {}): ResolvedInvestigationInputs {
    return resolveInvestigationInputs(session, this.snapshots.workspace(session), operation, options);
  }

  private key(session: any, operation: InvestigationOperation, options: InvestigationRunOptions = {}): string {
    const { inputs, parameters } = this.currentInputs(session, operation, options);
    return investigationInputKey(inputs, parameters);
  }

  private currentInputs(session: any, operation: InvestigationOperation, options: InvestigationRunOptions) {
    const inputs = this.resolve(session, operation, { ...options, nodes: undefined, allowEmpty: true });
    if (options.sequence) inputs.links = [];
    return { inputs, parameters: this.parameters(session, operation, options.parameters) };
  }

  private baseline(session: any, operation: InvestigationOperation, options: InvestigationRunOptions): InvestigationChangeBaseline {
    const { inputs, parameters } = this.currentInputs(session, operation, options);
    return investigationChangeBaseline(inputs, parameters);
  }

  private changeReasons(record: InvestigationCalculation, inputs: ResolvedInvestigationInputs, parameters: any): string[] {
    const current = investigationChangeBaseline(inputs, parameters);
    let before = record.changeBaseline;
    // Older runs did not record categorized fingerprints. Their original inputs
    // are usable only when applying the result did not change the input key.
    if (!before) {
      const savedInputs = { scope: record.scope, cohortIds: record.cohortIds, ...record.inputs };
      const { __scopeOptions, ...savedParameters } = record.parameters;
      if (investigationInputKey(savedInputs, savedParameters) === record.currentInputKey) {
        before = investigationChangeBaseline(savedInputs, savedParameters);
      }
    }
    const reasons: string[] = [];
    const scopeChanged = (before?.scope ?? record.scope) !== current.scope;
    const cohortsChanged = !scopeChanged && (before?.cohorts ?? investigationChangeKey([...record.cohortIds].sort())) !== current.cohorts;
    if (scopeChanged) reasons.push('Calculation scope changed.');
    if (cohortsChanged) reasons.push('Selected cohorts changed.');
    if (!before) return reasons.length ? reasons : ['Exact change details were not recorded for this saved result.'];
    // A new scope naturally changes its population and cohort IDs. Describe the
    // scope change rather than implying that the user also edited those items.
    if (!scopeChanged && !cohortsChanged && before.population !== current.population) {
      reasons.push(current.scope === 'cohort' ? 'Eligible cohort membership changed.'
        : current.scope === 'visible' ? 'Visible node population changed (filters or visibility).'
        : 'Eligible node population changed.');
    } else if (!scopeChanged && !cohortsChanged && before.nodes !== current.nodes) reasons.push('Sequence inputs changed.');
    if (before.layers !== current.layers) reasons.push('Enabled relationship layers changed.');
    if (before.parameters !== current.parameters) reasons.push('Analytical parameters changed.');
    if (before.selection !== current.selection) reasons.push('Selected nodes changed.');
    if (before.tree !== current.tree) reasons.push('Base tree changed.');
    if (!scopeChanged && !cohortsChanged && before.relationships !== current.relationships) reasons.push(current.scope === 'visible'
      ? 'Visible relationship inputs changed (filters or relationship data).'
      : 'Eligible relationships or edge values changed.');
    return reasons.length ? reasons : ['Analytical inputs or settings changed since this result was completed.'];
  }

  refreshStatus(session: any): void {
    const workspace = this.snapshots.workspace(session);
    for (const record of Object.values(workspace.calculations)) {
      if (!record) continue;
      try {
        const options = record.parameters.__scopeOptions || {};
        const { inputs, parameters } = this.currentInputs(session, record.operation, options);
        if (record.currentInputKey !== investigationInputKey(inputs, parameters)) {
          record.status = 'stale';
          record.staleReasons = this.changeReasons(record, inputs, parameters);
        } else if (record.status === 'stale') {
          record.staleReasons = ['Inputs now match the saved result again. Run again to refresh its stale status.'];
        }
      } catch (error) {
        record.status = 'stale';
        record.staleReasons = [`Inputs could not be resolved: ${error instanceof Error ? error.message : 'required inputs are unavailable.'}`];
      }
    }
  }

  async flush(): Promise<void> { await Promise.all(Array.from(this.pending)); }
  cancelSession(session: object): void { this.jobs.set(session, new Map()); this.reads.delete(session); }

  /** Render consumers share identical work; reading a matrix must not supersede another reader. */
  shareRead<T>(session: any, operation: InvestigationOperation, work: () => Promise<T>, options: InvestigationRunOptions = {}): Promise<T> {
    let key: string;
    try { key = this.key(session, operation, options); } catch (error) { return Promise.reject(error); }
    if (!this.reads.has(session)) this.reads.set(session, new Map());
    const reads = this.reads.get(session);
    const existing = reads.get(operation);
    if (existing?.key === key) return existing.promise;
    let promise: Promise<T>;
    try { promise = work(); } catch (error) { return Promise.reject(error); }
    const entry = { key, promise };
    reads.set(operation, entry);
    const clear = () => { if (reads.get(operation) === entry) reads.delete(operation); };
    void promise.then(clear, clear);
    return promise;
  }

  rebaseAfterApply(session: any, operation: InvestigationOperation): void {
    const run = this.snapshots.workspace(session).calculations[operation];
    if (run) {
      const options = run.parameters.__scopeOptions || {};
      run.currentInputKey = this.key(session, operation, options);
      run.changeBaseline = this.baseline(session, operation, options);
    }
  }

  savedOutput(session: any, operation: InvestigationOperation, options: InvestigationRunOptions = {}): any {
    const run = this.snapshots.workspace(session).calculations[operation];
    if (!run) return undefined;
    try {
      if (run.status === 'completed' && run.currentInputKey === this.key(session, operation, options)) return run.output;
    } catch { /* Missing cohort/inputs makes the saved output stale, never changes its scope. */ }
    run.status = 'stale';
    this.refreshStatus(session);
    return undefined;
  }

  async run<T>(session: any, operation: InvestigationOperation,
    compute: (inputs: ResolvedInvestigationInputs) => Promise<T>,
    apply: (output: T, inputs: ResolvedInvestigationInputs) => void = () => {},
    options: InvestigationRunOptions = {}, currentSession: () => any = () => session): Promise<T> {
    const workspace = this.snapshots.workspace(session);
    // Capture before any await. A running worker never sees later filter/cohort edits.
    const inputs = investigationCopy(this.resolve(session, operation, options));
    inputs.nodes.forEach((node, index) => node.index = index);
    inputs.links = inputs.links.map(link => ({ ...link, origin: eligibleInvestigationOrigins(session, workspace, link, options.sweep, options.unpruned), visible: true }));
    const parameters = investigationCopy(this.parameters(session, operation, options.parameters));
    const currentInputKey = this.key(session, operation, options);
    const id = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    if (!this.jobs.has(session)) this.jobs.set(session, new Map());
    this.jobs.get(session).set(operation, id);
    const inputData = investigationCopy({ nodes: inputs.nodes, links: options.sequence ? [] : inputs.links,
      ...(['patristic', 'bootstrap', 'threshold-analysis', 'tree', 'distance-matrix', 'mst', 'nearest-neighbor'].includes(operation) ? { tree: session.data.newickString } : {}) });
    const digest = investigationChecksum({ inputs: inputData, parameters });
    const output = await compute(inputs);
    const inputChecksum = await digest;
    if (currentSession() !== session || this.jobs.get(session)?.get(operation) !== id
      || this.key(session, operation, options) !== currentInputKey) throw new Error('Calculation cancelled because its investigation inputs changed.');
    // A failed or superseded run leaves the previous result and live data untouched.
    apply(output, inputs);
    if (output && typeof output === 'object' && (output as any).skipped) return output;
    workspace.calculations[operation] = {
      id, operation, scope: inputs.scope, cohortIds: inputs.cohortIds,
      nodeIds: inputs.nodes.map(investigationNodeId), edgeIds: inputData.links.map(investigationEdgeId),
      parameters: { ...parameters, __scopeOptions: { sequence: !!options.sequence, sweep: !!options.sweep, unpruned: !!options.unpruned, parameters: options.parameters || {} } },
      inputs: inputData, inputChecksum, currentInputKey: this.key(session, operation, options),
      changeBaseline: this.baseline(session, operation, options),
      startedAt, completedAt: new Date().toISOString(), software: investigationSoftware(),
      status: 'completed', output: investigationCopy(output),
    };
    return output;
  }

  /** Threshold sweeps are synchronous; saves wait for their provenance digest to finish. */
  recordSynchronous(session: any, operation: InvestigationOperation, output: any, options: InvestigationRunOptions = {}): void {
    const task = this.run(session, operation, async () => output, undefined, options);
    const handled = task.catch(() => undefined).finally(() => this.pending.delete(handled));
    this.pending.add(handled);
  }
}
