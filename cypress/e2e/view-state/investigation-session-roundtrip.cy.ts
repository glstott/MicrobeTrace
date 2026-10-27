/// <reference types="cypress" />
import JSZip from 'jszip';
import { installSaveAsCaptureHook, saveSessionFromFileMenu, writeCapturedDownloadToDisk } from '../../support/journey-helpers';

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
    cy.get('[data-testid="app-investigation-button"]').click();
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
    cy.contains('.p-dialog', 'Save the investigation').find('button.p-dialog-close-button').click();
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
});
