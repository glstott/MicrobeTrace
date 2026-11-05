import { MicrobeTraceNextHomeComponent } from './microbe-trace-next-plugin.component';
import JSZip from 'jszip';

describe('Investigation save feedback and retries', () => {
  let component: any;
  beforeEach(() => {
    component = Object.create(MicrobeTraceNextHomeComponent.prototype);
    Object.assign(component, {
      saveFileName: 'complete-investigation', selectedSaveFileType: 'session', saveByCluster: false,
      displayStashDialog: true, sessionSaving: false, localSessionLinkSaving: false,
      cdref: { markForCheck: jasmine.createSpy('markForCheck') },
      commonService: { session: { data: { nodes: [{ _id: 'A' }] }, style: { widgets: { 'node-color': '#123456' } }, investigation: { calculations: { retained: 'previous output' } } } },
      buildSessionStash: jasmine.createSpy('capture').and.resolveTo({ session: { data: {} } }),
      saveGeneratedFile: jasmine.createSpy('download'),
    });
  });
  afterEach(() => {
    component.dismissSessionSaveNotice();
  });

  it('shows progress, rejects duplicate submissions and cancellation, then announces a prepared download', async () => {
    let completeCapture: (value: any) => void, captureStarted: () => void;
    const started = new Promise<void>(resolve => captureStarted = resolve);
    const pending = new Promise(resolve => completeCapture = resolve);
    component.buildSessionStash.and.callFake(() => { captureStarted(); return pending; });
    const first = component.DisplayStashDialog('Save');
    await started;
    expect(component.sessionSaveBusy).toBeTrue();
    expect(component.sessionSaveProgress).toBe('Preparing investigation…');
    await component.DisplayStashDialog('Save');
    await component.DisplayStashDialog('Cancel');
    expect(component.buildSessionStash).toHaveBeenCalledTimes(1);
    expect(component.displayStashDialog).toBeTrue();
    completeCapture({ session: { data: {} } });
    await first;
    expect(component.saveGeneratedFile).toHaveBeenCalledTimes(1);
    expect(component.sessionSaveBusy).toBeFalse();
    expect(component.sessionSaveProgress).toBe('');
    expect(component.sessionSaveNotice).toContain('Download prepared: complete-investigation.microbetrace');
    expect(component.displayStashDialog).toBeFalse();
  });

  it('keeps errors in the same dialog and allows a retry without changing the investigation', async () => {
    const session = component.commonService.session;
    const before = JSON.stringify(session);
    component.buildSessionStash.and.rejectWith(new Error('Snapshot could not be prepared.'));
    await component.DisplayStashDialog('Save');
    expect(component.sessionSaveError).toBe('Snapshot could not be prepared.');
    expect(component.sessionSaveNotice).toBe('');
    expect(component.sessionSaveBusy).toBeFalse();
    expect(component.displayStashDialog).toBeTrue();
    expect(component.saveFileName).toBe('complete-investigation');
    expect(component.saveGeneratedFile).not.toHaveBeenCalled();
    expect(component.commonService.session).toBe(session);
    expect(JSON.stringify(session)).toBe(before);
    component.buildSessionStash.and.resolveTo({ session: { data: {} } });
    await component.DisplayStashDialog('Save');
    expect(component.sessionSaveError).toBe('');
    expect(component.saveGeneratedFile).toHaveBeenCalledTimes(1);
    expect(component.displayStashDialog).toBeFalse();
  });

  it('awaits local-link storage and retains its existing error feedback on failure', async () => {
    component.selectedSaveFileType = 'local-link';
    component.localSessionLinkService = { save: jasmine.createSpy('storage').and.rejectWith(new Error('quota exceeded')) };
    spyOn(console, 'error');
    await component.DisplayStashDialog('Save');
    expect(component.localSessionLinkService.save).toHaveBeenCalledTimes(1);
    expect(component.localSessionLinkError).toContain('enough space');
    expect(component.sessionSaveBusy).toBeFalse();
    expect(component.displayStashDialog).toBeTrue();
    expect(component.saveGeneratedFile).not.toHaveBeenCalled();
  });

  it('recovers from bundle compression failure without downloading an incomplete archive', async () => {
    component.selectedSaveFileType = 'bundle';
    component.buildSessionStash.and.resolveTo({ session: { data: {} }, provenance: {} });
    component.commonService.investigationSessions = { readableRecord: () => '<h1>Record</h1>' };
    const compression = spyOn(JSZip.prototype, 'generateAsync').and.rejectWith(new Error('Bundle compression failed.'));
    await component.DisplayStashDialog('Save');
    expect(component.sessionSaveError).toBe('Bundle compression failed.');
    expect(component.displayStashDialog).toBeTrue();
    expect(component.sessionSaveBusy).toBeFalse();
    expect(component.saveGeneratedFile).not.toHaveBeenCalled();
    compression.and.callThrough();
    await component.DisplayStashDialog('Save');
    expect(component.saveGeneratedFile).toHaveBeenCalledTimes(1);
    const [blob, filename] = component.saveGeneratedFile.calls.mostRecent().args;
    const zip = await JSZip.loadAsync(blob);
    expect(filename).toBe('complete-investigation.zip');
    expect(Object.keys(zip.files)).toEqual(['complete-investigation.microbetrace', 'investigation-manifest.json', 'investigation-record.html']);
    expect(component.sessionSaveError).toBe('');
    expect(component.displayStashDialog).toBeFalse();
  });

  it('defaults each new Save dialog to the complete investigation bundle', () => {
    component.selectedSaveFileType = 'style'; component.saveByCluster = true;
    component.FileClick('Save Session');
    expect(component.selectedSaveFileType).toBe('bundle');
    expect(component.saveByCluster).toBeFalse();
    expect(component.displayStashDialog).toBeTrue();
  });

  it('includes original exported image files and passes those same images into the readable report', async () => {
    const figures = [{ id: 'first-image', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AQID', filename: 'same.png' },
      { id: 'second-image', mimeType: 'image/png', dataUrl: 'data:image/png;base64,BAUG', filename: 'same.png' }];
    const evidenceId = 'a'.repeat(64);
    const figureEvidence = { [evidenceId]: { version: 1, data: { nodes: [{ _id: 'original-node' }], links: [] }, calculations: { original: { output: 'original result' } } } };
    const snapshot = { session: { data: {} }, investigation: { figures, figureEvidence }, provenance: {} };
    component.selectedSaveFileType = 'bundle';
    component.buildSessionStash.and.resolveTo(snapshot);
    const readableRecord = jasmine.createSpy('record').and.returnValue('<h1>Images</h1>');
    component.commonService.investigationSessions = { readableRecord };
    await component.DisplayStashDialog('Save');
    const zip = await JSZip.loadAsync(component.saveGeneratedFile.calls.mostRecent().args[0]);
    expect(Array.from(await zip.file('figures/first-image.png').async('uint8array'))).toEqual([1, 2, 3]);
    expect(Array.from(await zip.file('figures/second-image.png').async('uint8array'))).toEqual([4, 5, 6]);
    expect(readableRecord).toHaveBeenCalledWith(snapshot.provenance, figures);
    expect(JSON.parse(await zip.file('complete-investigation.microbetrace').async('text')).investigation.figures).toEqual(figures);
    expect(JSON.parse(await zip.file(`figure-evidence/${evidenceId}.json`).async('text'))).toEqual(figureEvidence[evidenceId]);
  });

  it('waits for image preparation before capturing and rejects a replacement investigation during that wait', async () => {
    let finish: () => void;
    let started: () => void;
    let pending = new Promise<void>(resolve => finish = resolve);
    let begun = new Promise<void>(resolve => started = resolve);
    const capture = jasmine.createSpy('capture').and.callFake(stash => Promise.resolve(stash));
    component.homepageTabs = [];
    component.getSerializableDashboardLayout = () => undefined;
    component.getSerializableDashboardState = () => undefined;
    component.commonService.visuals = {};
    component.commonService.session.investigation.viewStates = {};
    component.commonService.investigationSessions = { capture };
    component.commonService.investigationCalculations = { flush: () => Promise.resolve(), refreshStatus: () => {} };
    component.exportService = { flushImageExports: () => { started(); return pending; } };
    const build = () => (MicrobeTraceNextHomeComponent.prototype as any).buildSessionStash.call(component);
    const first = build(); await begun;
    expect(capture).not.toHaveBeenCalled();
    component.commonService.session.investigation.figures = [{ id: 'finished-image' }];
    finish();
    expect((await first).session.investigation.figures).toEqual([{ id: 'finished-image' }]);
    pending = new Promise<void>(resolve => finish = resolve);
    begun = new Promise<void>(resolve => started = resolve);
    const second = build(); await begun;
    component.commonService.session = { ...component.commonService.session };
    finish();
    await expectAsync(second).toBeRejectedWithError(/investigation changed/);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('clears bundle-only options when changing format and always writes a plain selected session', async () => {
    component.selectedSaveFileType = 'session'; component.saveByCluster = true;
    component.localSessionLinkUrl = 'old-local-link';
    component.onSaveFileTypeChanged();
    expect(component.saveByCluster).toBeFalse();
    expect(component.localSessionLinkUrl).toBeNull();
    // A stale programmatic flag cannot turn the explicitly chosen session into a ZIP.
    component.saveByCluster = true;
    await component.DisplayStashDialog('Save');
    const [blob, filename] = component.saveGeneratedFile.calls.mostRecent().args;
    expect(filename).toBe('complete-investigation.microbetrace');
    expect(JSON.parse(await blob.text())).toEqual({ session: { data: {} } });
    expect(component.buildSessionStash).toHaveBeenCalledTimes(1);
  });

  it('writes only style settings when the style format is selected', async () => {
    component.selectedSaveFileType = 'style';
    await component.DisplayStashDialog('Save');
    const [blob, filename] = component.saveGeneratedFile.calls.mostRecent().args;
    expect(filename).toBe('complete-investigation.style');
    expect(JSON.parse(await blob.text())).toEqual(component.commonService.session.style);
    expect(component.buildSessionStash).not.toHaveBeenCalled();
  });
});
