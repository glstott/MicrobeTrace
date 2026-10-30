/// <reference types="cypress" />
import JSZip from 'jszip';
import { expandInvestigationTools } from '../../support/investigation-helpers';
import { assertPhyloTreeReady, goToPhyloTreeView, installSaveAsCaptureHook, saveSessionFromFileMenu,
  waitForProcessingDialogToClear, writeCapturedDownloadToDisk } from '../../support/journey-helpers';
import { INVESTIGATION_OPERATIONS } from '../../../src/app/contactTraceCommonServices/investigation-state';

type RestoreMonitor = { runs?: ReturnType<typeof Cypress.sinon.spy>; messages?: ReturnType<typeof Cypress.sinon.spy> };

// Install before the application exposes CommonService: local links start loading
// during initialization, before a cy.window() callback could attach its spies.
function monitorRestore(monitor: RestoreMonitor) {
  return (win: any) => {
    monitor.messages = Cypress.sinon.spy(win.Worker.prototype, 'postMessage');
    Object.defineProperty(win, 'commonService', { configurable: true, set(common) {
      Object.defineProperty(win, 'commonService', { value: common, writable: true, configurable: true, enumerable: true });
      monitor.runs = Cypress.sinon.spy(common.investigationCalculations, 'run');
    } });
  };
}

function prepareAllCompletedResults() {
  cy.visit('/?skipEula=1&skipDemoSession=1');
  cy.get('#fileDropRef').selectFile('cypress/fixtures/investigation/02-configured.microbetrace', { force: true });
  cy.window({ timeout: 30000 }).should((win: any) => {
    expect(win.commonService.session.data.nodes).to.have.length(6);
    expect(win.commonService.session.network.isFullyLoaded).to.equal(true);
  });
  // Instantiate the statistics view before changing its inputs. Opening it for
  // the first time with a newly stale result would intentionally calculate it.
  cy.get('[data-testid="app-view-menu-button"]').click();
  cy.contains('button[mat-menu-item]', 'Network Statistics').click();
  cy.window({ timeout: 30000 }).should((win: any) => {
    expect(win.commonService.visuals.networkStatistics?.networkStatisticsLoading).to.equal(false);
  });
  cy.window().then({ timeout: 60000 }, async (win: any) => {
    const common = win.commonService, session = common.session;
    for (const { id } of INVESTIGATION_OPERATIONS) session.investigation.scopes[id] = 'cohort';
    // The checked cohorts resolve to A,B,D,E, including hidden members.
    session.data.newickString = '((A:1,B:1):1,(D:1,E:1):1);';
    await common.computePatristicForSource(20, { origin: ['Genetic Distance'], distanceOrigin: 'Genetic Distance' });
    await common.computeDirectionality();
    await common.align({ nodes: session.data.nodes, reference: session.data.nodes[0].seq,
      aligner: 'bioseq', match: [1, -1], gap: [-1, -0.5] });
    await common.computeAmbiguityCounts();
    session.data.consensus = await common.computeConsensus();
    await common.computeConsensusDistances();
    await common.computeLinks(session.data.nodes);
    await common.computeMST();
    await common.computeNN();
    delete session.data.newick;
    session.data.newickString = '';
    await common.getDM();
    session.data.newickString = await common.computeTree();
    common.recalculateInvestigationThreshold();
    await common.investigationCalculations.flush();
    await common.computeInvestigationStatistics();
  });
  goToPhyloTreeView();
  cy.window().then({ timeout: 60000 }, async (win: any) => {
    const common = win.commonService, phylo = common.visuals.phylogenetic;
    phylo.SelectedBootstrapCustomReplicates = 2;
    phylo.SelectedBootstrapStopWhenStable = false;
    await phylo.calculateBootstrapSupport({ skipConfirmation: true });
    expect(Object.keys(common.session.investigation.calculations).sort())
      .to.deep.equal(INVESTIGATION_OPERATIONS.map(operation => operation.id).sort());
    for (const record of Object.values(common.session.investigation.calculations) as any[]) {
      expect(record.nodeIds, `${record.operation} scoped inputs`).to.deep.equal(['A', 'B', 'D', 'E']);
      expect(record.output, `${record.operation} completed output`).not.to.equal(undefined);
    }
  });
  cy.get('[data-testid="app-view-menu-button"]').click();
  cy.contains('button[mat-menu-item]', 'Network Statistics').click();
  cy.window({ timeout: 30000 }).should((win: any) => {
    expect(win.commonService.visuals.networkStatistics?.networkStatisticsLoading).to.equal(false);
  });
  cy.window().then((win: any) => {
    const common = win.commonService;
    // Create the stale result after activating the final view. Activating a live
    // view refreshes its inputs, which would replace a result made stale earlier
    // in the setup, before the snapshot under test has even been saved.
    common.session.investigation.scopes['network-statistics'] = 'visible';
    common.investigationCalculations.refreshStatus(common.session);
    expect(common.session.investigation.calculations['network-statistics'].status).to.equal('stale');
    expect(common.session.investigation.calculations.consensus.status).to.equal('completed');
  });
}

describe('Investigation snapshots', () => {
  it('restores cohorts, layers, notes, scopes and completed results from a portable audit bundle', () => {
    const name = `investigation_roundtrip_${Date.now()}`;
    const filename = `${name}.zip`, path = `${Cypress.config('downloadsFolder')}/${filename}`;
    let runId: string, cohortIds: string[], selectedNodeIds: string[], expectedLayers: unknown;
    let threshold: number, grouping: string;
    cy.visit('/?skipEula=1');
    cy.contains('button', 'Continue with Sample Dataset').click();
    cy.window().its('commonService.session.network.isFullyLoaded').should('equal', true);
    installSaveAsCaptureHook();
    cy.contains('[aria-label="Network feature summary"]', '33 network nodes').should('be.visible');
    cy.get('[role="application"][aria-label="Network visualization"]').focus().type('{home}{enter}{rightarrow}{enter}');
    cy.get('[data-testid="app-file-menu-button"]').click();
    cy.get('[data-testid="app-file-menu-investigation"]').should('be.visible').click();
    expandInvestigationTools();
    cy.get('[aria-label="New cohort name"]').type('Publication cohort');
    cy.get('[data-testid="investigation-create-cohort"]').click();
    cy.get('[aria-label="Use cohort Publication cohort"]').check();
    cy.get('[aria-label="New annotation"]').type('Methods: cohort comparison <check sources>');
    cy.contains('button', 'Save note').click();
    cy.get('#scope-network-statistics').select('cohort');
    cy.contains('.scope-row', 'Network statistics').contains('button', 'Run').click();
    cy.window().its('commonService.session.investigation.calculations.network-statistics.status').should('equal', 'completed');
    cy.window().then((win: any) => {
      const session = win.commonService.session;
      runId = session.investigation.calculations['network-statistics'].id;
      cohortIds = [...session.investigation.selectedCohortIds];
      selectedNodeIds = session.data.nodes.filter((node: any) => node.selected).map((node: any) => String(node._id ?? node.id));
      expectedLayers = JSON.parse(JSON.stringify(session.investigation.edgeLayers));
      threshold = Number(session.style.widgets['link-threshold']);
      grouping = session.style.widgets['polygons-foci'];
    });
    cy.get('[data-testid="investigation-panel"]').closest('.p-dialog').find('button.p-dialog-close-button').click();
    saveSessionFromFileMenu(name, { compress: true });
    writeCapturedDownloadToDisk(filename, path);
    cy.readFile(path, 'base64').then(async encoded => {
      const zip = await JSZip.loadAsync(encoded, { base64: true });
      const saved = JSON.parse(await zip.file(`${name}.microbetrace`)!.async('text'));
      const manifest = JSON.parse(await zip.file('investigation-manifest.json')!.async('text'));
      const html = await zip.file('investigation-record.html')!.async('text');
      expect(saved.schemaVersion).to.equal(2);
      expect(manifest.snapshotId).to.equal(saved.snapshotId);
      expect(manifest.stateChecksum).to.equal(saved.provenance.stateChecksum);
      expect(html).to.include(saved.snapshotId).and.include('&lt;check sources&gt;');
      expect(saved.investigation.calculations['network-statistics'].id).to.equal(runId);
      expect(saved.investigation.layout.nodes).to.have.length(saved.session.data.nodes.length);
      expect(saved.investigation.filters).to.have.property('state');
    });
    cy.visit('/?skipEula=1&skipDemoSession=1');
    cy.get('#fileDropRef').selectFile(path, { force: true });
    cy.window().its('commonService.session.network.isFullyLoaded').should('equal', true);
    // Validation happens before replacing the live session, whose loaded flag may
    // still be true. Wait for the saved investigation itself to finish restoring.
    cy.window({ timeout: 30000 }).should((win: any) => {
      const session = win.commonService.session;
      expect(session.investigation.selectedCohortIds).to.deep.equal(cohortIds);
      expect(session.investigation.cohorts[0].nodeIds).to.deep.equal(selectedNodeIds);
      expect(session.investigation.edgeLayers).to.deep.equal(expectedLayers);
      expect(session.investigation.annotations[0].text).to.equal('Methods: cohort comparison <check sources>');
      expect(session.investigation.scopes['network-statistics']).to.equal('cohort');
      expect(session.investigation.calculations['network-statistics'].id).to.equal(runId);
      expect(Number(session.style.widgets['link-threshold'])).to.equal(threshold);
      expect(session.style.widgets['polygons-foci']).to.equal(grouping);
      expect(session.data.nodes.filter((node: any) => node.selected).map((node: any) => String(node._id ?? node.id))).to.deep.equal(selectedNodeIds);
    });
  });

  it('saves the entire investigation without opening or selecting optional tools', () => {
    const filename = `investigation_everything_${Date.now()}.microbetrace`;
    const path = `${Cypress.config('downloadsFolder')}/${filename}`;
    let expected: any;
    cy.visit('/?skipEula=1&skipDemoSession=1');
    cy.get('#fileDropRef').selectFile('cypress/fixtures/investigation/02-configured.microbetrace', { force: true });
    cy.window({ timeout: 30000 }).should((win: any) => {
      expect(win.commonService.session.data.nodes).to.have.length(6);
      expect(win.commonService.session.network.isFullyLoaded).to.equal(true);
    });
    installSaveAsCaptureHook();
    cy.window().then((win: any) => {
      const { cohorts, selectedCohortIds, edgeLayers, annotations, scopes, calculations } = win.commonService.session.investigation;
      expected = JSON.parse(JSON.stringify({ cohorts, selectedCohortIds, edgeLayers, annotations, scopes,
        outputs: Object.fromEntries(Object.entries(calculations).map(([operation, record]: [string, any]) => [operation, record.output])) }));
    });
    cy.get('[data-testid="app-file-menu-button"]').click();
    cy.get('[data-testid="app-file-menu-investigation"]').click();
    cy.get('[data-testid="investigation-tools"]').should('not.have.attr', 'open');
    cy.get('[aria-label="New cohort name"]').should('not.be.visible');
    cy.get('#scope-network-statistics').should('not.be.visible');
    cy.get('[data-testid="investigation-save"]').should('be.visible').click();
    cy.get('#session-stash-modal #stash-name').should('be.visible').type(filename.replace('.microbetrace', ''));
    cy.get('#save-file-compress').uncheck();
    cy.get('#stash-data').click();
    writeCapturedDownloadToDisk(filename, path);
    cy.readFile(path).then(raw => {
      const saved = JSON.parse(String(raw));
      for (const field of ['cohorts', 'selectedCohortIds', 'edgeLayers', 'annotations', 'scopes']) {
        expect(saved.investigation[field], field).to.deep.equal(expected[field]);
      }
      for (const [operation, output] of Object.entries(expected.outputs)) expect(saved.investigation.calculations[operation].output).to.deep.equal(output);
      for (const field of ['threshold', 'filters', 'layout', 'grouping']) expect(saved.investigation[field], field).to.exist;
      expect(saved.session.data.nodes).to.have.length(6);
      expect(saved.provenance.snapshotId).to.equal(saved.snapshotId);
    });
  });

  for (const format of ['file', 'compressed', 'local-link'] as const) {
    it(`reopens all completed and stale results without replacement calculations through ${format}`, () => {
      const name = `investigation_no_recompute_${format}_${Date.now()}`;
      const extension = format === 'compressed' ? 'zip' : 'microbetrace';
      const filename = `${name}.${extension}`, path = `${Cypress.config('downloadsFolder')}/${filename}`;
      let expected: any, expectedBootstrap: any, expectedTree: string;
      const monitor: RestoreMonitor = {};
      prepareAllCompletedResults();
      installSaveAsCaptureHook();
      if (format === 'local-link') {
        cy.get('[data-testid="app-file-menu-button"]').click();
        cy.contains('button[mat-menu-item]', 'Save').click();
        cy.get('#stash-name').type(name);
        cy.get('#session-stash-modal p-select').click();
        cy.contains('li[role="option"]', 'Local link').click();
        cy.get('#stash-data').click();
        cy.get('#local-session-link-url').should('be.visible');
      } else {
        saveSessionFromFileMenu(name, { compress: format === 'compressed' });
        writeCapturedDownloadToDisk(filename, path);
      }
      cy.window().then((win: any) => {
        const { investigation, data } = win.commonService.session;
        expected = JSON.parse(JSON.stringify(investigation.calculations));
        expectedBootstrap = JSON.parse(JSON.stringify(data.phylogeneticBootstrap));
        expectedTree = data.newickString;
        expect(expected['network-statistics'].status).to.equal('stale');
        expect(expected.consensus.status).to.equal('completed');
      });
      if (format === 'local-link') {
        cy.get('#local-session-link-url').invoke('val').then(value => cy.visit(String(value), { onBeforeLoad: monitorRestore(monitor) }));
      } else {
        cy.visit('/?skipEula=1&skipDemoSession=1', { onBeforeLoad: monitorRestore(monitor) });
        cy.get('#fileDropRef').selectFile(path, { force: true });
      }
      waitForProcessingDialogToClear(60000);
      cy.window({ timeout: 30000 }).should((win: any) => {
        expect(win.commonService.session.network.isFullyLoaded).to.equal(true);
        expect(win.commonService.session.investigation.calculations).to.deep.equal(expected);
      });
      // Activate each saved analysis view and wait for its own readiness signal.
      // Looking at the loaded flag alone would miss work started by lazy views.
      cy.get('[data-testid="app-view-menu-button"]').click();
      cy.contains('button[mat-menu-item]', 'Phylogenetic Tree').click();
      assertPhyloTreeReady();
      cy.get('[data-testid="app-view-menu-button"]').click();
      cy.contains('button[mat-menu-item]', 'Network Statistics').click();
      cy.window({ timeout: 30000 }).should((win: any) => {
        const common = win.commonService;
        expect(common.visuals.networkStatistics?.networkStatisticsLoading).to.equal(false);
        expect(common.visuals.networkStatistics?.networkStatisticsResult).to.deep.equal(expected['network-statistics'].output);
        expect(common.visuals.networkStatistics?.networkStatisticsError).to.contain('stale');
        expect(common.session.investigation.calculations).to.deep.equal(expected);
        expect(common.session.data.newickString).to.equal(expectedTree);
        expect(common.session.data.phylogeneticBootstrap).to.deep.equal(expectedBootstrap);
        expect(monitor.runs, 'calculation monitor installed before restore').to.exist;
        expect(monitor.runs!.getCalls().filter(call => call.args[0]?.data?.nodes?.length), 'replacement calculations').to.have.length(0);
        const analyticalMessages = monitor.messages!.getCalls().filter(call => {
          const request = call.args[0];
          return request?.task && !['parseFasta', 'triangulation'].includes(request.task)
            || ['RUN_BATCH', 'BUILD_EDGES', 'BUILD_MST_EDGES', 'BUILD_NEAREST_NEIGHBOR_EDGES', 'EXPORT_MATRIX'].includes(request?.type);
        });
        expect(analyticalMessages, 'analysis worker dispatches after reopening').to.have.length(0);
      });
    });
  }
});
