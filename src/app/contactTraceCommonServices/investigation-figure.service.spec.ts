import { InvestigationFigureService } from './investigation-figure.service';
import { InvestigationSessionService } from './investigation-session.service';
import { InvestigationCalculationService } from './investigation-calculation.service';
import { createInvestigationWorkspace, investigationChecksum, investigationCopy, investigationFigureBytes, investigationFigurePath, investigationFigureSummary } from './investigation-state';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="20"><rect width="32" height="20" fill="blue"/></svg>';
describe('Exported investigation figures', () => {
  let common: any, images: InvestigationFigureService, sessions: InvestigationSessionService;
  beforeEach(() => {
    sessions = new InvestigationSessionService();
    common = { session: { data: { nodes: [{ _id: 'A', name: 'Original case', visible: true }], links: [] },
      state: {}, style: { widgets: { 'link-threshold': 3 } }, files: [], meta: {}, network: {}, investigation: createInvestigationWorkspace() },
      investigationSessions: sessions, investigationCalculations: { notifyChanged: jasmine.createSpy('notifyChanged') } };
    images = new InvestigationFigureService(common);
  });
  it('freezes inputs and settings at export, round-trips exact bytes, and embeds the figure offline with compact manifest metadata', async () => {
    const originalChecksum = await investigationChecksum(common.session.data);
    const image = images.begin('2D Network', { scale: 2 });
    common.session.data.nodes[0].name = 'Changed later'; common.session.style.widgets['link-threshold'] = 9;
    await image.record(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), '<methods>.svg');
    const figure = common.session.investigation.figures[0];
    expect(figure.context.inputChecksum).toBe(originalChecksum);
    expect(figure.context.settings['link-threshold']).toBe(3);
    expect(figure.width).toBe(32); expect(figure.height).toBe(20);
    expect(new TextDecoder().decode(investigationFigureBytes(figure))).toBe(svg);
    const saved = await sessions.capture({ session: common.session, tabs: [] });
    expect(saved.schemaVersion).toBe(5);
    expect('dataUrl' in saved.provenance.investigation.figures[0]).toBeFalse();
    expect(saved.provenance.investigation.figures[0].path).toBe(investigationFigurePath(figure));
    const restored = await sessions.prepare(JSON.parse(JSON.stringify(saved)));
    expect(restored.session.investigation.figures).toEqual([figure]);
    const html = sessions.readableRecord(saved.provenance, saved.investigation.figures);
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.querySelector('#figures img').getAttribute('src')).toBe(figure.dataUrl);
    expect(document.querySelector('#figures').textContent).toContain('<methods>.svg');
    expect(document.querySelector('#figures').textContent).toContain('2D Network');
    expect(document.querySelector('#figures').textContent).toContain(figure.sha256);
    expect(document.querySelector('#figures svg')).toBeNull();
    expect(document.querySelector('#figures methods')).toBeNull();
    expect(common.investigationCalculations.notifyChanged).toHaveBeenCalledWith(common.session, 'presentation');
  });
  it('retains repeated filenames and supports PNG, JPEG and SVG with distinct stable identities', async () => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 12;
    canvas.getContext('2d').fillRect(0, 0, 16, 12);
    for (const mime of ['image/png', 'image/jpeg']) await images.begin('Dashboard').record(canvas.toDataURL(mime), 'same-name');
    await images.begin('Timeline').record(new Blob([svg], { type: 'image/svg+xml' }), 'same-name');
    const figures = common.session.investigation.figures;
    expect(figures.map(figure => figure.mimeType)).toEqual(['image/png', 'image/jpeg', 'image/svg+xml']);
    expect(new Set(figures.map(figure => figure.id)).size).toBe(3);
    expect(new Set(figures.map(investigationFigurePath)).size).toBe(3);
    await expectAsync(sessions.prepare(await sessions.capture({ session: common.session, tabs: [] }))).toBeResolved();
  });
  it('captures current camera and axis settings without later renderer changes modifying the recorded state', async () => {
    const axes = { xaxis: { autorange: false, range: [2, 4] }, yaxis: { autorange: true } };
    const camera = { centerX: 10, centerY: 20, graphUnitsPerPixel: 2 };
    common.visuals = { heatmap: { captureInvestigationViewState: () => axes },
      twoD: { captureInvestigationState: () => ({ camera, viewState: { renderer: 'sigma' }, nodes: [{ id: 'A', x: 5, y: 6 }] }) } };
    const capture = images.begin('Dashboard');
    axes.xaxis.range[0] = 99; camera.centerX = 99;
    await capture.record(new Blob([svg], { type: 'image/svg+xml' }), 'dashboard.svg');
    const states = common.session.investigation.figures[0].context.viewStates;
    expect(states.Heatmap.xaxis.range).toEqual([2, 4]);
    expect(states['2D Network'].camera.centerX).toBe(10);
    expect(states['2D Network'].positions).toEqual([{ id: 'A', x: 5, y: 6 }]);
    expect(common.session.investigation.viewStates).toEqual({});
  });
  it('waits for pending images when saving and settles cancelled and failed exports without adding a figure', async () => {
    const cancelled = images.begin('Heatmap');
    let flushed = false;
    const pending = images.flush(common.session).then(() => flushed = true);
    await Promise.resolve(); expect(flushed).toBeFalse();
    cancelled.cancel(); await pending; expect(flushed).toBeTrue();
    const failed = images.begin('Heatmap');
    await expectAsync(failed.record(new Blob(['bad'], { type: 'text/html' }), 'bad.html')).toBeRejectedWithError(/format/);
    await expectAsync(images.flush(common.session)).toBeResolved();
    expect(common.session.investigation.figures).toEqual([]);
    const empty = images.begin('Heatmap');
    await expectAsync(empty.record(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"/>'], { type: 'image/svg+xml' }), 'empty.svg')).toBeRejected();
    await expectAsync(images.flush(common.session)).toBeResolved();
    expect(common.session.investigation.figures).toEqual([]);
  });
  it('does not attach late images to a newly opened investigation', async () => {
    const original = common.session, capture = images.begin('Map');
    const work = capture.record(new Blob([svg], { type: 'image/svg+xml' }), 'map.svg');
    common.session = { ...original, investigation: createInvestigationWorkspace() };
    await work; await images.flush(original);
    expect(original.investigation.figures).toEqual([]);
    expect(common.session.investigation.figures).toEqual([]);
    expect(common.investigationCalculations.notifyChanged).not.toHaveBeenCalled();
  });
  it('hands the original image bytes to the download hook and retains historical memberships when targets later disappear', async () => {
    const hook = jasmine.createSpy('download');
    (window as any).__mtTestSaveAs = hook;
    try {
      const canvas = document.createElement('canvas'); canvas.width = 12; canvas.height = 8;
      await images.begin('Gantt Chart').save(canvas.toDataURL('image/png'), 'chart.png');
      expect(hook).toHaveBeenCalledTimes(1);
      const blob = hook.calls.mostRecent().args[0] as Blob;
      expect(blob.type).toBe('image/png');
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(investigationFigureBytes(common.session.investigation.figures[0]));
      common.session.data.nodes = [{ _id: 'B', visible: true }];
      const restored = await sessions.prepare(await sessions.capture({ session: common.session, tabs: [] }));
      expect(restored.session.investigation.figures[0].context.nodeIds).toEqual(['A']);
      expect(restored.session.data.nodes[0]._id).toBe('B');
    } finally { delete (window as any).__mtTestSaveAs; }
  });
  it('rejects altered image bytes, unsafe sources, duplicate identities and incomplete current-schema image state', async () => {
    await images.begin('Map').record(new Blob([svg], { type: 'image/svg+xml' }), 'map.svg');
    const saved = await sessions.capture({ session: common.session, tabs: [] });
    for (const mutate of [
      (stash: any) => stash.investigation.figures[0].dataUrl = 'https://example.com/image.svg',
      (stash: any) => stash.investigation.figures[0].id = '../escape',
      (stash: any) => stash.investigation.figures.push(investigationCopy(stash.investigation.figures[0])),
      (stash: any) => delete stash.investigation.figures,
    ]) { const changed = investigationCopy(saved); mutate(changed); await expectAsync(sessions.prepare(changed)).toBeRejected(); }
    const changed = investigationCopy(saved);
    changed.investigation.figures[0].dataUrl = `data:image/svg+xml;base64,${btoa(svg.replace('blue', 'red'))}`;
    changed.provenance.stateChecksum = await investigationChecksum((sessions as any).checksumPayload(changed));
    await expectAsync(sessions.prepare(changed)).toBeRejectedWithError(/image checksum/);
    expect(common.session.investigation.figures[0].dataUrl).toBe(saved.investigation.figures[0].dataUrl);
  });
  it('loads schema 3 without images and upgrades on the next save without inventing historical images', async () => {
    const old = await sessions.capture({ session: common.session, tabs: [] });
    old.schemaVersion = old.provenance.schemaVersion = 3;
    delete old.investigation.figures; delete old.provenance.investigation.figures;
    old.provenance.stateChecksum = await investigationChecksum((sessions as any).checksumPayload(old));
    const loaded = await sessions.prepare(old);
    expect(loaded.session.investigation.figures).toEqual([]);
    expect((await sessions.capture(loaded)).schemaVersion).toBe(5);
  });

  it('retains original data, files, memberships, and exact calculation outputs after edits and a successful replacement run', async () => {
    const session = common.session, workspace = session.investigation;
    session.data.nodes[0].seq = 'ACGT';
    session.data.nodes.push({ _id: 'B', seq: 'ACGA', visible: false });
    session.data.links = [{ id: 'AB', source: 'A', target: 'B', origin: ['Contacts'], _originAll: ['Genetic Distance', 'Contacts'], visible: false }];
    session.files = [{ name: 'original.csv', contents: 'A,ACGT\nB,ACGA' }];
    workspace.cohorts = [{ id: 'review', name: 'Original review', nodeIds: ['A', 'B'] }]; workspace.selectedCohortIds = ['review'];
    workspace.edgeLayers = [{ id: 'contacts', name: 'Contacts', source: 'Contacts', enabled: true },
      { id: 'genetic', name: 'Genetic', source: 'Genetic Distance', enabled: true }];
    workspace.scopes.consensus = 'cohort';
    const calculations = new InvestigationCalculationService(sessions);
    await calculations.run(session, 'consensus', async () => 'ACGT', undefined, { sequence: true, parameters: { seed: 42 } });
    const original = investigationCopy(workspace.calculations.consensus);
    const capture = images.begin('Dashboard');
    session.data.nodes[0].seq = 'TTTT'; session.data.nodes[1].seq = 'TTTT';
    session.files[0].contents = 'A,TTTT\nB,TTTT';
    workspace.cohorts[0].name = 'Changed review'; workspace.cohorts[0].nodeIds = ['A'];
    workspace.edgeLayers[0].name = 'Renamed contacts'; workspace.edgeLayers[0].enabled = false;
    workspace.scopes.consensus = 'full';
    await calculations.run(session, 'consensus', async () => 'TTTT', undefined, { sequence: true, parameters: { seed: 99 } });
    const replacement = workspace.calculations.consensus;
    await capture.record(new Blob([svg], { type: 'image/svg+xml' }), 'before-rerun.svg');
    const figure = workspace.figures[0], evidence = workspace.figureEvidence[figure.evidenceId];
    expect(evidence.data.nodes[0].seq).toBe('ACGT');
    expect(evidence.files[0].contents).toContain('ACGT');
    expect(evidence.cohorts[0]).toEqual({ id: 'review', name: 'Original review', nodeIds: ['A', 'B'] });
    expect(evidence.edgeLayers[0].enabled).toBeTrue();
    expect(evidence.data.links[0]._originAll).toEqual(['Genetic Distance', 'Contacts']);
    expect(evidence.scopes.consensus).toBe('cohort');
    expect(evidence.calculations.consensus).toEqual(original);
    expect(evidence.calculations.consensus.output).toBe('ACGT');
    expect(evidence.calculations.consensus.parameters.seed).toBe(42);
    expect(replacement.id).not.toBe(original.id); expect(replacement.output).toBe('TTTT');
    // Historical members may disappear from today's network without invalidating the evidence.
    session.data.nodes = [session.data.nodes[0]]; session.data.links = [];
    const before = JSON.stringify(session);
    const saved = await sessions.capture({ session, tabs: [] });
    const restored = await sessions.prepare(JSON.parse(JSON.stringify(saved)));
    expect(JSON.stringify(session)).toBe(before);
    expect(restored.session.investigation.figureEvidence[figure.evidenceId]).toEqual(evidence);
    expect(restored.session.investigation.calculations.consensus.id).toBe(replacement.id);
    const manifestEvidence = saved.provenance.investigation.figureEvidence[figure.evidenceId];
    expect(manifestEvidence.calculations.consensus.id).toBe(original.id);
    expect(manifestEvidence.calculations.consensus.outputChecksum).toBe(await investigationChecksum('ACGT'));
    expect('data' in manifestEvidence).toBeFalse();
    expect('output' in manifestEvidence.calculations.consensus).toBeFalse();
    const document = new DOMParser().parseFromString(sessions.readableRecord(saved.provenance, saved.investigation.figures), 'text/html');
    const section = document.getElementById('figure-evidence');
    expect(section.textContent).toContain(original.id); expect(section.textContent).not.toContain(replacement.id);
    expect(section.textContent).toContain('Original review'); expect(section.textContent).toContain('42');
    expect(section.querySelector('a[download]').getAttribute('href')).toBe(manifestEvidence.path);
  });

  it('shares identical supporting records across figures and records a new archive only when analytical records change', async () => {
    for (let index = 0; index < 2; index++) await images.begin('Dashboard', { scale: index + 1 }).record(new Blob([svg], { type: 'image/svg+xml' }), 'same.svg');
    const workspace = common.session.investigation;
    expect(Object.keys(workspace.figureEvidence).length).toBe(1);
    expect(workspace.figures[0].evidenceId).toBe(workspace.figures[1].evidenceId);
    common.session.data.nodes[0].name = 'Edited later';
    await images.begin('Dashboard').record(new Blob([svg], { type: 'image/svg+xml' }), 'after-edit.svg');
    expect(Object.keys(workspace.figureEvidence).length).toBe(2);
    const restored = await sessions.prepare(await sessions.capture({ session: common.session, tabs: [] }));
    expect(Object.keys(restored.session.investigation.figureEvidence).length).toBe(2);
  });

  it('preserves binary analytical inputs and original source contents across JSON and browser-local storage payloads', async () => {
    common.session.data.distances = new Float64Array([0, 1.25]);
    common.session.files = [{ name: 'original.xlsx', contents: new Uint8Array([1, 2, 3]).buffer }];
    await images.begin('Heatmap').record(new Blob([svg], { type: 'image/svg+xml' }), 'matrix.svg');
    const id = common.session.investigation.figures[0].evidenceId;
    common.session.data.distances[1] = 99;
    new Uint8Array(common.session.files[0].contents)[0] = 99;
    const saved = await sessions.capture({ session: common.session, tabs: [] });
    const restored = await sessions.prepare(JSON.parse(JSON.stringify(saved)));
    const archive = restored.session.investigation.figureEvidence[id];
    expect(Array.from(archive.data.distances)).toEqual([0, 1.25]);
    expect(Array.from(new Uint8Array(archive.files[0].contents))).toEqual([1, 2, 3]);
    await expectAsync(sessions.prepare(await sessions.capture(restored))).toBeResolved();
  });

  it('rejects missing, altered, inconsistent and orphaned supporting records before restoring', async () => {
    await images.begin('Dashboard').record(new Blob([svg], { type: 'image/svg+xml' }), 'before-edit.svg');
    const saved = await sessions.capture({ session: common.session, tabs: [] });
    const id = saved.investigation.figures[0].evidenceId;
    for (const mutate of [
      (stash: any) => delete stash.investigation.figureEvidence[id],
      (stash: any) => delete stash.investigation.figures[0].evidenceId,
      (stash: any) => stash.investigation.figureEvidence[id].data.nodes[0]._id = 'unknown',
      (stash: any) => stash.investigation.figures[0].context.calculationIds.push('missing-run'),
      (stash: any) => stash.investigation.figureEvidence['f'.repeat(64)] = investigationCopy(stash.investigation.figureEvidence[id]),
    ]) { const changed = investigationCopy(saved); mutate(changed); await expectAsync(sessions.prepare(changed)).toBeRejectedWithError(/figure|supporting/i); }
    const originalName = common.session.data.nodes[0].name;
    common.session.investigation.figureEvidence[id].data.nodes[0].name = 'Tampered archive';
    await expectAsync(sessions.capture({ session: common.session, tabs: [] })).toBeRejectedWithError(/supporting-record checksum/);
    expect(common.session.data.nodes[0].name).toBe(originalName);
  });

  it('marks schema-4 image evidence as not recorded without attaching current results retroactively', async () => {
    await images.begin('Dashboard').record(new Blob([svg], { type: 'image/svg+xml' }), 'legacy.svg');
    const legacy = await sessions.capture({ session: common.session, tabs: [] });
    legacy.schemaVersion = legacy.provenance.schemaVersion = 4;
    delete legacy.investigation.figureEvidence; delete legacy.provenance.investigation.figureEvidence;
    delete legacy.investigation.figures[0].evidenceId;
    legacy.provenance.investigation.figures = legacy.investigation.figures.map(investigationFigureSummary);
    legacy.provenance.stateChecksum = await investigationChecksum((sessions as any).checksumPayload(legacy));
    const loaded = await sessions.prepare(legacy);
    expect(loaded.session.investigation.figureEvidence).toEqual({});
    const upgraded = await sessions.capture(loaded);
    expect(upgraded.schemaVersion).toBe(5);
    expect(upgraded.investigation.figures[0].evidenceId).toBeNull();
    expect(sessions.readableRecord(upgraded.provenance, upgraded.investigation.figures)).toContain('Historical analytical records: not recorded for this image.');
  });
});
