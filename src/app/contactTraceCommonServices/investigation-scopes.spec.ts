import * as patristic from 'patristic';
import { CommonService } from './common.service';
import { InvestigationCalculationService } from './investigation-calculation.service';
import { InvestigationSessionService } from './investigation-session.service';
import { CalculationScope, createInvestigationWorkspace, INVESTIGATION_OPERATIONS, InvestigationOperation } from './investigation-state';
import { WorkerComputeService } from './worker-compute.service';
import { WorkerModule } from '../workers/workModule';
import { PhylogeneticComponent } from '../visualizationComponents/PhylogeneticComponent/phylogenetic-plugin.component';
import { NetworkStatisticsComponent } from '../visualizationComponents/NetworkStatisticsComponent/network-statistics-plugin.component';
import { collectLeafIds, collectTreeSplitKeys } from '../workers/phylogenetic-bootstrap-utils';

// Coordinates on a line give independently known distance matrices and unique
// MST/nearest-neighbor backbones. G has no sequence and must never enter sequence work.
const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const coordinates = [1, 2, 4, 8, 16, 32, 64];
const sequences = ['AAAAAAAA', 'AAAANAAA', 'AAAACCCC', 'CCCCAAAA', 'CCCCCCCC', 'CCCCCCCC'];
const populations = { full: ids, visible: ['A', 'B', 'C', 'D'], cohort: ['C', 'D', 'E', 'F'] };
const sequenceOperations = ['alignment', 'ambiguity', 'consensus', 'consensus-distances', 'pairwise-distances', 'bootstrap'];
const sequenceTaxa = (scope: CalculationScope) => populations[scope].filter(id => id !== 'G');
const pairs = (members: string[]) => members.flatMap((source, index) => members.slice(index + 1).map(target => `${source}-${target}`));
const distance = (source: string, target: string) => Math.abs(coordinates[ids.indexOf(source)] - coordinates[ids.indexOf(target)]);
const treeFor = (members: string[]) => `(${[0, 2, 4, 6].flatMap(index => {
  const pair = ids.slice(index, index + 2).filter(id => members.includes(id));
  return pair.length === 2 ? [`(${pair[0]}:1,${pair[1]}:1):1`] : pair.map(id => `${id}:1`);
}).join(',')});`;

function fixture(): any {
  const common: any = Object.create(CommonService.prototype);
  const investigation = createInvestigationWorkspace();
  investigation.cohorts = [{ id: 'left', name: 'Left', nodeIds: ['C', 'D', 'E'] }, { id: 'right', name: 'Right', nodeIds: ['D', 'E', 'F'] }];
  investigation.selectedCohortIds = ['left', 'right'];
  investigation.edgeLayers = [{ id: 'genetic', source: 'Genetic Distance', name: 'Genetic', enabled: true },
    { id: 'disabled', source: 'Excluded source', name: 'Disabled', enabled: false }];
  common.session = { data: {
    nodes: ids.map((_id, index) => ({ _id, id: _id, index, seq: sequences[index], visible: index < 4, selected: false })),
    links: pairs(ids).map((id, index) => ({ id, index, source: id[0], target: id[2], distance: distance(id[0], id[2]),
      visible: populations.visible.includes(id[0]) && populations.visible.includes(id[2]),
      origin: ['Genetic Distance'], hasDistance: true, distanceOrigin: 'Genetic Distance' })),
    nodeFields: [], linkFields: [], clusters: [], nodeExclusions: [], consensus: 'AAAAAAAA', reference: 'AAAAAAAA',
  }, state: {}, files: [], network: {}, meta: {}, investigation, style: { widgets: {
    'link-threshold': 100, 'link-sort-variable': 'distance', 'default-distance-metric': 'snps', 'link-show-nn': false,
    'ambiguity-resolution-strategy': 'AVERAGE', 'ambiguity-threshold': 0.015, 'filtering-epsilon': -8,
    'link-origin-array-order': [], 'tree-round': 12,
  } } };
  common.session.data.links.push({ id: 'disabled-edge', source: 'A', target: 'G', distance: 0,
    hasDistance: true, distanceOrigin: 'Excluded source', origin: ['Excluded source'], visible: true });
  common.investigationSessions = new InvestigationSessionService();
  common.investigationCalculations = new InvestigationCalculationService(common.investigationSessions);
  common.tempSkeleton = () => ({ matrix: {}, analysis: { version: 0, storedDistanceCache: {}, thresholdSweepCache: {}, patristicDistanceCache: {} } });
  common.temp = common.tempSkeleton();
  common.dataSkeleton = () => ({ nodes: [], links: [], nodeFields: [], linkFields: [], clusters: [] });
  common.decoder = new TextDecoder();
  common.uniq = values => Array.from(new Set(values));
  common.recordPerformanceDuration = () => {};
  common.recordPerformanceTiming = () => {};
  common.buildWorkerTimingExtra = () => ({});
  // Skip the unrelated CSV worker constructor; calculation workers are real.
  common.computer = Object.create(WorkerModule.prototype);
  common.workerComputeService = new WorkerComputeService(common.computer);
  common.rebuildLinkMatrix();
  return common;
}

function bootstrapView(common: any, members: string[]): any {
  const view: any = Object.create(PhylogeneticComponent.prototype);
  view.commonService = common;
  view.workerComputeService = common.workerComputeService;
  view.tree = { data: patristic.parseNewick(treeFor(members)) };
  view.cdref = { detectChanges() {} };
  view.SelectedBootstrapCustomReplicates = 2;
  view.SelectedBootstrapStopWhenStable = false;
  view.SelectedBootstrapDecimalLength = 1;
  // Only rendering is omitted: eligibility, scope capture, workers, metadata and
  // the result transaction all use the production implementation.
  view.applyStoredBootstrapSupport = () => {};
  return view;
}

async function run(common: any, operation: InvestigationOperation, scope: CalculationScope): Promise<void> {
  common.session.investigation.scopes[operation] = scope;
  switch (operation) {
    case 'network-statistics': await common.computeInvestigationStatistics(); break;
    case 'threshold-analysis': common.recalculateInvestigationThreshold(); await common.investigationCalculations.flush(); break;
    case 'mst': await common.computeMST(); break;
    case 'nearest-neighbor': await common.computeNN(); break;
    case 'directionality': common.session.data.newickString = treeFor(populations[scope]); await common.computeDirectionality(); break;
    case 'alignment': await common.align({ nodes: common.session.data.nodes, reference: 'AAAAAAAA', aligner: 'bioseq', match: [1, -1], gap: [-1, -0.5] }); break;
    case 'ambiguity': await common.computeAmbiguityCounts(); break;
    case 'consensus': await common.computeConsensus(); break;
    case 'consensus-distances': await common.computeConsensusDistances(); break;
    case 'pairwise-distances': await common.computeLinks(common.session.data.nodes); break;
    case 'distance-matrix': await common.getDM(); break;
    case 'tree': await common.computeTree(); break;
    case 'patristic':
      // Generate distances into an empty graph, avoiding existing genetic-distance
      // merge precedence. Node scope still restricts the imported full tree.
      common.session.data.links = [];
      common.rebuildLinkMatrix();
      common.session.data.newickString = treeFor(ids);
      await common.computePatristicForSource(100, { origin: ['Genetic Distance'], distanceOrigin: 'Genetic Distance' }); break;
    case 'bootstrap':
      // Every column has the same known split; resampling cannot change it.
      common.session.data.nodes.forEach(node => { if (node.seq) node.seq = (ids.indexOf(node._id) < 2 ? 'A' : ids.indexOf(node._id) < 4 ? 'C' : 'G').repeat(8); });
      await bootstrapView(common, sequenceTaxa(scope)).calculateBootstrapSupport({ skipConfirmation: true }); break;
  }
}

describe('Investigation calculation scope matrix (real workers)', () => {
  let common: any;
  beforeEach(() => { common = fixture(); });
  afterEach(() => { common.workerComputeService.terminatePatristicWorker(); common.workerComputeService.cancelPhylogeneticBootstrapJob(); });

  for (const operation of INVESTIGATION_OPERATIONS.map(item => item.id)) {
    for (const scope of ['full', 'visible', 'cohort'] as CalculationScope[]) {
      it(`${operation}: preserves exact ${scope} inputs and the expected completed output`, async () => {
        const members = sequenceOperations.includes(operation) || ['tree', 'distance-matrix'].includes(operation) ? sequenceTaxa(scope) : populations[scope];
        const expectedEdges = sequenceOperations.includes(operation) || operation === 'patristic' ? [] : pairs(members);
        await run(common, operation, scope);
        const record = common.session.investigation.calculations[operation];
        expect(record).withContext(`${operation} must complete rather than skip`).toBeDefined();
        expect(record.status).toBe('completed');
        expect(record.scope).toBe(scope);
        expect(record.nodeIds).toEqual(members);
        expect([...record.edgeIds].sort()).toEqual([...expectedEdges].sort());
        expect(record.cohortIds).toEqual(scope === 'cohort' ? ['left', 'right'] : []);
        expect(record.inputs.nodes.map(node => node._id)).toEqual(members);
        expect(record.inputChecksum).toMatch(/^[a-f0-9]{64}$/);
        const output = record.output;
        switch (operation) {
          case 'network-statistics':
            expect(output.summary.nodeCount).toBe(members.length);
            expect(output.summary.linkCount).toBe(expectedEdges.length);
            expect(output.summary.componentCount).toBe(1); break;
          case 'threshold-analysis':
            expect(output.thresholds).toEqual(Array.from(new Set(expectedEdges.map(id => distance(id[0], id[2])))).sort((a, b) => a - b));
            expect(output.componentCounts[output.componentCounts.length - 1]).toBe(1); break;
          case 'mst': case 'nearest-neighbor':
            expect(output.links.filter(link => link.nn).map(link => link.id).sort()).toEqual(members.slice(1).map((id, index) => `${members[index]}-${id}`).sort()); break;
          case 'directionality':
            // G attaches directly to the root and precedes the deeper paired leaves.
            expect(output.links.map(link => [link.id, link.source, link.target])).toEqual(expectedEdges.map(id =>
              id[2] === 'G' ? [id, 'G', id[0]] : [id, id[0], id[2]])); break;
          case 'alignment':
            expect(output.value.map(node => node._id)).toEqual(members);
            if (members.includes('A')) expect(output.nodes.find(node => node._id === 'A')).toEqual(jasmine.objectContaining({ _seq: 'AAAAAAAA', _score: 8 })); break;
          case 'ambiguity':
            expect(output.nodes).toEqual(members.map(_id => ({ _id, _ambiguity: _id === 'B' ? 0.125 : 0 }))); break;
          case 'consensus': expect(output.value).toBe(scope === 'visible' ? 'AAAAAAAA' : 'CCCCCCCC'); break;
          case 'consensus-distances':
            expect(output.nodes).toEqual(members.map(_id => ({ _id, _diff: { A: 0, B: 1, C: 4, D: 4, E: 8, F: 8 }[_id] }))); break;
          case 'pairwise-distances':
            expect(output.links.length).toBe(members.length * (members.length - 1) / 2);
            for (const link of output.links) {
              const left = sequences[ids.indexOf(link.source)], right = sequences[ids.indexOf(link.target)];
              expect(link.distance).toBe([...left].filter((letter, i) => letter !== right[i]).length);
            } break;
          case 'distance-matrix':
            expect(output.value.labels).toEqual(members);
            expect(output.value.dm).toEqual(members.map(source => members.map(target => distance(source, target)))); break;
          case 'tree': {
            const tree = patristic.parseNewick(output.value);
            expect(collectLeafIds(tree)).toEqual([...members].sort());
            const matrix = tree.toMatrix();
            matrix.ids.forEach((source, i) => matrix.ids.forEach((target, j) => expect(matrix.matrix[i][j]).toBeCloseTo(distance(source, target), 5))); break;
          }
          case 'patristic':
            expect(output.links.map(link => link.id).sort()).toEqual(pairs(members).sort());
            for (const link of output.links) expect(link.distance).toBe(Math.floor(ids.indexOf(link.source) / 2) === Math.floor(ids.indexOf(link.target) / 2) ? 2 : [link.source, link.target].includes('G') ? 3 : 4);
            break;
          case 'bootstrap':
            expect(output.completedReplicates).toBe(2);
            expect(Object.keys(output.supportBySplitKey).sort()).toEqual(collectTreeSplitKeys(patristic.parseNewick(treeFor(members)), members));
            expect(Object.values(output.supportBySplitKey).every(value => value === 100)).toBeTrue();
            expect(common.session.data.phylogeneticBootstrap.labels).toEqual([...members].sort()); break;
        }
        // Each real result, its exact inputs and status must survive capture/migration.
        const saved = await common.investigationSessions.capture({ session: common.session, tabs: [] });
        const restored = await common.investigationSessions.prepare(JSON.parse(JSON.stringify(saved)));
        expect(restored.session.investigation.calculations[operation]).toEqual(record);
      }, 20000);
    }
  }

  for (const scope of ['full', 'visible', 'cohort'] as CalculationScope[]) {
    it(`rejects a bootstrap base tree with the wrong ${scope} taxa without launching work`, async () => {
      common.session.investigation.scopes.bootstrap = scope;
      const view = bootstrapView(common, scope === 'full' ? populations.visible : sequenceTaxa('full'));
      const compute = spyOn(common.workerComputeService, 'computePhylogeneticBootstrap').and.callThrough();
      await view.calculateBootstrapSupport({ skipConfirmation: true });
      expect(view.BootstrapStatusMessage).toContain('base tree matching the calculation scope');
      expect(compute).not.toHaveBeenCalled();
      expect(common.session.investigation.calculations.bootstrap).toBeUndefined();
    });
  }
  for (const operation of sequenceOperations.filter(id => id !== 'bootstrap') as InvestigationOperation[]) {
    it(`${operation}: explains an empty eligible sequence population without widening scope`, async () => {
      common.session.data.nodes.forEach(node => { if (populations.visible.includes(node._id)) delete node.seq; });
      await expectAsync(run(common, operation, 'visible')).toBeRejectedWithError(/visible scope contains no eligible sequences/);
      expect(common.session.investigation.calculations[operation]).toBeUndefined();
      expect(common.session.data.nodes.find(node => node._id === 'E').seq).toBe('CCCCCCCC');
    });
  }
  it('rejects bootstrap with no eligible sequences and tree inference with one eligible taxon', async () => {
    common.session.investigation.scopes.bootstrap = 'visible';
    common.session.data.nodes.forEach(node => { if (populations.visible.includes(node._id)) delete node.seq; });
    const view = bootstrapView(common, populations.visible);
    await view.calculateBootstrapSupport({ skipConfirmation: true });
    expect(view.BootstrapStatusMessage).toContain('visible scope contains no eligible sequences');
    common.session.data.nodes[0].seq = 'AAAAAAAA';
    await expectAsync(run(common, 'tree', 'visible')).toBeRejectedWithError(/at least two eligible nodes/);
  });

  it('explains insufficient bootstrap taxa and unequal sequence lengths without launching work', async () => {
    common.session.investigation.scopes.bootstrap = 'visible';
    const compute = spyOn(common.workerComputeService, 'computePhylogeneticBootstrap').and.callThrough();
    common.session.data.nodes.forEach(node => node.visible = ['A', 'B'].includes(node._id));
    const tooSmall = bootstrapView(common, ['A', 'B']);
    await tooSmall.calculateBootstrapSupport({ skipConfirmation: true });
    expect(tooSmall.BootstrapStatusMessage).toContain('at least 3 tree leaves');
    common.session.data.nodes.forEach(node => node.visible = populations.visible.includes(node._id));
    common.session.data.nodes[0].seq = 'A';
    const unequal = bootstrapView(common, populations.visible);
    await unequal.calculateBootstrapSupport({ skipConfirmation: true });
    expect(unequal.BootstrapStatusMessage).toContain('equal-length aligned sequences');
    expect(compute).not.toHaveBeenCalled();
    expect(common.session.investigation.calculations.bootstrap).toBeUndefined();
  });

  it('replaces a cached tree for different scoped taxa and reuses it only for matching inputs', async () => {
    await run(common, 'tree', 'full');
    const original = common.session.investigation.calculations.tree;
    common.session.data.newickString = original.output.value;
    const worker = spyOn(common.computer, 'getTreeWorker').and.callThrough();
    await run(common, 'tree', 'cohort');
    const replacement = common.session.investigation.calculations.tree;
    expect(replacement.id).not.toBe(original.id);
    expect(collectLeafIds(patristic.parseNewick(replacement.output.value))).toEqual(populations.cohort);
    expect(worker).toHaveBeenCalledTimes(1);
    expect(await common.computeTree()).toBe(replacement.output.value);
    expect(common.session.investigation.calculations.tree.id).toBe(replacement.id);
    expect(worker).toHaveBeenCalledTimes(1);
    expect(common.session.data.nodes.map(node => node._id)).toEqual(ids);
  });

  for (const status of ['completed', 'stale'] as const) {
    it(`renders restored ${status} statistics and threshold outputs without launching calculations`, async () => {
      await run(common, 'network-statistics', 'visible');
      await run(common, 'threshold-analysis', 'visible');
      if (status === 'stale') {
        common.session.investigation.scopes['network-statistics'] = 'cohort';
        common.session.investigation.scopes['threshold-analysis'] = 'cohort';
        common.investigationCalculations.refreshStatus(common.session);
      }
      const expected = JSON.parse(JSON.stringify(common.session.investigation.calculations));
      const saved = await common.investigationSessions.capture({ session: common.session, tabs: [] });
      common.session = (await common.investigationSessions.prepare(JSON.parse(JSON.stringify(saved)))).session;
      common.session.meta.restoredCalculationIds = Object.values(expected).map((record: any) => record.id);
      const launches = spyOn(common.investigationCalculations, 'run').and.callThrough();
      const worker = spyOn(common.workerComputeService, 'computeNetworkStatistics').and.callThrough();
      // Only table/DOM rendering is stubbed; refresh follows the actual view path.
      const view: any = Object.create(NetworkStatisticsComponent.prototype);
      Object.assign(view, { commonService: common, cdref: { detectChanges() {} }, networkStatisticsRequestId: 0,
        isDestroyed: false, syncSelectedTableData() {}, markNetworkStatisticsRendered() {} });
      await view.refreshNetworkStatistics();
      expect(view.networkStatisticsLoading).toBeFalse();
      expect(view.networkStatisticsResult).toEqual(expected['network-statistics'].output);
      expect(view.networkStatisticsError).toBe(status === 'stale'
        ? 'This saved result is stale. Run network statistics again to use the current investigation inputs.' : '');
      expect(common.getThresholdSweepSummary()).toEqual(expected['threshold-analysis'].output);
      expect(common.session.investigation.calculations).toEqual(expected);
      expect(launches).not.toHaveBeenCalled();
      expect(worker).not.toHaveBeenCalled();
    });
  }
});
