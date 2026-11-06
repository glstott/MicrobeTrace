/** Browser-only probe shared by the opt-in Cypress suite and ad hoc Playwright runs. */
export interface InvestigationReportScenario {
  id: string;
  images: number;
  width: number;
  height: number;
  evidenceVariants: number;
  seed: number;
}

export const INVESTIGATION_REPORT_SCENARIOS: InvestigationReportScenario[] = [
  { id: 'report-control-1-image', images: 1, width: 1280, height: 720, evidenceVariants: 1, seed: 41001 },
  { id: 'large-report-12-images', images: 12, width: 1600, height: 900, evidenceVariants: 4, seed: 41001 },
  { id: 'stress-report-24-images', images: 24, width: 1920, height: 1080, evidenceVariants: 8, seed: 41001 },
];

export interface InvestigationReportMeasurement {
  scenario: InvestigationReportScenario;
  startedAt: string;
  metrics: Record<string, number | null>;
  heap: { initialUsedJSHeapSize: number | null; finalUsedJSHeapSize: number | null; deltaUsedJSHeapSize: number | null;
    peakObservedUsedJSHeapSize: number | null; jsHeapSizeLimit: number | null; samples: number; method: string };
  storage: { quotaBytes: number | null; usageBeforeBytes: number | null; usageAfterBytes: number | null;
    usageDeltaBytes: number | null; payloadCharacters: number | null; saveOutcome: string; error: string | null };
  checks: { images: number; historicalRecords: number; fileReopened: boolean; localLinkReopened: boolean;
    savedRunsPreserved: boolean; replacementCalculations: number; quotaFailureExplained: boolean; previousLinkSurvivedQuotaFailure: boolean };
  longTasks: { count: number; maxDurationMs: number; totalDurationMs: number };
  software: any;
}

async function generatedImage(win: Window, scenario: InvestigationReportScenario, index: number): Promise<Blob> {
  const canvas = win.document.createElement('canvas'); canvas.width = scenario.width; canvas.height = scenario.height;
  const context = canvas.getContext('2d')!, pixels = context.createImageData(canvas.width, canvas.height);
  let state = (scenario.seed + index) >>> 0;
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    pixels.data[offset] = state & 255; pixels.data[offset + 1] = (state >>> 8) & 255;
    pixels.data[offset + 2] = (state >>> 16) & 255; pixels.data[offset + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Synthetic PNG could not be encoded.')), 'image/png'));
  canvas.width = 0; canvas.height = 0;
  return blob;
}

/** Read directory sizes without decompressing three copies of every large image into JS memory. */
async function bundleSizes(blob: Blob): Promise<{ html: number; session: number; images: number; evidence: number }> {
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) throw new Error('The benchmark bundle has no ZIP directory.');
  let cursor = view.getUint32(end + 16, true);
  const entries = view.getUint16(end + 10, true), sizes = { html: 0, session: 0, images: 0, evidence: 0 };
  if (entries === 65535 || cursor === 0xffffffff) throw new Error('ZIP64 is outside this benchmark’s supported sizes.');
  for (let entry = 0; entry < entries; entry++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('The benchmark ZIP directory is invalid.');
    const nameLength = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)), size = view.getUint32(cursor + 24, true);
    if (name === 'investigation-record.html') sizes.html = size;
    if (name.endsWith('.microbetrace')) sizes.session = size;
    if (name.startsWith('figures/') && !name.endsWith('/')) sizes.images++;
    if (name.startsWith('figure-evidence/') && !name.endsWith('/')) sizes.evidence++;
    cursor += 46 + nameLength + extra + comment;
  }
  return sizes;
}

/** Requires a fresh synthetic investigation, with no existing exported images. Never sends data off-device. */
export async function benchmarkInvestigationReport(win: Window & { commonService: any; [key: string]: any },
  scenario: InvestigationReportScenario, progress: (phase: string, images: number) => void = () => {}): Promise<InvestigationReportMeasurement> {
  if (!Number.isInteger(scenario.images) || scenario.images < 1 || !Number.isInteger(scenario.evidenceVariants)
    || scenario.evidenceVariants < 1 || scenario.evidenceVariants > scenario.images) throw new Error('Invalid report benchmark scenario.');
  const common = win.commonService, component = common.visuals.microbeTrace, sessions = common.investigationSessions;
  if (common.session.investigation.figures?.length) throw new Error('Load a fresh synthetic fixture before benchmarking.');
  const initial = await component.buildSessionStash();
  const metrics: Record<string, number | null> = {}, heapSamples: number[] = [], longTasks: number[] = [];
  const readHeap = () => { const value = (win.performance as any).memory?.usedJSHeapSize; return typeof value === 'number' ? value : null; };
  const sample = () => { const value = readHeap(); if (value !== null) heapSamples.push(value); };
  const initialHeap = readHeap(), startedAt = new Date().toISOString();
  let lastHeartbeat = win.performance.now(), maxHeartbeatGap = 0;
  const interval = win.setInterval(() => { const now = win.performance.now(); maxHeartbeatGap = Math.max(maxHeartbeatGap, now - lastHeartbeat); lastHeartbeat = now; sample(); }, 50);
  const observer = typeof win.PerformanceObserver === 'function' ? new win.PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration))) : undefined;
  try { observer?.observe({ entryTypes: ['longtask'] }); } catch { /* Some browsers do not expose long tasks. */ }
  const measured = async <T>(name: string, work: () => T | Promise<T>): Promise<T> => {
    sample(); const start = win.performance.now();
    try { return await work(); } finally { metrics[name] = win.performance.now() - start; sample(); }
  };
  const waitFor = async (predicate: () => boolean) => {
    const deadline = win.performance.now() + 300000;
    while (!predicate()) {
      if (win.performance.now() > deadline) throw new Error('The report benchmark timed out while waiting for restoration.');
      await new Promise(resolve => win.setTimeout(resolve, 25));
    }
  };
  const local = component.localSessionLinkService, storage = local.storage;
  // localForage installs driver methods during ready(); attach measurement hooks afterward.
  try { await measured('storageInitializeMs', () => storage.ready()); }
  catch { /* The actual save below records unavailable browser storage and its UI explanation. */ }
  const originals = { hook: win.__mtTestSaveAs, build: component.buildSessionStash, record: sessions.readableRecord,
    setItem: storage.setItem, load: local.load, run: common.investigationCalculations.run,
    href: win.location.href, filename: component.saveFileName, format: component.selectedSaveFileType, byCluster: component.saveByCluster };
  const createdKeys = new Set<string>(), calls = new WeakMap<object, string[]>();
  let bundle: Blob | undefined, bundleFilename = '', htmlCharacters = 0, payloadCharacters: number | null = null;
  let quotaFailure = false, currentPhase = 'setup';
  const storageEstimate = async () => { try { return await win.navigator.storage?.estimate(); } catch { return undefined; } };
  const beforeStorage = await storageEstimate();
  const checks = { images: 0, historicalRecords: 0, fileReopened: false, localLinkReopened: false,
    savedRunsPreserved: true, replacementCalculations: 0, quotaFailureExplained: false, previousLinkSurvivedQuotaFailure: false };
  const storageResult: InvestigationReportMeasurement['storage'] = { quotaBytes: beforeStorage?.quota ?? null,
    usageBeforeBytes: beforeStorage?.usage ?? null, usageAfterBytes: null, usageDeltaBytes: null, payloadCharacters: null, saveOutcome: 'not attempted', error: null };
  try {
    progress('images', 0);
    component.buildSessionStash = function(...args: any[]) { return measured(`${currentPhase}CaptureMs`, () => originals.build.apply(this, args)); };
    sessions.readableRecord = function(...args: any[]) {
      const start = win.performance.now(); const html = originals.record.apply(this, args);
      metrics.htmlRenderMs = win.performance.now() - start; htmlCharacters = html.length; sample(); return html;
    };
    storage.setItem = async function(key: string, record: any) {
      if (quotaFailure) throw new win.DOMException('Synthetic storage exhaustion.', 'QuotaExceededError');
      payloadCharacters = record.payload.length;
      const result = await originals.setItem.call(this, key, record); createdKeys.add(key); return result;
    };
    local.load = function(...args: any[]) { return measured('localLinkReadMs', () => originals.load.apply(this, args)); };
    common.investigationCalculations.run = function(session: any, operation: string, ...args: any[]) {
      calls.set(session, [...(calls.get(session) || []), operation]); return originals.run.call(this, session, operation, ...args);
    };
    win.__mtTestSaveAs = (blob: Blob, filename: string) => { bundle = blob; bundleFilename = filename; };
    let imageBytes = 0, retainMs = 0;
    const generationStart = win.performance.now();
    for (let index = 0; index < scenario.images; index++) {
      // Several figures share evidence; other groups retain a distinct historical data revision.
      common.session.data.nodes[0].reportBenchmarkRevision = index % scenario.evidenceVariants;
      const blob = await generatedImage(win, scenario, index); imageBytes += blob.size;
      const start = win.performance.now();
      await component.exportService.beginImageExport('2D Network', { benchmark: scenario.id, image: index }).record(blob, `synthetic-${index + 1}.png`);
      retainMs += win.performance.now() - start;
      progress('images', index + 1);
    }
    metrics.fixturePreparationMs = win.performance.now() - generationStart;
    metrics.imageRetentionMs = retainMs; metrics.imageBytes = imageBytes;
    let workspace = common.session.investigation;
    const expectedImages = workspace.figures.map(figure => ({ id: figure.id, sha256: figure.sha256, evidenceId: figure.evidenceId }));
    const evidenceIds = Object.keys(workspace.figureEvidence).sort();
    const expectedRuns = Object.fromEntries(Object.entries(workspace.calculations).map(([operation, run]: [string, any]) => [operation, { id: run.id, output: JSON.stringify(run.output) }]));
    checks.images = expectedImages.length; checks.historicalRecords = evidenceIds.length;
    workspace = null;
    const assertRestored = () => {
      const restored = common.session.investigation;
      if (JSON.stringify(restored.figures.map(figure => ({ id: figure.id, sha256: figure.sha256, evidenceId: figure.evidenceId }))) !== JSON.stringify(expectedImages)
        || JSON.stringify(Object.keys(restored.figureEvidence).sort()) !== JSON.stringify(evidenceIds)) throw new Error('Report images or supporting records changed during restoration.');
      for (const [operation, expected] of Object.entries(expectedRuns) as Array<[string, { id: string; output: string }]>) {
        if (restored.calculations[operation]?.id !== expected.id || JSON.stringify(restored.calculations[operation]?.output) !== expected.output) {
          checks.savedRunsPreserved = false; throw new Error('A saved calculation changed during report restoration.');
        }
      }
      checks.replacementCalculations = (calls.get(common.session) || []).filter(operation => expectedRuns[operation]).length;
      if (checks.replacementCalculations) throw new Error('Report restoration launched a replacement calculation.');
    };
    const restored = (previous: any) => common.session !== previous && common.session.network.isFullyLoaded && common.session.tabLoaded
      && !common.pendingDashboardRestore && !component.applyingPendingDashboardRestore && common.session.investigation.figures?.length === scenario.images;

    currentPhase = 'bundle'; component.saveFileName = `benchmark-${scenario.id}`; component.selectedSaveFileType = 'bundle'; component.saveByCluster = false;
    progress('bundle save', scenario.images);
    await measured('bundleSaveMs', () => component.DisplayStashDialog('Save'));
    if (!bundle || component.sessionSaveError) throw new Error(component.sessionSaveError || 'No report bundle was produced.');
    metrics.bundleBytes = bundle.size; metrics.htmlCharacters = htmlCharacters;
    const sizes = await measured('bundleDirectoryReadMs', () => bundleSizes(bundle!));
    metrics.htmlBytes = sizes.html; metrics.sessionBytes = sizes.session;
    if (sizes.images !== scenario.images || sizes.evidence !== evidenceIds.length) throw new Error('The report bundle omitted images or evidence.');
    let previous = common.session;
    progress('file reopen', scenario.images);
    await measured('fileReopenMs', async () => {
      component.FileClick('Add Data');
      await waitFor(() => !!component.homepageTabs.find(tab => tab.label === 'Files')?.componentRef?.instance);
      const transfer = new win.DataTransfer(); transfer.items.add(new win.File([bundle!], bundleFilename, { type: 'application/zip' }));
      const input = win.document.querySelector('#fileDropRef') as HTMLInputElement;
      input.files = transfer.files; input.dispatchEvent(new win.Event('change', { bubbles: true }));
      await waitFor(() => restored(previous));
    });
    assertRestored(); checks.fileReopened = true; bundle = undefined; previous = null;

    currentPhase = 'localLink'; component.selectedSaveFileType = 'local-link'; component.localSessionLinkUrl = null;
    progress('local-link save', scenario.images);
    await measured('localLinkSaveMs', () => component.DisplayStashDialog('Save'));
    const localUrl = component.localSessionLinkUrl;
    storageResult.payloadCharacters = payloadCharacters;
    const afterStorage = await storageEstimate(); storageResult.usageAfterBytes = afterStorage?.usage ?? null;
    storageResult.usageDeltaBytes = beforeStorage?.usage !== undefined && afterStorage?.usage !== undefined ? afterStorage.usage - beforeStorage.usage : null;
    if (!localUrl) {
      storageResult.saveOutcome = 'unavailable'; storageResult.error = component.localSessionLinkError || 'Browser storage failed.';
    } else {
      storageResult.saveOutcome = 'saved'; previous = common.session;
      progress('local-link reopen', scenario.images);
      await measured('localLinkReopenMs', async () => {
        win.history.replaceState(null, '', localUrl); await component.loadLocalSessionLink(); await waitFor(() => restored(previous));
      });
      assertRestored(); checks.localLinkReopened = true; previous = null;
      currentPhase = 'quotaFailure'; quotaFailure = true;
      progress('storage failure recovery', scenario.images);
      const quotaSession = common.session;
      await measured('quotaFailureMs', () => component.DisplayStashDialog('Save'));
      checks.quotaFailureExplained = !!component.localSessionLinkError && common.session === quotaSession;
      quotaFailure = false;
      const key = new URL(localUrl).searchParams.get('localSession');
      let retained = await originals.load.call(local, key);
      checks.previousLinkSurvivedQuotaFailure = JSON.stringify(retained?.investigation?.figures?.map(figure => ({ id: figure.id, sha256: figure.sha256, evidenceId: figure.evidenceId }))) === JSON.stringify(expectedImages);
      retained = null;
      if (!checks.quotaFailureExplained || !checks.previousLinkSurvivedQuotaFailure) throw new Error(`Storage failure verification failed (message: ${checks.quotaFailureExplained}; previous link: ${checks.previousLinkSurvivedQuotaFailure}).`);
    }
    metrics.maxHeartbeatGapMs = maxHeartbeatGap;
    const finalHeap = readHeap(); sample();
    longTasks.push(...(observer?.takeRecords() || []).map(entry => entry.duration));
    return { scenario, startedAt, metrics, checks, storage: storageResult,
      heap: { initialUsedJSHeapSize: initialHeap, finalUsedJSHeapSize: finalHeap,
        deltaUsedJSHeapSize: initialHeap !== null && finalHeap !== null ? finalHeap - initialHeap : null,
        peakObservedUsedJSHeapSize: heapSamples.length ? Math.max(...heapSamples) : null,
        jsHeapSizeLimit: (win.performance as any).memory?.jsHeapSizeLimit ?? null, samples: heapSamples.length,
        method: 'performance.memory sampled every 50 ms and at phase boundaries; observed JS heap only, excluding native image/ZIP buffers and missed allocations during blocked intervals' },
      longTasks: { count: longTasks.length, maxDurationMs: Math.max(0, ...longTasks), totalDurationMs: longTasks.reduce((sum, duration) => sum + duration, 0) },
      software: initial.provenance.software };
  } finally {
    progress('cleanup', scenario.images);
    win.clearInterval(interval); observer?.disconnect();
    win.__mtTestSaveAs = originals.hook; component.buildSessionStash = originals.build; sessions.readableRecord = originals.record;
    storage.setItem = originals.setItem; local.load = originals.load; common.investigationCalculations.run = originals.run;
    win.history.replaceState(null, '', originals.href);
    for (const key of createdKeys) await storage.removeItem(key);
    component.dismissSessionSaveNotice(); component.clearLocalSessionLinkResult();
    component.saveFileName = originals.filename; component.selectedSaveFileType = originals.format; component.saveByCluster = originals.byCluster;
    await common.applySession(initial);
  }
}
