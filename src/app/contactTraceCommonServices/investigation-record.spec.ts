import { readableInvestigationRecord } from './investigation-record';
import type { InvestigationManifest, InvestigationOperation } from './investigation-state';
import type { InvestigationReportResults } from './investigation-record';
import { computeNetworkStatistics } from './network-statistics';

function recordFixture(): InvestigationManifest {
  return {
    schemaVersion: 2, snapshotId: 'snapshot-123', capturedAt: '2026-10-30T14:15:16Z', stateChecksum: 'a'.repeat(64),
    software: { name: 'MicrobeTrace', version: '2.4.0', commit: 'build-123', buildDate: '2026-10-29T12:00:00Z' },
    counts: { nodes: 4, edges: 3, visibleNodes: 2, visibleEdges: 1 }, historicalProvenance: 'not recorded',
    sources: [{ name: 'nodes.csv', sha256: 'b'.repeat(64), representation: 'canonical saved content' }],
    investigation: {
      threshold: { value: 3, metric: 'distance', distanceMetric: 'snps', displayFormat: 'decimal', nearestNeighbor: false },
      filters: { state: { timeStart: 0, networkSubsetFilter: { node: { enabled: true, field: 'Region', operator: 'equals', value: 'North' } } }, exclusions: ['D'], minimumClusterSize: 2, tables: {} },
      layout: { tabs: [{ label: '2D Network', isActive: true }], nodes: ['A', 'B', 'C', 'D'].map((id, index) => ({ id, x: index, y: index, fixed: index === 0, selected: index < 2 })), widgets: {}, network: { allPinned: false, timelinePinned: false }, camera: null, legacyLayout: {} },
      grouping: { widgets: { 'polygons-foci': 'Region' }, groups: [{ id: 'north', label: 'North', field: 'Region', nodeIds: ['A', 'B'] }] },
      cohorts: [{ id: 'one', name: 'First cohort', nodeIds: ['A', 'B'] }, { id: 'two', name: 'Second cohort', nodeIds: ['B', 'C'] }],
      selectedCohortIds: ['one', 'two'], edgeLayers: [{ id: 'genetic', source: 'Genetic Distance', name: 'Genetic', enabled: true, opacity: 0.4 }],
      annotations: [{ id: 'note', target: { type: 'node', id: 'missing' }, text: 'Review this node.\nFollow up next week.', createdAt: '2026-10-30T12:00:00Z', updatedAt: '2026-10-30T13:00:00Z' }],
      scopes: { 'network-statistics': 'full' }, viewStates: {}, calculations: {
        'network-statistics': {
          id: 'run-123', operation: 'network-statistics', scope: 'cohort', cohortIds: ['one', 'two'], nodeIds: ['A', 'B', 'C'], edgeIds: ['AB'],
          parameters: { seed: 42, __scopeOptions: { sequence: false } }, inputChecksum: 'c'.repeat(64), currentInputKey: 'internal-key',
          startedAt: '2026-10-30T12:00:00Z', completedAt: '2026-10-30T12:01:00Z', status: 'stale',
          software: { name: 'MicrobeTrace', version: '2.3.0', commit: 'earlier-build', buildDate: '2026-10-20T12:00:00Z' }, outputChecksum: 'd'.repeat(64),
        },
      },
    },
  };
}
function documentFor(manifest = recordFixture(), results?: InvestigationReportResults): Document {
  return new DOMParser().parseFromString(readableInvestigationRecord(manifest, [], results), 'text/html');
}
function resultRecords(manifest: InvestigationManifest, outputs: Partial<Record<InvestigationOperation, any>>): InvestigationReportResults {
  return { calculations: Object.fromEntries(Object.entries(outputs).map(([operation, output]) => [operation,
    { ...manifest.investigation.calculations[operation], inputs: { nodes: [], links: [] }, output }])) };
}
function numericalCells(parent: Element): Record<string, string> {
  return Object.fromEntries(Array.from(parent.querySelectorAll('tbody tr')).map(row => {
    const cells = row.querySelectorAll('td');
    return [cells[0].textContent, cells[1].textContent];
  }));
}

describe('Readable investigation record', () => {
  it('shows saved numerical statistics with their original scope and stale status, without changing the records', () => {
    const manifest = recordFixture();
    const result = computeNetworkStatistics({ nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], links: [{ source: 'A', target: 'B' }], metricLabel: 'SNPs', threshold: 2 });
    const records = resultRecords(manifest, { 'network-statistics': result });
    manifest.investigation.calculations['network-statistics'].parameters['default-distance-metric'] = 'snps';
    manifest.investigation.calculations['network-statistics'].staleReasons = ['Enabled relationship layers changed.'];
    const before = JSON.stringify({ manifest, records });
    const findings = documentFor(manifest, records).querySelector('#findings');
    const cells = numericalCells(findings);
    expect(cells['Nodes']).toBe('3'); expect(cells['Relationships']).toBe('1');
    expect(cells['Connected components']).toBe('2'); expect(cells['Clusters']).toBe('1');
    expect(cells['Singleton nodes']).toBe('1'); expect(cells['Largest cluster (nodes)']).toBe('2');
    expect(cells['Network density']).toBe('0.333333');
    expect(cells['Average degree']).toBe('0.666667');
    expect(cells['Threshold when run']).toBe('2');
    expect(cells['Distance metric when run']).toBe('SNPs');
    expect(findings.textContent).toContain('Scope when run: Selected cohorts');
    expect(findings.textContent).not.toContain('Full network');
    expect(findings.textContent).toContain('Status at snapshot capture: Stale — retained');
    expect(findings.textContent).toContain('Enabled relationship layers changed.');
    expect(findings.textContent).toContain('run-123');
    expect(JSON.stringify({ manifest, records })).toBe(before);
  });
  it('labels every saved scope and reports approximation beside the affected numerical values', () => {
    for (const [scope, title] of [['full', 'Full network'], ['visible', 'Visible network'], ['cohort', 'Selected cohorts']] as const) {
      const manifest = recordFixture();
      manifest.investigation.calculations['network-statistics'].scope = scope;
      manifest.investigation.calculations['network-statistics'].status = 'completed';
      const records = resultRecords(manifest, { 'network-statistics': { summary: { nodeCount: 3, averagePathLength: 1.25,
        diameter: 2, approximatePathMetrics: true, sampledSourceCount: 2 } } });
      const findings = documentFor(manifest, records).querySelector('#findings');
      expect(findings.textContent).toContain(`Scope when run: ${title}`);
      expect(findings.textContent).toContain('Status at snapshot capture: Completed');
      expect(numericalCells(findings)['Average reachable path length (approximate)']).toBe('1.25');
      expect(numericalCells(findings)['Diameter (approximate)']).toBe('2');
      expect(findings.textContent).toContain('estimated from 2 sampled source nodes');
    }
  });
  it('shows every stored sweep point and the recorded recommendation rather than using the current threshold', () => {
    const manifest = recordFixture();
    manifest.investigation.calculations['threshold-analysis'] = { ...manifest.investigation.calculations['network-statistics'],
      id: 'sweep-1', operation: 'threshold-analysis', scope: 'full', status: 'completed', parameters: { 'default-distance-metric': 'snps' } };
    const records = resultRecords(manifest, { 'threshold-analysis': { metric: 'distance', thresholds: [0, 1, 5],
      componentCounts: [3, 2, 1], clusterCounts: [0, 1, 1], singletonCounts: [3, 1, 0], largestClusterSizes: [0, 2, 3],
      componentStructureScores: [0, 0.75, 0.2], recommendedIndex: 1 } });
    const result = documentFor(manifest, records).querySelector('#findings [data-operation="threshold-analysis"]');
    const cells = numericalCells(result);
    expect(cells['Distance metric when run']).toBe('SNPs');
    expect(cells['Recorded sweep range']).toBe('0 to 5');
    expect(cells['Recommended threshold (saved)']).toBe('1');
    expect(cells['Clusters at recommendation']).toBe('1');
    expect(cells['Singletons at recommendation']).toBe('1');
    expect(cells['Structure score at recommendation']).toBe('0.75');
    expect(result.querySelector('details').open).toBeFalse();
    expect(Array.from(result.querySelectorAll('details tbody tr')).map(row => Array.from(row.querySelectorAll('td')).map(cell => cell.textContent)))
      .toEqual([['0', '3', '0', '3', '0', '0', '—'], ['1', '2', '1', '1', '2', '0.75', 'Recommended'], ['5', '1', '1', '0', '3', '0.2', '—']]);
  });
  it('keeps historical figure findings separate from replacement calculations and reports status at export', () => {
    const manifest = recordFixture(), archived = recordFixture();
    const archiveRun = archived.investigation.calculations['network-statistics'];
    archiveRun.id = 'original-run'; archiveRun.status = 'completed'; archiveRun.scope = 'visible';
    archiveRun.nodeIds = ['A', 'B'];
    const original = resultRecords(archived, { 'network-statistics': { summary: { nodeCount: 2, linkCount: 1 } } });
    manifest.investigation.figureEvidence = { archive: { path: 'figure-evidence/archive.json', inputChecksum: 'x', counts: { nodes: 2, edges: 1 },
      sources: [], cohorts: [], selectedCohortIds: [], edgeLayers: [], scopes: {}, calculations: archived.investigation.calculations } };
    const current = resultRecords(manifest, { 'network-statistics': { summary: { nodeCount: 3, linkCount: 2 } } });
    current.figureEvidence = { archive: { version: 1, data: { nodes: [], links: [] }, files: [], cohorts: [], selectedCohortIds: [], edgeLayers: [], scopes: {}, calculations: original.calculations } };
    const doc = documentFor(manifest, current);
    expect(numericalCells(doc.querySelector('#findings'))['Nodes']).toBe('3');
    const historical = doc.querySelector('#evidence-archive .numerical-result');
    expect(numericalCells(historical)['Nodes']).toBe('2');
    expect(historical.textContent).toContain('Scope when run: Visible network');
    expect(historical.textContent).toContain('Status at image export: Completed');
    expect(historical.textContent).toContain('original-run');
    expect(historical.textContent).not.toContain('run-123');
    archiveRun.status = 'stale'; archiveRun.staleReasons = ['Scope changed before export.'];
    const staleHistory = documentFor(manifest, current).querySelector('#evidence-archive .numerical-result');
    expect(staleHistory.textContent).toContain('Status at image export: Stale — retained');
    expect(staleHistory.textContent).toContain('Scope changed before export.');
  });
  it('explains missing legacy outputs and rejects a different run instead of borrowing its numerical results', () => {
    const manifest = recordFixture();
    expect(documentFor(manifest).querySelector('#findings').textContent).toContain('Numerical outputs are not available');
    const records = resultRecords(manifest, { 'network-statistics': { summary: { nodeCount: 999 } } });
    records.calculations['network-statistics'].id = 'replacement-run';
    const findings = documentFor(manifest, records).querySelector('#findings');
    expect(findings.textContent).toContain('Numerical outputs are not available');
    expect(findings.textContent).not.toContain('999');
    manifest.investigation.calculations = {};
    expect(documentFor(manifest, records).querySelector('#findings').textContent).toContain('No network statistics or threshold-analysis results were saved.');
  });
  it('retains zero and tiny values, explains missing sweep fields, and never invents a recommendation', () => {
    const manifest = recordFixture();
    manifest.investigation.calculations['threshold-analysis'] = { ...manifest.investigation.calculations['network-statistics'], operation: 'threshold-analysis' };
    const records = resultRecords(manifest, { 'network-statistics': { summary: { nodeCount: 0, density: 0.0000000123456789, averageDegree: null } },
      'threshold-analysis': { thresholds: [0, 1], clusterCounts: [0], recommendedIndex: -1 } });
    const doc = documentFor(manifest, records), network = numericalCells(doc.querySelector('#findings [data-operation="network-statistics"]'));
    expect(network['Nodes']).toBe('0');
    expect(network['Network density']).toBe('0.0000000123457');
    expect(network['Average degree']).toBe('Not recorded');
    const threshold = doc.querySelector('#findings [data-operation="threshold-analysis"]');
    expect(threshold.textContent).toContain('No recommended threshold was recorded.');
    expect(threshold.textContent).toContain('Not recorded');
    expect(threshold.querySelectorAll('details tbody tr').length).toBe(2);
    expect(threshold.querySelectorAll('details tbody tr')[0].textContent).not.toContain('NaN');
  });
  it('escapes numerical-result descriptions and stale explanations as plain text', () => {
    const manifest = recordFixture(), attack = '<img src=x onerror=alert(1)><script>alert(1)</script>';
    const run = manifest.investigation.calculations['network-statistics'];
    run.staleReasons = [attack];
    manifest.investigation.calculations['threshold-analysis'] = { ...run, operation: 'threshold-analysis', parameters: { 'default-distance-metric': attack } };
    const records = resultRecords(manifest, { 'network-statistics': { summary: { metricLabel: attack, nodeCount: 3 } },
      'threshold-analysis': { metric: attack, thresholds: [0], recommendedIndex: -1 } });
    const findings = documentFor(manifest, records).querySelector('#findings');
    expect(findings.querySelectorAll('script,img,iframe,[onerror]')).toHaveSize(0);
    expect(findings.textContent).toContain(attack);
  });
  it('reports missing and resolved edge targets using captured resolution, and explains unknown legacy targets', () => {
    const manifest = recordFixture();
    manifest.investigation.annotations[0].target = { type: 'edge', id: 'removed-edge' };
    manifest.annotationResolution = { note: false };
    expect(documentFor(manifest).querySelector('#notes').textContent).toContain('Unlinked note');
    manifest.annotationResolution.note = true;
    expect(documentFor(manifest).querySelector('#notes').textContent).not.toContain('Unlinked note');
    delete manifest.annotationResolution;
    expect(documentFor(manifest).querySelector('#notes').textContent).toContain('Target status not recorded');
  });
  it('shows actual completed outputs, sampling seeds and early-stop status, with print and narrow-screen styles', () => {
    const manifest = recordFixture();
    const run = manifest.investigation.calculations['network-statistics'];
    run.outputSummary = { counts: { nodes: 3, relationships: 2 }, requestedReplicates: 100, completedReplicates: 20, stoppedEarly: true,
      sampling: { batchSize: 10, workerCount: 1, batches: [{ batchId: 0, seed: 42, replicates: 10, completed: true }], completedBatchOrder: [0] } };
    const doc = documentFor(manifest);
    expect(doc.querySelector('#calculations').textContent).toContain('20/100 replicates (stopped early)');
    expect(doc.querySelector('#calculations details').textContent).toContain('Seed: 42');
    expect(doc.querySelector('style').textContent).toContain('@media print');
    expect(doc.querySelector('style').textContent).toContain('@media(max-width:650px)');
  });
  it('presents all eight categories as readable sections and tables without JSON dumps', () => {
    const doc = documentFor();
    for (const id of ['threshold', 'filters', 'layout', 'grouping', 'cohorts', 'layers', 'notes', 'calculations']) {
      expect(doc.getElementById(id)?.querySelector('h2')).withContext(id).not.toBeNull();
    }
    expect(doc.querySelectorAll('pre').length).toBe(0);
    expect(doc.querySelector('#filters').textContent).toContain('Region equals North');
    expect(doc.querySelector('#threshold').textContent).toContain('SNPs');
    expect(doc.querySelector('#layout').textContent).toContain('2D Network');
    expect(doc.querySelector('body').textContent).toContain('investigation-manifest.json');
    expect(doc.querySelectorAll('.stat strong').length).toBe(4);
    expect(Array.from(doc.querySelectorAll('.stat strong')).map(item => item.textContent)).toEqual(['4', '2', '3', '1']);
  });
  it('counts overlapping selected cohorts once and retains exact memberships in expandable details', () => {
    const section = documentFor().querySelector('#cohorts');
    expect(section.textContent).toContain('3 unique nodes');
    expect(Array.from(section.querySelectorAll('.members')).map(item => item.textContent)).toEqual(['A, B', 'B, C']);
    expect(section.querySelector('details').open).toBeFalse();
  });
  it('distinguishes stale saved results, their original scope, current scope, and runs not yet performed', () => {
    const doc = documentFor();
    const row = doc.querySelector('#calculations tbody tr');
    expect(row.textContent).toContain('Network statistics');
    expect(row.textContent).toContain('Full network');
    expect(row.textContent).toContain('Stale — retained');
    expect(row.textContent).toContain('3 nodes; 1 relationship');
    expect(doc.querySelector('#calculations details').textContent).toContain('Selected cohorts');
    expect(doc.querySelector('#calculations details').textContent).toContain('earlier-build');
    expect(doc.querySelector('#calculations').textContent).toContain('Not run');
    expect(doc.body.textContent).not.toContain('__scopeOptions');
    expect(doc.body.textContent).not.toContain('internal-key');
  });
  it('escapes free text, names and references without active content or external dependencies', () => {
    const manifest = recordFixture();
    const attack = '<img src=x onerror=alert(1)><script>alert(1)</script>';
    manifest.investigation.annotations[0].text = attack;
    manifest.investigation.cohorts[0].name = attack;
    manifest.sources[0].name = attack;
    manifest.snapshotId = attack;
    manifest.investigation.calculations['network-statistics'].parameters.note = attack;
    manifest.investigation.calculations['network-statistics'].staleReasons = ['Selected cohorts changed.', attack];
    const html = readableInvestigationRecord(manifest), doc = documentFor(manifest);
    expect(doc.querySelectorAll('script,img,iframe,link,[onerror],[onclick]').length).toBe(0);
    expect(doc.querySelectorAll('[src]').length).toBe(0);
    expect(doc.querySelector('.note-text').textContent).toBe(attack);
    expect(html).toContain('&lt;script&gt;');
    expect(doc.body.textContent).toContain(manifest.stateChecksum);
    expect(doc.querySelector('#calculations').textContent).toContain('Selected cohorts changed.');
    expect(doc.querySelector('#calculations').textContent).toContain(attack);
    expect(doc.body.textContent).toContain(manifest.sources[0].sha256);
  });
  it('keeps multiline notes and marks resolvable missing targets without changing the manifest', () => {
    const manifest = recordFixture(), before = JSON.stringify(manifest);
    const doc = documentFor(manifest);
    expect(doc.querySelector('.note-text').textContent).toContain('\nFollow up next week.');
    expect(doc.querySelector('#notes .stale').textContent).toBe('Unlinked note');
    expect(JSON.stringify(manifest)).toBe(before);
  });
  it('formats UTC dates including epoch zero and explains historical provenance and empty results', () => {
    const manifest = recordFixture();
    manifest.investigation.calculations = {};
    manifest.investigation.annotations = [];
    const doc = documentFor(manifest);
    expect(doc.querySelector('header').textContent).toContain('30 Oct 2026, 14:15:16 UTC');
    expect(doc.querySelector('#filters').textContent).toContain('01 Jan 1970, 00:00:00 UTC');
    expect(doc.querySelector('#integrity').textContent).toContain('Not recorded in the original session');
    expect(doc.querySelector('#calculations').textContent).toContain('0 completed');
    expect(doc.querySelector('#notes').textContent).toContain('No notes recorded.');
  });
});
