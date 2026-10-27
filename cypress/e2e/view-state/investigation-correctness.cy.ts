/// <reference types="cypress" />
import JSZip from 'jszip';
import {
  installSaveAsCaptureHook, openGlobalFilteringTab, saveSessionFromFileMenu,
  writeCapturedDownloadToDisk,
} from '../../support/journey-helpers';

const kit = 'docs/testing/investigation-manual-kit/';
const openPanel = () => {
  cy.get('[data-testid="app-investigation-button"]').click();
  cy.get('[aria-label="New cohort name"]').should('have.focus');
};
const closePanel = () => cy.get('[data-testid="investigation-panel"]').closest('.p-dialog')
  .find('button.p-dialog-close-button').click();
const row = (label: string) => cy.contains('.scope-row', label);

function loadKit(file = '02-configured.microbetrace', count = 6) {
  cy.visit('/?skipEula=1&skipDemoSession=1');
  cy.get('#fileDropRef').selectFile(kit + file, { force: true });
  cy.window({ timeout: 30000 }).should((win: any) => {
    expect(win.commonService.session.data.nodes).to.have.length(count);
    expect(win.commonService.session.network.isFullyLoaded).to.equal(true);
  });
  cy.get('[role="application"][aria-label="Network visualization"]').should('be.visible');
}

function linkRule(field: string, operator: string, value: string) {
  openGlobalFilteringTab();
  cy.get('#network-subset-link-field').select(field);
  cy.get('#network-subset-link-operator').select(operator);
  cy.get('#network-subset-link-value').clear().type(value);
  cy.get('#network-subset-apply').click();
  cy.closeGlobalSettings();
}

describe('Investigation correctness regressions', () => {
  it('retains explicit visible link rules through weighted and imported-tree calculations', () => {
    loadKit();
    cy.get('[data-testid="network-subset-filter-clear"]').click();
    linkRule('Relationship', 'equals', 'Genetic');
    openPanel();
    cy.get('#scope-mst').select('visible');
    row('Minimum spanning tree').should('contain', '5 eligible nodes').and('contain', '8 edges');
    row('Minimum spanning tree').contains('button', 'Run').click();
    cy.window({ timeout: 30000 }).should((win: any) => {
      const run = win.commonService.session.investigation.calculations.mst;
      expect(run?.status).to.equal('completed');
      expect(run.scope).to.equal('visible');
      expect([...run.edgeIds].sort()).to.deep.equal(['A-B', 'A-C', 'A-D', 'A-E', 'B-D', 'B-E', 'C-E', 'D-E']);
    });
    cy.get('#scope-mst').select('cohort');
    row('Minimum spanning tree').should('contain', '4 eligible nodes').and('contain', '6 edges');
    cy.get('#scope-mst').select('full');
    row('Minimum spanning tree').should('contain', '6 eligible nodes').and('contain', '10 edges');

    loadKit('03-imported-tree.microbetrace', 5);
    linkRule('distance', 'gte', '2');
    openPanel();
    cy.get('#scope-mst').select('visible');
    row('Minimum spanning tree').should('contain', '5 eligible nodes').and('contain', '8 edges');
    row('Minimum spanning tree').contains('button', 'Run').click();
    cy.window({ timeout: 30000 }).should((win: any) => {
      const session = win.commonService.session;
      const run = session.investigation.calculations.mst;
      expect(run?.status).to.equal('completed');
      expect(run.edgeIds).to.have.length(8).and.not.include('A-B').and.not.include('D-E');
      expect(session.data.links.find((link: any) => link.id === 'A-B').nn).not.to.equal(true);
      expect(session.data.links.find((link: any) => link.id === 'D-E').nn).not.to.equal(true);
    });
    cy.get('#scope-distance-matrix').select('visible');
    row('Distance matrix').contains('button', 'Run').click();
    cy.window({ timeout: 30000 }).should((win: any) => {
      const run = win.commonService.session.investigation.calculations['distance-matrix'];
      expect(run?.status).to.equal('completed');
      const { labels, dm } = run.output.value;
      expect(dm[labels.indexOf('A')][labels.indexOf('B')]).to.equal(null);
    });
  });

  it('rejects publication metadata drift without replacing the open investigation', () => {
    loadKit();
    let current: any;
    openPanel();
    cy.get('[aria-label="New annotation"]').type('KEEP UNSAVED INVESTIGATION');
    cy.contains('button', 'Save note').click();
    closePanel();
    cy.get('[data-testid="app-file-menu-button"]').click();
    cy.contains('button[mat-menu-item]', 'Add Data').click();
    cy.get('#data-files1').should('exist');
    cy.window().then((win: any) => { current = win.commonService.session; });
    const mutations: Array<[string, (saved: any) => void, string]> = [
      ['counts', saved => saved.provenance.counts.nodes = 999, 'counts do not match'],
      ['capture-date', saved => saved.provenance.capturedAt = 'invalid date', 'provenance metadata is invalid'],
      ['software', saved => saved.provenance.software.version = 'incorrect-version', 'checksum does not match'],
      ['valid-date', saved => saved.provenance.capturedAt = '2020-01-01T00:00:00.000Z', 'checksum does not match'],
    ];
    mutations.forEach(([name, change, message]) => {
      cy.readFile(kit + '02-configured.microbetrace').then(raw => {
        const saved = JSON.parse(String(raw));
        change(saved);
        cy.get('#data-files1').selectFile({ contents: Cypress.Buffer.from(JSON.stringify(saved)),
          fileName: `invalid-${name}.microbetrace`, mimeType: 'application/json' }, { force: true });
      });
      cy.get('[data-testid="investigation-load-error"]').should('contain', message);
      cy.window().should((win: any) => {
        expect(win.commonService.session).to.equal(current);
        expect(current.investigation.annotations.some((note: any) => note.text === 'KEEP UNSAVED INVESTIGATION')).to.equal(true);
        expect(current.investigation.selectedCohortIds).to.deep.equal(['cohort-left', 'cohort-right']);
      });
    });
  });

  it('saves last valid text while drafts are empty, then persists corrected edits and local links', () => {
    loadKit();
    installSaveAsCaptureHook();
    openPanel();
    cy.get('[aria-label="Cohort name"]').first().clear().blur();
    cy.contains('[role="alert"]', 'previous cohort name will be saved').scrollIntoView().should('be.visible');
    cy.get('[aria-label="Edit note note-node-A"]').clear().blur();
    cy.contains('[role="alert"]', 'previous note text will be saved').scrollIntoView().should('be.visible');
    cy.window().should((win: any) => {
      const investigation = win.commonService.session.investigation;
      expect(investigation.cohorts[0].name).to.equal('Left review');
      expect(investigation.annotations.find((note: any) => note.id === 'note-node-A').text).to.equal('Review case A.');
    });
    cy.contains('button', 'Download investigation record').click();
    const recordPath = `${Cypress.config('downloadsFolder')}/investigation-focused-record.zip`;
    writeCapturedDownloadToDisk('investigation-record.zip', recordPath);
    cy.readFile(recordPath, 'base64').then(async encoded => {
      const zip = await JSZip.loadAsync(encoded, { base64: true });
      const manifest = JSON.parse(await zip.file('investigation-manifest.json')!.async('text'));
      expect(manifest.schemaVersion).to.equal(2);
      expect(manifest.investigation.cohorts[0].name).to.equal('Left review');
      expect(manifest.investigation.annotations.find((note: any) => note.id === 'note-node-A').text).to.equal('Review case A.');
    });
    cy.get('[aria-label="Cohort name"]').first().type('Revised left review').blur();
    cy.get('[aria-label="Edit note note-node-A"]').type('Revised case A note').blur();
    cy.get('[aria-label="Cohort name"]').first().should('have.attr', 'aria-invalid', 'false');
    cy.get('[aria-label="Edit note note-node-A"]').should('have.attr', 'aria-invalid', 'false');
    closePanel();
    const name = `investigation_corrected_${Date.now()}`;
    const sessionPath = `${Cypress.config('downloadsFolder')}/${name}.microbetrace`;
    saveSessionFromFileMenu(name, { compress: false });
    writeCapturedDownloadToDisk(`${name}.microbetrace`, sessionPath);
    cy.readFile(sessionPath).then(raw => {
      const saved = JSON.parse(String(raw));
      expect(saved.schemaVersion).to.equal(2);
      expect(saved.investigation.cohorts[0].name).to.equal('Revised left review');
      expect(saved.investigation.annotations.find((note: any) => note.id === 'note-node-A').text).to.equal('Revised case A note');
    });
    cy.visit('/?skipEula=1&skipDemoSession=1');
    cy.get('#fileDropRef').selectFile(sessionPath, { force: true });
    cy.window({ timeout: 30000 }).should((win: any) => {
      expect(win.commonService.session.investigation.cohorts[0]?.name).to.equal('Revised left review');
      expect(win.commonService.session.network.isFullyLoaded).to.equal(true);
    });
    cy.get('[data-testid="app-file-menu-button"]').click();
    cy.contains('button[mat-menu-item]', 'Save').click();
    cy.get('#stash-name').type('Focused investigation local link');
    cy.get('#session-stash-modal p-select').click();
    cy.contains('li[role="option"]', 'Local link').click();
    cy.get('#stash-data').click();
    cy.get('#local-session-link-url').should('be.visible').invoke('val').then(value => cy.visit(String(value)));
    cy.window({ timeout: 30000 }).should((win: any) => {
      const investigation = win.commonService.session.investigation;
      expect(investigation.cohorts[0]?.name).to.equal('Revised left review');
      expect(investigation.annotations.find((note: any) => note.id === 'note-node-A').text).to.equal('Revised case A note');
      expect(investigation.selectedCohortIds).to.deep.equal(['cohort-left', 'cohort-right']);
    });
  });
});
