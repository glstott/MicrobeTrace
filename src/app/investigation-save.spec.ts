import { MicrobeTraceNextHomeComponent } from './microbe-trace-next-plugin.component';
import JSZip from 'jszip';

describe('Investigation save feedback and retries', () => {
  let component: any;
  let originalDollar: any;
  beforeEach(() => {
    originalDollar = (window as any).$;
    (window as any).$ = () => ({ is: () => false });
    component = Object.create(MicrobeTraceNextHomeComponent.prototype);
    Object.assign(component, {
      saveFileName: 'complete-investigation', selectedSaveFileType: 'session', saveByCluster: false,
      displayStashDialog: true, sessionSaving: false, localSessionLinkSaving: false,
      cdref: { markForCheck: jasmine.createSpy('markForCheck') },
      commonService: { session: { data: { nodes: [{ _id: 'A' }] }, investigation: { calculations: { retained: 'previous output' } } } },
      buildSessionStash: jasmine.createSpy('capture').and.resolveTo({ session: { data: {} } }),
      saveGeneratedFile: jasmine.createSpy('download'),
    });
  });
  afterEach(() => {
    component.dismissSessionSaveNotice();
    if (originalDollar === undefined) delete (window as any).$;
    else (window as any).$ = originalDollar;
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
    (window as any).$ = () => ({ is: () => true });
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
});
