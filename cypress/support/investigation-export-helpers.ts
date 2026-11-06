/// <reference types="cypress" />
import JSZip from 'jszip';
import {
  canonicalInvestigationJson, investigationCopy, investigationEdgeId, investigationNodeId,
} from '../../src/app/contactTraceCommonServices/investigation-state';
import type { InvestigationFigure, InvestigationFigureEvidence } from '../../src/app/contactTraceCommonServices/investigation-state';
import { installSaveAsCaptureHook, saveSessionFromFileMenu, waitForProcessingDialogToClear, writeCapturedDownloadToDisk } from './journey-helpers';

interface ExportInputs {
  evidence: InvestigationFigureEvidence;
  settings: Record<string, any>;
  filters: any;
}
export interface InvestigationImageCheck {
  path: string;
  view: string;
  inputsAlias: string;
}

/** Freeze the analytical inputs before clicking Export, independently of the image archive. */
export function rememberInvestigationImageInputs(alias: string): void {
  cy.window({ log: false }).then({ timeout: 60000 }, async (win: any) => {
    const common = win.commonService;
    await common.investigationCalculations.flush();
    const session = common.session, workspace = common.investigationSessions.workspace(session);
    return investigationCopy({
      evidence: { version: 1, data: session.data, files: session.files || [], cohorts: workspace.cohorts,
        selectedCohortIds: workspace.selectedCohortIds, edgeLayers: workspace.edgeLayers,
        scopes: workspace.scopes, calculations: workspace.calculations },
      settings: session.style.widgets, filters: session.state || {},
    }) as ExportInputs;
  }).as(alias, { type: 'static' });
}

const equal = (actual: unknown, expected: unknown, message: string): void => {
  // Logging entire image/sequence payloads can consume gigabytes in the Cypress reporter.
  expect(Cypress._.isEqual(actual, expected), message).to.equal(true);
};
const sha256 = async (bytes: Uint8Array): Promise<string> => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))),
  byte => byte.toString(16).padStart(2, '0'),
).join('');
const checksum = (value: unknown): Promise<string> => sha256(new TextEncoder().encode(canonicalInvestigationJson(value)));

/** Verify real downloads, portable bundle contents, offline HTML, and restoration by stable IDs. */
export function assertInvestigationImageBundle(images: InvestigationImageCheck[]): void {
  const checks: Array<{ figure: InvestigationFigure; inputs: ExportInputs }> = [];
  const archives: Record<string, InvestigationFigureEvidence> = {};
  const filename = `image-report-${Date.now()}`;
  const bundlePath = `${Cypress.config('downloadsFolder')}/${filename}.zip`;
  let savedCalculations: Record<string, any>;
  let restoredRuns: ReturnType<typeof Cypress.sinon.spy> | undefined;

  for (const image of images) {
    const downloadName = image.path.split(/[\\/]/).pop()!;
    const extension = downloadName.split('.').pop()!.toLowerCase();
    const mimeType = { png: 'image/png', jpeg: 'image/jpeg', svg: 'image/svg+xml' }[extension];
    cy.get<ExportInputs>(`@${image.inputsAlias}`, { log: false }).then(inputs => {
      cy.window({ timeout: 60000, log: false }).should((win: any) => {
        const matches = win.commonService.session.investigation.figures.filter((figure: InvestigationFigure) => figure.filename === downloadName);
        expect(matches.length, `one retained image for ${downloadName}`).to.equal(1);
      }).then((win: any) => {
        const workspace = win.commonService.session.investigation;
        const figure = investigationCopy(workspace.figures.find((figure: InvestigationFigure) => figure.filename === downloadName)) as InvestigationFigure;
        expect(figure.view, `${downloadName} source view`).to.equal(image.view);
        expect(figure.mimeType, `${downloadName} MIME type`).to.equal(mimeType);
        expect(figure.width, `${downloadName} width`).to.be.greaterThan(0);
        expect(figure.height, `${downloadName} height`).to.be.greaterThan(0);
        expect(figure.evidenceId, `${downloadName} supporting record ID`).to.match(/^[a-f0-9]{64}$/);
        equal(workspace.figureEvidence[figure.evidenceId!], inputs.evidence, `${image.view}: original data, sources, cohorts, layers, scopes and calculation outputs`);
        equal(figure.context.settings, inputs.settings, `${image.view}: settings at export`);
        equal(figure.context.filters, inputs.filters, `${image.view}: filters at export`);
        equal(figure.context.nodeIds, inputs.evidence.data.nodes.map(investigationNodeId), `${image.view}: exact loaded node membership`);
        equal(figure.context.edgeIds, inputs.evidence.data.links.map(investigationEdgeId), `${image.view}: exact loaded relationship membership`);
        equal(figure.context.visibleNodeIds, inputs.evidence.data.nodes.filter(node => node.visible !== false).map(investigationNodeId), `${image.view}: visible nodes at export`);
        equal(figure.context.visibleEdgeIds, inputs.evidence.data.links.filter(edge => edge.visible !== false).map(investigationEdgeId), `${image.view}: visible relationships at export`);
        checks.push({ figure, inputs });
        archives[figure.evidenceId!] = inputs.evidence;
      });
      cy.readFile(image.path, 'base64', { timeout: 60000, log: false }).then({ timeout: 60000 }, async encoded => {
        const figure = checks[checks.length - 1].figure;
        const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
        equal(figure.dataUrl, `data:${mimeType};base64,${encoded}`, `${image.view}: retained bytes match the actual downloaded file`);
        expect(await sha256(bytes), `${image.view}: downloaded image SHA-256`).to.equal(figure.sha256);
        expect(await checksum(inputs.evidence.data), `${image.view}: analytical input SHA-256`).to.equal(figure.context.inputChecksum);
      });
    });
  }

  cy.window({ log: false }).then((win: any) => {
    const workspace = win.commonService.session.investigation;
    equal(workspace.figures, checks.map(check => check.figure), 'all exported images appear once in export order');
    equal(workspace.figureEvidence, archives, 'only referenced historical archives are retained');
    savedCalculations = investigationCopy(workspace.calculations);
  });
  waitForProcessingDialogToClear(60000);
  // Some views leave the export/settings dialog open after a successful download.
  cy.get('body').then($body => {
    $body.find('.p-dialog:visible button.p-dialog-close-button:visible').toArray().forEach(button => {
      cy.wrap(button).click({ force: true });
    });
  });
  installSaveAsCaptureHook();
  saveSessionFromFileMenu(filename, { compress: true });
  writeCapturedDownloadToDisk(`${filename}.zip`, bundlePath);
  cy.readFile(bundlePath, 'base64', { timeout: 60000, log: false }).then({ timeout: 120000 }, async encoded => {
    const zip = await JSZip.loadAsync(encoded, { base64: true });
    const snapshot = JSON.parse(await zip.file(`${filename}.microbetrace`)!.async('text'));
    const manifest = JSON.parse(await zip.file('investigation-manifest.json')!.async('text'));
    const html = new DOMParser().parseFromString(await zip.file('investigation-record.html')!.async('text'), 'text/html');
    equal(snapshot.investigation.figures, checks.map(check => check.figure), 'bundle retains every exact image record');
    equal(snapshot.investigation.figureEvidence, archives, 'bundle retains the original historical inputs and completed outputs');
    equal(snapshot.investigation.calculations, savedCalculations, 'saving preserves current completed calculations');
    expect(manifest.snapshotId, 'manifest and session snapshot ID').to.equal(snapshot.snapshotId);
    expect(manifest.stateChecksum, 'manifest and session state checksum').to.equal(snapshot.provenance.stateChecksum);
    equal(manifest, snapshot.provenance, 'standalone and embedded manifests agree');
    expect(html.querySelectorAll('#figures img').length, 'offline report gallery size').to.equal(checks.length);
    expect(html.body.textContent, 'HTML snapshot identity').to.include(snapshot.snapshotId);
    expect(Object.values(zip.files).filter(entry => !entry.dir && entry.name.startsWith('figures/')).length, 'one bundled file per exported image').to.equal(checks.length);
    expect(Object.values(zip.files).filter(entry => !entry.dir && entry.name.startsWith('figure-evidence/')).length, 'one file per distinct supporting record').to.equal(Object.keys(archives).length);

    for (const [index, { figure, inputs }] of checks.entries()) {
      const { dataUrl, ...metadata } = figure;
      const summary = manifest.investigation.figures[index];
      const expectedPath = `figures/${figure.id}.${figure.mimeType === 'image/svg+xml' ? 'svg' : figure.mimeType === 'image/jpeg' ? 'jpeg' : 'png'}`;
      equal(summary, { ...metadata, path: expectedPath }, `${figure.view}: complete figure manifest`);
      const bytes = await zip.file(expectedPath)!.async('uint8array');
      equal(await zip.file(expectedPath)!.async('base64'), dataUrl.split(',')[1], `${figure.view}: bundle image is byte-for-byte identical`);
      expect(await sha256(bytes), `${figure.view}: bundle image SHA-256`).to.equal(figure.sha256);
      equal(html.querySelectorAll('#figures img')[index].getAttribute('src'), dataUrl, `${figure.view}: exact image embedded in offline HTML`);
      const record = html.querySelectorAll('#figures figure')[index];
      expect(record.textContent, `${figure.view}: report source identity`).to.include(figure.view).and.include(figure.filename);
      expect(record.querySelector(`a[href="#evidence-${figure.evidenceId}"]`), `${figure.view}: historical supporting-record link`).to.exist;
      const archiveSummary = manifest.investigation.figureEvidence[figure.evidenceId!];
      expect(archiveSummary.path, `${figure.view}: supporting-record path`).to.equal(`figure-evidence/${figure.evidenceId}.json`);
      const archiveBytes = await zip.file(archiveSummary.path)!.async('uint8array');
      expect(await sha256(archiveBytes), `${figure.view}: supporting-record SHA-256`).to.equal(figure.evidenceId);
      equal(JSON.parse(new TextDecoder().decode(archiveBytes)), inputs.evidence, `${figure.view}: archived exact analytical inputs and source contributions`);
      expect(archiveSummary.counts.nodes, `${figure.view}: archived node count`).to.equal(inputs.evidence.data.nodes.length);
      expect(archiveSummary.counts.edges, `${figure.view}: archived relationship count`).to.equal(inputs.evidence.data.links.length);
      for (const [operation, run] of Object.entries(inputs.evidence.calculations)) {
        const retained = archiveSummary.calculations[operation];
        expect(retained.id, `${figure.view}: ${operation} historical run ID`).to.equal(run!.id);
        expect(retained.inputChecksum, `${figure.view}: ${operation} input checksum`).to.equal(run!.inputChecksum);
        expect(retained.outputChecksum, `${figure.view}: ${operation} completed output checksum`).to.equal(await checksum(run!.output));
      }
    }
  });

  cy.visit('/?skipEula=1&skipDemoSession=1', { onBeforeLoad(win: any) {
    Object.defineProperty(win, 'commonService', { configurable: true, set(common) {
      Object.defineProperty(win, 'commonService', { configurable: true, writable: true, value: common });
      restoredRuns = Cypress.sinon.spy(common.investigationCalculations, 'run');
    } });
  } });
  cy.get('#fileDropRef').selectFile(bundlePath, { force: true });
  cy.window({ timeout: 60000, log: false }).should((win: any) => {
    const common = win.commonService, workspace = common.session.investigation;
    expect(common.session.network.isFullyLoaded, 'restored network loaded').to.equal(true);
    expect(common.session.tabLoaded, 'restored views loaded').to.equal(true);
    expect(common.pendingDashboardRestore, 'pending layout restored').not.to.exist;
    expect(common.visuals.microbeTrace.applyingPendingDashboardRestore, 'layout application finished').to.equal(false);
    equal(investigationCopy(workspace.figures), checks.map(check => check.figure), 'reopening preserves image bytes and metadata without regeneration');
    equal(investigationCopy(workspace.figureEvidence), archives, 'reopening preserves every historical supporting record');
    for (const [operation, run] of Object.entries(savedCalculations)) {
      expect(workspace.calculations[operation]?.id, `${operation}: completed run preserved`).to.equal(run.id);
      equal(investigationCopy(workspace.calculations[operation]?.output), run.output, `${operation}: completed output preserved`);
    }
    expect(restoredRuns, 'restore calculation monitor installed').to.exist;
    // The empty opening screen can record its own threshold sweep before the file is loaded.
    const replacements = restoredRuns!.getCalls().filter(call => call.args[0]?.data?.nodes?.length && savedCalculations[call.args[1]]);
    expect(replacements.length, 'restoring does not replace previously completed calculations').to.equal(0);
  });
}
