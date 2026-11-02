import { readableInvestigationRecord } from './investigation-record';
import type { InvestigationManifest } from './investigation-state';

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
function documentFor(manifest = recordFixture()): Document {
  return new DOMParser().parseFromString(readableInvestigationRecord(manifest), 'text/html');
}

describe('Readable investigation record', () => {
  it('reports missing and resolved edge targets using captured resolution, and explains unknown legacy targets', () => {
    const manifest = recordFixture();
    manifest.investigation.annotations[0].target = { type: 'edge', id: 'removed-edge' };
    manifest.annotationResolution = { note: false };
    expect(documentFor(manifest).querySelector('#notes').textContent).toContain('Unresolved target');
    manifest.annotationResolution.note = true;
    expect(documentFor(manifest).querySelector('#notes').textContent).not.toContain('Unresolved target');
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
    const html = readableInvestigationRecord(manifest), doc = documentFor(manifest);
    expect(doc.querySelectorAll('script,img,iframe,link,[onerror],[onclick]').length).toBe(0);
    expect(doc.querySelectorAll('[src]').length).toBe(0);
    expect(doc.querySelector('.note-text').textContent).toBe(attack);
    expect(html).toContain('&lt;script&gt;');
    expect(doc.body.textContent).toContain(manifest.stateChecksum);
    expect(doc.body.textContent).toContain(manifest.sources[0].sha256);
  });
  it('keeps multiline notes and marks resolvable missing targets without changing the manifest', () => {
    const manifest = recordFixture(), before = JSON.stringify(manifest);
    const doc = documentFor(manifest);
    expect(doc.querySelector('.note-text').textContent).toContain('\nFollow up next week.');
    expect(doc.querySelector('#notes .stale').textContent).toBe('Unresolved target');
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
