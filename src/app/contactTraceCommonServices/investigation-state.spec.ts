import {
  createInvestigationWorkspace, resolveInvestigationInputs, eligibleInvestigationOrigins,
  investigationCopy, investigationChecksum, investigationAnnotationResolved, investigationInputKey,
} from './investigation-state';
import { InvestigationSessionService } from './investigation-session.service';
import { InvestigationCalculationService } from './investigation-calculation.service';
import { CommonService } from './common.service';
import { InlineWorker } from '../helperClasses/inlineWorker';
import { WorkerComputeService } from './worker-compute.service';

function investigationFixture(): any {
  const investigation = createInvestigationWorkspace();
  investigation.cohorts = [{ id: 'one', name: 'First cohort', nodeIds: ['A', 'B'] }, { id: 'two', name: 'Second cohort', nodeIds: ['B', 'C'] }];
  investigation.selectedCohortIds = ['one', 'two'];
  investigation.edgeLayers = [{ id: 'genetic', source: 'Genetic Distance', name: 'Genetic', enabled: true }, { id: 'contact', source: 'Contacts', name: 'Contacts', enabled: true, color: '#123456', opacity: 0.4 }];
  investigation.annotations = [{ id: 'note', text: 'Review this link <script>alert(1)</script>', target: { type: 'edge', id: 'BC' }, createdAt: '2026-10-26T12:00:00Z', updatedAt: '2026-10-26T12:01:00Z' }];
  return {
    data: {
      nodes: ['A', 'B', 'C', 'D'].map((id, index) => ({ _id: id, id, index, seq: 'ACGT', x: index * 20, y: index * 10, fixed: index === 0, selected: index < 2, visible: id === 'A' || id === 'C', cluster: index % 2 })),
      links: [
        { id: 'AB', source: 'A', target: 'B', origin: ['Genetic Distance'], distanceOrigin: 'Genetic Distance', hasDistance: true, distance: 1, visible: false },
        { id: 'BC', source: 'B', target: 'C', origin: ['Contacts'], _originAll: ['Genetic Distance', 'Contacts'], distanceOrigin: 'Genetic Distance', hasDistance: true, distance: 8, visible: false },
        { id: 'AC', source: 'A', target: 'C', origin: ['Contacts'], visible: true },
        { id: 'CD', source: 'C', target: 'D', origin: ['Genetic Distance'], distanceOrigin: 'Genetic Distance', hasDistance: true, distance: 1, visible: false },
      ],
      nodeExclusions: [], nodeFilter: { State: { value: 'GA', matchMode: 'equals' } }, nodeTableColumns: [{ field: 'State' }],
    },
    files: [{ name: 'nodes.csv', contents: 'id,State\nA,GA\nB,TX', extension: 'csv' }],
    state: { networkSubsetFilter: { node: { enabled: true, field: 'State', operator: 'equals', value: 'GA' } }, timeStart: '2026-01-01' },
    style: { widgets: { 'link-threshold': 3, 'link-sort-variable': 'distance', 'default-distance-metric': 'snps', 'link-show-nn': false, 'cluster-minimum-size': 2, 'polygons-foci': 'State', 'polygons-show': true, 'network-layout': 'force-directed' } },
    layout: { type: 'stack', content: [] }, meta: { rendererViewState: { centerX: 3, centerY: 4, graphUnitsPerPixel: 2, edgeDetailMode: 'all' } },
    network: { allPinned: true, timelinePinned: false, isFullyLoaded: true }, investigation,
  };
}

describe('Investigation scope contract', () => {
  it('resolves full, visible, and overlapping cohort populations without altering loaded rows', () => {
    const session = investigationFixture();
    const before = JSON.stringify(session);
    for (const [scope, nodes, edges] of [['full', 4, 4], ['visible', 2, 1], ['cohort', 3, 3]] as const) {
      session.investigation.scopes['network-statistics'] = scope;
      const input = resolveInvestigationInputs(session, session.investigation, 'network-statistics');
      expect(input.nodes.length).toBe(nodes);
      expect(input.links.length).toBe(edges);
    }
    delete session.investigation.scopes['network-statistics'];
    expect(JSON.stringify(session)).toBe(before);
  });
  it('retains contact contributions when a genetic source is disabled or over threshold', () => {
    const session = investigationFixture();
    session.investigation.edgeLayers[0].enabled = false;
    session.investigation.scopes['network-statistics'] = 'full';
    const input = resolveInvestigationInputs(session, session.investigation, 'network-statistics');
    expect(input.links.map(link => link.id)).toEqual(['BC', 'AC']);
    expect(eligibleInvestigationOrigins(session, session.investigation, session.data.links[1])).toEqual(['Contacts']);
    expect(session.data.links[1]._originAll).toEqual(['Genetic Distance', 'Contacts']);
  });
  it('keeps cohort membership fixed when nodes become hidden', () => {
    const session = investigationFixture();
    session.investigation.scopes.consensus = 'cohort';
    session.data.nodes.forEach(node => node.visible = false);
    expect(resolveInvestigationInputs(session, session.investigation, 'consensus', { sequence: true }).nodes.map(node => node._id)).toEqual(['A', 'B', 'C']);
  });
  it('explains empty and missing cohort scopes instead of widening them', () => {
    const session = investigationFixture();
    session.investigation.scopes.consensus = 'cohort';
    session.investigation.selectedCohortIds = [];
    expect(() => resolveInvestigationInputs(session, session.investigation, 'consensus')).toThrowError(/no eligible/);
    session.investigation.selectedCohortIds = ['missing'];
    expect(() => resolveInvestigationInputs(session, session.investigation, 'consensus')).toThrowError(/unavailable/);
  });
  it('distinguishes a threshold sweep from threshold-filtered graph inputs', () => {
    const session = investigationFixture();
    session.investigation.edgeLayers[1].enabled = false;
    expect(resolveInvestigationInputs(session, session.investigation, 'threshold-analysis').links.map(link => link.id)).toEqual(['AB', 'CD']);
    expect(resolveInvestigationInputs(session, session.investigation, 'threshold-analysis', { sweep: true }).links.map(link => link.id)).toEqual(['AB', 'BC', 'CD']);
  });
  it('excludes missing sequences and reports an empty eligible sequence population', () => {
    const session = investigationFixture();
    session.data.nodes[0].seq = '';
    expect(resolveInvestigationInputs(session, session.investigation, 'consensus', { sequence: true }).nodes.length).toBe(3);
    session.data.nodes.forEach(node => node.seq = '');
    expect(() => resolveInvestigationInputs(session, session.investigation, 'consensus', { sequence: true })).toThrowError(/no eligible sequences/);
  });
  it('retains sweep samples independently of the current nearest-neighbor display mask', () => {
    const session = investigationFixture();
    session.style.widgets['link-show-nn'] = true;
    session.data.links.forEach(link => link.nn = false);
    expect(resolveInvestigationInputs(session, session.investigation, 'threshold-analysis', { sweep: true }).links.map(link => link.id)).toEqual(['AB', 'BC', 'CD']);
  });
  for (const operation of ['mst', 'nearest-neighbor', 'tree', 'distance-matrix', 'threshold-analysis'] as const) {
    it(`keeps explicit visible link rules while restoring pruning candidates for ${operation}`, () => {
      const session = investigationFixture();
      session.data.nodes.forEach(node => node.visible = true);
      session.data.links.forEach(link => { link.visible = false; link.review = link.id === 'CD' ? 'exclude' : 'include'; });
      session.state.networkSubsetFilter.link = { enabled: true, field: 'review', operator: 'equals', value: 'INCLUDE' };
      session.style.widgets['link-show-nn'] = true;
      session.investigation.scopes[operation] = 'visible';
      const input = resolveInvestigationInputs(session, session.investigation, operation, { unpruned: operation !== 'threshold-analysis', sweep: operation === 'threshold-analysis' });
      expect(input.links.map(link => link.id)).toContain('AB'); // hidden by previous NN mask
      expect(input.links.map(link => link.id)).toContain('BC'); // distance above current threshold
      expect(input.links.map(link => link.id)).not.toContain('CD'); // explicit exclusion must survive
    });
  }
  it('uses complete origin membership for visible source rules while retaining enabled-layer eligibility', () => {
    const session = investigationFixture();
    session.data.nodes.forEach(node => node.visible = true);
    session.investigation.scopes.mst = 'visible';
    session.state.networkSubsetFilter.link = { enabled: true, field: 'origin', operator: 'equals', value: 'Genetic Distance' };
    expect(resolveInvestigationInputs(session, session.investigation, 'mst', { unpruned: true }).links.map(link => link.id)).toEqual(['AB', 'BC', 'CD']);
    session.investigation.edgeLayers[0].enabled = false;
    expect(resolveInvestigationInputs(session, session.investigation, 'mst', { unpruned: true }).links).toEqual([]);
  });
  it('keeps full and cohort calculations independent of explicit display link rules', () => {
    const session = investigationFixture();
    session.state.networkSubsetFilter.link = { enabled: true, field: 'review', operator: 'equals', value: 'no matches' };
    for (const [scope, expected] of [['full', ['AB', 'BC', 'AC', 'CD']], ['cohort', ['AB', 'BC', 'AC']]] as const) {
      session.investigation.scopes['network-statistics'] = scope;
      expect(resolveInvestigationInputs(session, session.investigation, 'network-statistics').links.map(link => link.id)).toEqual([...expected]);
    }
  });
  it('retains annotations and reports deleted targets as unresolved', () => {
    const session = investigationFixture();
    const note = session.investigation.annotations[0];
    expect(investigationAnnotationResolved(note, session, session.investigation)).toBeTrue();
    session.data.links = [];
    expect(investigationAnnotationResolved(note, session, session.investigation)).toBeFalse();
    expect(session.investigation.annotations.length).toBe(1);
  });
  it('retains tree and distance-matrix taxon eligibility inside each scope', () => {
    const session = investigationFixture();
    session.data.nodes[1].seq = '';
    session.data.nodes[2].visible = false;
    for (const operation of ['tree', 'distance-matrix'] as const) {
      for (const [scope, ids] of [['full', ['A', 'C', 'D']], ['visible', ['A']], ['cohort', ['A', 'C']]] as const) {
        session.investigation.scopes[operation] = scope;
        expect(resolveInvestigationInputs(session, session.investigation, operation).nodes.map(node => node._id)).toEqual([...ids]);
      }
      session.investigation.selectedCohortIds = ['one'];
      expect(resolveInvestigationInputs(session, session.investigation, operation).nodes.map(node => node._id)).toEqual(['A']);
      session.investigation.selectedCohortIds = ['one', 'two'];
    }
    session.data.nodes.forEach(node => node.seq = '');
    session.investigation.scopes.tree = 'cohort';
    expect(resolveInvestigationInputs(session, session.investigation, 'tree').nodes.map(node => node._id)).toEqual(['A', 'B', 'C']);
  });
  it('ignores positions and ordinary selection when fingerprinting analytical inputs', () => {
    const session = investigationFixture();
    const input = resolveInvestigationInputs(session, session.investigation, 'tree');
    const before = investigationInputKey(input, {});
    session.data.nodes[0].x = 900;
    session.data.nodes[0].selected = false;
    expect(investigationInputKey(input, {})).toBe(before);
    session.data.nodes[0].seq = 'TTTT';
    expect(investigationInputKey(input, {})).not.toBe(before);
  });
});

describe('Investigation portable sessions', () => {
  const sessions = new InvestigationSessionService();
  it('round-trips all state categories through JSON, preserving styles and stable membership', async () => {
    const session = investigationFixture();
    const computations = new InvestigationCalculationService(sessions);
    session.investigation.scopes.consensus = 'cohort';
    await computations.run(session, 'consensus', async () => 'ACGT', undefined, { sequence: true });
    const saved = await sessions.capture({ session, tabs: [{ label: '2D Network', tabTitle: '2D Network', isActive: true } as any], dashboardLayout: { root: { type: 'row' } } });
    const loaded = await sessions.prepare(JSON.parse(JSON.stringify(saved)));
    expect(loaded.session.investigation).toEqual(session.investigation);
    expect(loaded.session.style.widgets).toEqual({ ...session.style.widgets, 'tn93-distance-display-format': 'decimal' });
    expect(loaded.session.state).toEqual(session.state);
    expect(loaded.session.data.nodeFilter).toEqual(session.data.nodeFilter);
    expect(loaded.session.data.nodes).toEqual(session.data.nodes);
    expect(loaded.session.meta.rendererViewState).toEqual(session.meta.rendererViewState);
    expect(loaded.provenance.stateChecksum.length).toBe(64);
    expect(loaded.provenance.investigation.calculations.consensus.outputChecksum.length).toBe(64);
  });
  it('does not mutate live file contents or capture runtime handles and cyclic references', async () => {
    const session = investigationFixture();
    const bytes = new Uint8Array([0, 1, 128, 255]).buffer;
    session.files.push({ name: 'original.xlsx', extension: 'xlsx', contents: bytes });
    const runtime: any = { useful: 'data' }; runtime.cycle = runtime; runtime.callback = () => {};
    session.data.extra = runtime;
    session.meta.worker = { postMessage() {} };
    const saved = await sessions.capture({ session, tabs: [] });
    expect(session.files[1].contents).toBe(bytes);
    expect(session.files[1].extension).toBe('xlsx');
    expect(saved.session.data.extra).toEqual({ useful: 'data' });
    expect(saved.session.meta.worker).toBeUndefined();
    const loaded = await sessions.prepare(JSON.parse(JSON.stringify(saved)));
    expect(Array.from(new Uint8Array(loaded.session.files[1].contents))).toEqual([0, 1, 128, 255]);
  });
  it('accepts legacy envelopes and bare sessions with explicitly unrecorded provenance', async () => {
    for (const payload of [investigationFixture(), { session: investigationFixture(), tabs: [] }]) {
      const result = await sessions.prepare(payload);
      expect(result.session.investigationHistoricalProvenance).toBe('not recorded');
      expect(result.session.style.widgets['link-threshold']).toBe(3);
    }
  });
  it('rejects unknown versions, incomplete state, and missing required references', async () => {
    const saved = await sessions.capture({ session: investigationFixture(), tabs: [] });
    await expectAsync(sessions.prepare({ ...saved, schemaVersion: 99 })).toBeRejectedWithError(/Unsupported/);
    const missing = investigationCopy(saved);
    missing.investigation.cohorts[0].nodeIds.push('missing');
    await expectAsync(sessions.prepare(missing)).toBeRejectedWithError(/cohort/);
    const brokenEdge = investigationCopy(saved);
    brokenEdge.session.data.links[0].target = 'missing';
    await expectAsync(sessions.prepare(brokenEdge)).toBeRejectedWithError(/missing node/);
    await expectAsync(sessions.prepare({ ...saved, investigation: undefined })).toBeRejectedWithError(/incomplete/);
  });
  it('rejects changed contents even when the altered network is structurally valid', async () => {
    const saved = await sessions.capture({ session: investigationFixture(), tabs: [] });
    saved.session.data.nodes[0].seq = 'TTTT';
    await expectAsync(sessions.prepare(saved)).toBeRejectedWithError(/checksum/);
  });
  it('permits unresolved note targets while rejecting malformed annotations and layer styles', async () => {
    const session = investigationFixture();
    session.investigation.annotations[0].target.id = 'deleted-edge';
    await sessions.capture({ session, tabs: [] });
    session.investigation.edgeLayers[0].opacity = 2;
    await expectAsync(sessions.capture({ session, tabs: [] })).toBeRejectedWithError(/layer/);
  });
  it('escapes notes and names in the readable publication record', async () => {
    const saved = await sessions.capture({ session: investigationFixture(), tabs: [] });
    const html = sessions.readableRecord(saved.provenance);
    expect(html).toContain(saved.snapshotId);
    expect(html).toContain(saved.provenance.stateChecksum);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
  it('uses stable canonical hashes independent of object property insertion order', async () => {
    expect(await investigationChecksum({ b: 2, a: 1 })).toBe(await investigationChecksum({ a: 1, b: 2 }));
  });
  it('checks all manifest counts against stored and visible membership', async () => {
    const saved = await sessions.capture({ session: investigationFixture(), tabs: [] });
    for (const field of ['nodes', 'edges', 'visibleNodes', 'visibleEdges'] as const) {
      const changed = investigationCopy(saved);
      changed.provenance.counts[field]++;
      await expectAsync(sessions.prepare(changed)).toBeRejectedWithError(/counts do not match/);
    }
  });
  it('rejects malformed capture dates and software identity before restoring', async () => {
    const saved = await sessions.capture({ session: investigationFixture(), tabs: [] });
    for (const change of [
      (manifest: any) => manifest.capturedAt = 'invalid date',
      (manifest: any) => manifest.software = null,
      (manifest: any) => manifest.software.version = '',
      (manifest: any) => manifest.software.buildDate = 'invalid date',
      (manifest: any) => manifest.historicalProvenance = 'unknown',
    ]) {
      const changed = investigationCopy(saved);
      change(changed.provenance);
      await expectAsync(sessions.prepare(changed)).toBeRejectedWithError(/provenance metadata/);
    }
  });
  it('binds valid publication metadata values to the schema-2 checksum', async () => {
    const saved = await sessions.capture({ session: investigationFixture(), tabs: [] });
    expect(saved.schemaVersion).toBe(2);
    for (const change of [
      (manifest: any) => manifest.capturedAt = '2020-01-01T00:00:00.000Z',
      (manifest: any) => manifest.software.version = 'different version',
      (manifest: any) => manifest.software.commit = 'different commit',
      (manifest: any) => manifest.software.buildDate = '2020-01-01T00:00:00.000Z',
      (manifest: any) => manifest.historicalProvenance = 'not recorded',
    ]) {
      const changed = investigationCopy(saved);
      change(changed.provenance);
      await expectAsync(sessions.prepare(changed)).toBeRejectedWithError(/checksum/);
    }
    const downgraded = investigationCopy(saved);
    downgraded.schemaVersion = downgraded.provenance.schemaVersion = 1;
    await expectAsync(sessions.prepare(downgraded)).toBeRejectedWithError(/checksum/);
  });
  it('loads schema-1 state checksums, validates their counts, and upgrades on save', async () => {
    const saved = await sessions.capture({ session: investigationFixture(), tabs: [] });
    saved.schemaVersion = saved.provenance.schemaVersion = 1;
    saved.provenance.stateChecksum = await investigationChecksum({ schemaVersion: saved.schemaVersion,
      snapshotId: saved.snapshotId, session: saved.session, tabs: saved.tabs,
      dashboardLayout: saved.dashboardLayout, dashboardState: saved.dashboardState, investigation: saved.investigation });
    const loaded = await sessions.prepare(saved);
    expect(loaded.session.data.nodes.length).toBe(4);
    expect((await sessions.capture(loaded)).schemaVersion).toBe(2);
    saved.provenance.counts.nodes = 999;
    await expectAsync(sessions.prepare(saved)).toBeRejectedWithError(/counts do not match/);
  });
});

describe('Investigation calculation transactions', () => {
  const snapshots = new InvestigationSessionService();
  it('captures isolated input rows and preserves a completed output and its provenance', async () => {
    const service = new InvestigationCalculationService(snapshots);
    const session = investigationFixture();
    const before = JSON.stringify(session.data);
    await service.run(session, 'consensus', async inputs => {
      inputs.nodes[0].seq = 'CHANGED IN WORKER';
      return 'ACGT';
    }, undefined, { sequence: true });
    expect(JSON.stringify(session.data)).toBe(before);
    const run = session.investigation.calculations.consensus;
    expect(run.output).toBe('ACGT');
    expect(run.inputs.nodes[0].seq).toBe('ACGT');
    expect(run.inputChecksum.length).toBe(64);
    expect(run.status).toBe('completed');
  });
  it('does not apply a late result to another investigation', async () => {
    const service = new InvestigationCalculationService(snapshots);
    const session = investigationFixture();
    let current = session;
    const apply = jasmine.createSpy('apply');
    await expectAsync(service.run(session, 'consensus', async () => { current = investigationFixture(); return 'old'; }, apply, { sequence: true }, () => current))
      .toBeRejectedWithError(/cancelled/);
    expect(apply).not.toHaveBeenCalled();
    expect(session.investigation.calculations.consensus).toBeUndefined();
  });
  it('discards a run when its population or analytical parameters change', async () => {
    const service = new InvestigationCalculationService(snapshots);
    const session = investigationFixture();
    const apply = jasmine.createSpy('apply');
    await expectAsync(service.run(session, 'consensus', async () => { session.data.nodes[0].seq = 'TTTT'; return 'old'; }, apply, { sequence: true }))
      .toBeRejectedWithError(/cancelled/);
    expect(apply).not.toHaveBeenCalled();
  });
  it('keeps the previous completed result after a failed replacement', async () => {
    const service = new InvestigationCalculationService(snapshots);
    const session = investigationFixture();
    await service.run(session, 'consensus', async () => 'first', undefined, { sequence: true });
    const original = session.investigation.calculations.consensus;
    await expectAsync(service.run(session, 'consensus', async () => { throw new Error('worker failed'); }, undefined, { sequence: true })).toBeRejectedWithError('worker failed');
    expect(session.investigation.calculations.consensus).toBe(original);
  });
  it('marks results stale when scope changes and never returns a stale cached result', async () => {
    const service = new InvestigationCalculationService(snapshots);
    const session = investigationFixture();
    await service.run(session, 'consensus', async () => 'original', undefined, { sequence: true });
    expect(service.savedOutput(session, 'consensus', { sequence: true })).toBe('original');
    session.investigation.scopes.consensus = 'cohort';
    service.refreshStatus(session);
    expect(session.investigation.calculations.consensus.status).toBe('stale');
    expect(service.savedOutput(session, 'consensus', { sequence: true })).toBeUndefined();
  });
  it('waits for synchronous calculation provenance before capture', async () => {
    const service = new InvestigationCalculationService(snapshots);
    const session = investigationFixture();
    service.recordSynchronous(session, 'threshold-analysis', { thresholds: [1, 8] }, { sweep: true });
    await service.flush();
    expect(session.investigation.calculations['threshold-analysis'].inputChecksum.length).toBe(64);
  });
  it('rejects a manifest whose settings disagree with its snapshot', async () => {
    const saved = await snapshots.capture({ session: investigationFixture(), tabs: [] });
    saved.provenance.investigation.threshold.value = 99;
    await expectAsync(snapshots.prepare(saved)).toBeRejectedWithError(/manifest does not match/);
  });
  it('rejects source manifest drift', async () => {
    const saved = await snapshots.capture({ session: investigationFixture(), tabs: [] });
    saved.provenance.sources[0].sha256 = 'wrong';
    await expectAsync(snapshots.prepare(saved)).toBeRejectedWithError(/source manifest/);
  });
  it('does not replace a previous result when browser guardrails skip a calculation', async () => {
    const service = new InvestigationCalculationService(snapshots);
    const session = investigationFixture();
    await service.run(session, 'consensus', async () => 'first', undefined, { sequence: true });
    const original = session.investigation.calculations.consensus;
    await service.run(session, 'consensus', async () => ({ skipped: true }), undefined, { sequence: true });
    expect(session.investigation.calculations.consensus).toBe(original);
  });
});

describe('Investigation integration with live computation entrypoints', () => {
  function commonFixture(): any {
    const common: any = Object.create(CommonService.prototype);
    common.session = investigationFixture();
    common.session.data.nodeFields = [];
    common.session.data.linkFields = [];
    common.session.data.clusters = [];
    common.session.style.widgets['ambiguity-resolution-strategy'] = 'AVERAGE';
    common.session.style.widgets['ambiguity-threshold'] = 0.015;
    common.session.style.widgets['link-origin-array-order'] = [];
    common.investigationSessions = new InvestigationSessionService();
    common.investigationCalculations = new InvestigationCalculationService(common.investigationSessions);
    common.tempSkeleton = () => ({ matrix: {}, analysis: { version: 0, storedDistanceCache: {}, thresholdSweepCache: {}, patristicDistanceCache: {} } });
    common.temp = common.tempSkeleton();
    common.dataSkeleton = () => ({ nodes: [], links: [], nodeFields: [], linkFields: [], clusters: [] });
    common.decoder = new TextDecoder();
    common.uniq = values => Array.from(new Set(values));
    common.hasSeq = node => !!node.seq;
    common.recordPerformanceDuration = () => {};
    common.recordPerformanceTiming = () => {};
    common.buildWorkerTimingExtra = () => ({});
    common.computer = Object.fromEntries([['getAlignWorker', 'align'], ['getConsensusWorker', 'consensus'], ['getAmbiguityCountsWorker', 'ambiguityCounts'],
      ['getLinksWorker', 'links'], ['getTreeWorker', 'tree'], ['getMSTWorker', 'mst'], ['getNNWorker', 'nn']]
      .map(([method, task]) => [method, () => new InlineWorker(task as any)]));
    common.workerComputeService = new WorkerComputeService(common.computer);
    common.rebuildLinkMatrix();
    return common;
  }
  it('leaves the current investigation untouched after invalid restore validation', async () => {
    const common = commonFixture(), original = common.session;
    await expectAsync(common.applySession({ schemaVersion: 999, session: original, tabs: [] })).toBeRejectedWithError(/Unsupported/);
    expect(common.session).toBe(original);
    expect(common.sessionLoadError).toContain('Unsupported');
  });
  it('does not replace the open investigation when publication metadata is invalid', async () => {
    const common = commonFixture(), original = common.session;
    const saved = await common.investigationSessions.capture({ session: original, tabs: [] });
    saved.provenance.counts.nodes = 999;
    await expectAsync(common.applySession(saved)).toBeRejectedWithError(/counts do not match/);
    expect(common.session).toBe(original);
  });
  it('merges scoped ambiguity results by stable IDs despite different worker indices', async () => {
    const common = commonFixture();
    common.session.investigation.cohorts = [{ id: 'chosen', name: 'Chosen', nodeIds: ['B', 'D'] }];
    common.session.investigation.selectedCohortIds = ['chosen'];
    common.session.investigation.scopes.ambiguity = 'cohort';
    common.session.data.nodes[1].seq = 'AANN';
    common.session.data.nodes[0]._ambiguity = 0.123;
    await common.computeAmbiguityCounts();
    expect(common.session.data.nodes[1]._ambiguity).toBeCloseTo(0.5);
    expect(common.session.data.nodes[3]._ambiguity).toBe(0);
    expect(common.session.data.nodes[0]._ambiguity).toBe(0.123);
    expect(common.session.data.nodes[2]._ambiguity).toBeUndefined();
    expect(common.session.investigation.calculations.ambiguity.nodeIds).toEqual(['B', 'D']);
  });
  it('adds scoped pairwise distances while retaining unrelated source edges', async () => {
    const common = commonFixture();
    common.session.investigation.cohorts = [{ id: 'chosen', name: 'Chosen', nodeIds: ['B', 'D'] }];
    common.session.investigation.selectedCohortIds = ['chosen'];
    common.session.investigation.scopes['pairwise-distances'] = 'cohort';
    common.session.data.nodes[3].seq = 'ACTT';
    const original = JSON.stringify(common.session.data.links);
    await common.computeLinks(common.session.data.nodes);
    expect(common.session.data.links.find(link => link.source === 'D' && link.target === 'B' || link.source === 'B' && link.target === 'D')?.distance).toBe(1);
    expect(JSON.stringify(common.session.data.links.filter(link => link.id !== 'B-D'))).toBe(original);
    expect(common.session.investigation.calculations['pairwise-distances'].nodeIds).toEqual(['B', 'D']);
  });
  it('calculates nearest-neighbor structure before applying the previous nearest-neighbor mask', async () => {
    const common = commonFixture();
    common.session.investigation.cohorts = [{ id: 'chosen', name: 'Chosen', nodeIds: ['B', 'D'] }];
    common.session.investigation.selectedCohortIds = ['chosen'];
    common.session.investigation.scopes['pairwise-distances'] = 'cohort';
    common.session.investigation.scopes.mst = 'cohort';
    common.session.style.widgets['filtering-epsilon'] = -8;
    await common.computeLinks(common.session.data.nodes);
    common.session.style.widgets['link-show-nn'] = true;
    await common.computeMST();
    expect(common.session.data.links.find(link => link.id === 'B-D')?.nn).toBeTrue();
    expect(common.session.investigation.calculations.mst.nodeIds).toEqual(['B', 'D']);
  });
  it('does not overwrite saved threshold outputs while restoring a snapshot', async () => {
    const common = commonFixture();
    common.session.investigation.calculations['threshold-analysis'] = { id: 'saved-run', status: 'stale', output: { thresholds: [1, 3] } };
    common.session.meta.restoredCalculationIds = ['saved-run'];
    const result = common.getThresholdSweepSummary();
    expect(result.thresholds).toEqual([1, 3]);
    expect(common.session.investigation.calculations['threshold-analysis'].id).toBe('saved-run');
  });
  it('does not bypass visible edge rules through imported-tree MST or matrix shortcuts', async () => {
    const common = commonFixture();
    common.session.data.nodes.forEach(node => node.visible = true);
    common.session.data.links.forEach(link => { link.review = link.id === 'AC' ? 'exclude' : 'include'; link.nn = false; });
    Object.assign(common.session.data.links.find(link => link.id === 'AC'), {
      distance: 0.5, hasDistance: true, origin: ['Genetic Distance'], distanceOrigin: 'Genetic Distance',
    });
    common.session.data.newickString = '((A:1,C:1):1,(B:1,D:1):1);';
    common.session.data.newick = common.session.data.newickString;
    common.session.data.newickSource = 'newick';
    common.session.files = [{ name: 'tree.nwk', format: 'newick' }];
    common.session.state.networkSubsetFilter.link = { enabled: true, field: 'review', operator: 'equals', value: 'include' };
    common.session.style.widgets['filtering-epsilon'] = -8;
    common.session.investigation.scopes.mst = 'visible';
    common.session.investigation.scopes['distance-matrix'] = 'visible';
    common.session.investigation.scopes.tree = 'visible';
    const treeShortcut = spyOn(common.workerComputeService, 'computePatristicNearestNeighborEdges').and.callThrough();
    await common.computeMST();
    expect(treeShortcut).not.toHaveBeenCalled();
    expect(common.session.investigation.calculations.mst.edgeIds).toEqual(['AB', 'BC', 'CD']);
    expect(common.session.data.links.find(link => link.id === 'AC').nn).toBeFalse();
    const { dm, labels } = await common.getDM();
    expect(dm[labels.indexOf('A')][labels.indexOf('C')]).toBeNull();
    await expectAsync(common.computeTree()).toBeRejectedWithError(/complete distance matrix/);
    expect(common.session.data.newickString).toBe('((A:1,C:1):1,(B:1,D:1):1);');
  });
  it('applies explicit visible link rules to cached virtual Newick sweep pairs', async () => {
    const common = commonFixture();
    common.session.data.nodes.forEach(node => node.visible = true);
    common.session.data.links.forEach(link => link.review = link.id === 'BC' ? 'exclude' : 'include');
    common.session.data.newickString = '(A:1,B:1,C:1,D:1);';
    common.session.files = [{ name: 'tree.nwk', format: 'newick' }];
    common.session.investigation.edgeLayers.push({ id: 'tree', source: 'tree.nwk', name: 'Tree', enabled: true });
    common.session.state.networkSubsetFilter.link = { enabled: true, field: 'review', operator: 'equals', value: 'include' };
    common.session.investigation.scopes['threshold-analysis'] = 'visible';
    common.setPatristicThresholdAnalysisEdges('distance', ['A', 'B', 'C', 'D'], [
      { sourceIndex: 0, targetIndex: 1, value: 1 }, { sourceIndex: 1, targetIndex: 2, value: 2 },
      { sourceIndex: 2, targetIndex: 3, value: 3 },
    ]);
    expect(common.getThresholdSweepSummary().thresholds).toEqual([1, 3]);
    await common.investigationCalculations.flush();
  });
  it('uses cached Newick pair distances before rendered edges exist and respects their source layer', async () => {
    const common = commonFixture();
    common.session.data.links = [];
    common.session.data.newickString = '(A:1,B:1,C:1,D:1);';
    common.session.files = [{ name: 'tree.nwk', format: 'newick' }];
    common.session.investigation.edgeLayers[1].enabled = false;
    common.session.investigation.edgeLayers.push({ id: 'tree', source: 'tree.nwk', name: 'Tree', enabled: true });
    common.setPatristicThresholdAnalysisEdges('distance', ['A', 'B', 'C', 'D'], [
      { sourceIndex: 0, targetIndex: 1, value: 1 }, { sourceIndex: 1, targetIndex: 2, value: 2 },
      { sourceIndex: 2, targetIndex: 3, value: 3 },
    ]);
    expect(common.getThresholdSweepSummary().thresholds).toEqual([1, 2, 3]);
    await common.investigationCalculations.flush();
    common.session.investigation.edgeLayers[2].enabled = false;
    expect(common.getThresholdSweepSummary().thresholds).toEqual([]);
    await common.investigationCalculations.flush();
  });
  it('finishes importing a sparse graph when optional automatic tree inference lacks distances', async () => {
    const common = commonFixture();
    common.finishUp = jasmine.createSpy('finishUp').and.callFake(async () => {});
    await common.runHamsters();
    expect(common.finishUp).toHaveBeenCalled();
    expect(common.session.warnings[0].message).toContain('complete distance matrix');
    expect(common.session.data.newickString).toBeUndefined();
    expect(common.session.investigation.calculations.tree).toBeUndefined();
  });
  it('does not finish or write an automatic tree into a replacement investigation', async () => {
    const common = commonFixture();
    const replacement = investigationFixture();
    common.computeTree = async () => { common.session = replacement; return '(A:1,B:1);'; };
    common.finishUp = jasmine.createSpy('finishUp');
    await common.runHamsters();
    expect(common.finishUp).not.toHaveBeenCalled();
    expect(replacement.data.newickString).toBeUndefined();
    expect(replacement.warnings).toBeUndefined();
  });
  it('applies warning removals without restoring unrelated warnings removed during calculation', async () => {
    const common = commonFixture();
    common.session.warnings = [{ id: 'old-budget', message: 'Budget exceeded' }, { id: 'other-operation', message: 'Old warning' }];
    await common.runScopedAnalysis('patristic', async context => {
      context.session.warnings = context.session.warnings.filter(warning => warning.id !== 'old-budget');
      context.session.warnings.push({ id: 'new-warning', message: 'Calculation warning' });
      common.session.warnings = [{ id: 'parallel-warning', message: 'Concurrent warning' }];
      return null;
    });
    expect(common.session.warnings.map(warning => warning.id)).toEqual(['parallel-warning', 'new-warning']);
  });
});
