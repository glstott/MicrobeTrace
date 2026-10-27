import { Injectable } from '@angular/core';
import {
  InvestigationOperation, ResolvedInvestigationInputs,
  investigationCopy, investigationChecksum, investigationInputKey, investigationNodeId,
  investigationEdgeId, resolveInvestigationInputs, eligibleInvestigationOrigins,
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
    const inputs = this.resolve(session, operation, { ...options, nodes: undefined, allowEmpty: true });
    if (options.sequence) inputs.links = [];
    return investigationInputKey(inputs, this.parameters(session, operation, options.parameters));
  }

  refreshStatus(session: any): void {
    const workspace = this.snapshots.workspace(session);
    for (const record of Object.values(workspace.calculations)) {
      if (!record || record.status === 'stale') continue;
      try {
        const options = record.parameters.__scopeOptions || {};
        if (record.currentInputKey !== this.key(session, record.operation, options)) record.status = 'stale';
      } catch { record.status = 'stale'; }
    }
  }

  async flush(): Promise<void> { await Promise.all(Array.from(this.pending)); }
  cancelSession(session: object): void { this.jobs.set(session, new Map()); }

  rebaseAfterApply(session: any, operation: InvestigationOperation): void {
    const run = this.snapshots.workspace(session).calculations[operation];
    if (run) run.currentInputKey = this.key(session, operation, run.parameters.__scopeOptions || {});
  }

  savedOutput(session: any, operation: InvestigationOperation, options: InvestigationRunOptions = {}): any {
    const run = this.snapshots.workspace(session).calculations[operation];
    if (!run) return undefined;
    try {
      if (run.status === 'completed' && run.currentInputKey === this.key(session, operation, options)) return run.output;
    } catch { /* Missing cohort/inputs makes the saved output stale, never changes its scope. */ }
    run.status = 'stale';
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
