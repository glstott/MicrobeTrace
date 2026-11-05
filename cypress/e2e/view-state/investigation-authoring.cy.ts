/// <reference types="cypress" />
import JSZip from 'jszip';
import { installSaveAsCaptureHook, writeCapturedDownloadToDisk } from '../../support/journey-helpers';

function loadInvestigation() {
  cy.visit('/?skipEula=1&skipDemoSession=1');
  cy.get('#fileDropRef').selectFile('cypress/fixtures/investigation/02-configured.microbetrace', { force: true });
  cy.window({ timeout: 30000 }).should((win: any) => {
    expect(win.commonService.session.network.isFullyLoaded).to.equal(true);
    expect(win.commonService.session.tabLoaded).to.equal(true);
    expect(win.commonService.session.data.nodes).to.have.length(6);
  });
  cy.get('[role="application"][aria-label="Network visualization"]').should('be.visible');
}

function openNotes() {
  cy.get('[data-testid="app-file-menu-button"]').click();
  cy.get('[data-testid="app-file-menu-investigation"]').click();
  cy.get('[data-testid="investigation-tools"] > summary').click();
  cy.get('[data-testid="investigation-note-tools"] > summary').click();
}
function closePanel() {
  cy.get('[data-testid="investigation-panel"]').closest('.p-dialog').find('button.p-dialog-close-button').click();
}
function searchTarget(type: string, query: string) {
  cy.get('[aria-label="Note target type"]').select(type);
  cy.get('[data-testid="note-target-picker"] .p-multiselect-label-container').click();
  cy.get('[aria-label="Search note targets"]').should('be.visible').clear().type(query);
}
function finishTarget() {
  cy.get('[aria-label="Search note targets"]').type('{esc}');
  cy.get('[aria-label="Search note targets"]').should('not.exist');
}
function saveNote(text: string, count = 1) {
  cy.get('[aria-label="New annotation"]').type(text);
  cy.contains('button', count > 1 ? `Save notes (${count})` : /^Save note$/).click();
}

describe('Investigation authoring and save feedback', () => {
  it('reopens named and selected targets with exact memberships, timestamps, and stale explanations', () => {
    loadInvestigation(); installSaveAsCaptureHook();
    cy.get('[data-testid="app-file-menu-button"]').click();
    cy.get('[data-testid="app-file-menu-investigation"]').click();
    cy.get('[data-testid="investigation-unlinked-notes"]').click();
    cy.get('[data-testid="investigation-tools"]').should('have.prop', 'open', true);
    cy.get('[data-testid="investigation-note-tools"]').should('have.prop', 'open', true);
    cy.get('[aria-label="Search notes"]').should('be.focused').type('DELETED-REVIEW-COHORT');
    cy.get('#investigation-note-review textarea').should('have.length', 1).and('have.attr', 'aria-label', 'Edit note note-orphan');
    cy.get('[data-testid="investigation-linked-notes"]').click();
    cy.get('[aria-label="Search notes"]').should('have.value', '').type('Case A');
    cy.get('#investigation-note-review textarea').should('have.length', 1).and('have.attr', 'aria-label', 'Edit note note-node-A');
    cy.get('[aria-label="Search notes"]').clear().type('no matching note');
    cy.get('#investigation-note-review').should('contain', 'No notes match these filters.');
    cy.contains('#investigation-note-review button', /^Clear filters$/).click();
    cy.get('#investigation-note-review textarea').should('have.length', 4);
    searchTarget('node', 'Case D');
    cy.contains('[role="option"]', 'Case D [D] (hidden)').should('be.visible').click();
    finishTarget(); saveNote('Cypress named hidden node');
    cy.get('[data-testid="note-use-selected-nodes"]').should('contain', '(3)').click();
    saveNote('Cypress selected population', 3);
    searchTarget('edge', 'C-D');
    cy.contains('[role="option"]', '[C-D]').should('contain', 'Case C — Case D');
    cy.get('[aria-label="Search note targets"]').type('{downarrow}{enter}');
    cy.contains('[role="option"]', '[C-D]').should('have.attr', 'aria-selected', 'true');
    finishTarget(); saveNote('Cypress keyboard relationship');
    searchTarget('cohort', 'Left review');
    cy.contains('[role="option"]', 'Left review [cohort-left]').click();
    finishTarget(); saveNote('Cypress named cohort');

    cy.get('[data-testid="investigation-calculation-tools"] > summary').click();
    const row = () => cy.contains('.scope-row', 'Network statistics');
    let priorRun: string, expectedNotes: any[], savedRun: any;
    cy.window().then((win: any) => priorRun = win.commonService.session.investigation.calculations['network-statistics'].id);
    row().contains('button', /^Run$/).click();
    cy.window({ timeout: 30000 }).should((win: any) => {
      const run = win.commonService.session.investigation.calculations['network-statistics'];
      expect(run.status).to.equal('completed'); expect(run.id).not.to.equal(priorRun);
    });
    cy.get('#scope-network-statistics').select('full');
    cy.get('[data-testid="investigation-summary"]').should('contain', '1 stale result').and('contain', '9 linked notes').and('contain', '1 unlinked note');
    cy.get('[data-testid="investigation-stale-details"] > summary').click();
    cy.get('[data-testid="investigation-stale-details"]').should('contain', 'Calculation scope changed.');
    cy.window().then((win: any) => {
      const session = win.commonService.session;
      const notes = session.investigation.annotations;
      expect(notes.find((note: any) => note.text === 'Cypress named hidden node').target).to.deep.equal({ type: 'node', id: 'D' });
      expect(notes.filter((note: any) => note.text === 'Cypress selected population').map((note: any) => note.target.id).sort()).to.deep.equal(['A', 'B', 'D']);
      expect(notes.find((note: any) => note.text === 'Cypress keyboard relationship').target).to.deep.equal({ type: 'edge', id: 'C-D' });
      expect(notes.find((note: any) => note.text === 'Cypress named cohort').target).to.deep.equal({ type: 'cohort', id: 'cohort-left' });
      expect(session.data.nodes.find((node: any) => node._id === 'D').visible).to.equal(false);
      expectedNotes = JSON.parse(JSON.stringify(notes));
      savedRun = JSON.parse(JSON.stringify(session.investigation.calculations['network-statistics']));
    });
    cy.get('[data-testid="investigation-unlinked-notes"]').click();
    cy.get('[aria-label="Search notes"]').type('deleted-review-cohort');
    cy.get('#investigation-note-review textarea').should('have.length', 1);
    cy.get('[data-testid="investigation-save"]').should('not.be.disabled').click();
    cy.get('#stash-name').type('authoring-roundtrip');
    cy.get('#session-stash-modal p-select').should('contain', 'Investigation bundle (.zip)'); cy.get('#stash-data').click();
    cy.get('[data-testid="session-save-notice"]').should('contain', 'authoring-roundtrip.zip');
    const path = `${Cypress.config('downloadsFolder')}/authoring-roundtrip.zip`;
    writeCapturedDownloadToDisk('authoring-roundtrip.zip', path);
    cy.readFile(path, 'base64').then(async encoded => {
      const zip = await JSZip.loadAsync(encoded, { base64: true });
      const manifest = JSON.parse(await zip.file('investigation-manifest.json')!.async('text'));
      const html = await zip.file('investigation-record.html')!.async('text');
      expect(manifest.investigation.annotations).to.deep.equal(expectedNotes);
      expect(manifest.investigation.calculations['network-statistics'].staleReasons).to.include('Calculation scope changed.');
      expect(html).to.include('Calculation scope changed.');
    });
    cy.visit('/?skipEula=1&skipDemoSession=1'); cy.get('#fileDropRef').selectFile(path, { force: true });
    cy.window({ timeout: 30000 }).should((win: any) => {
      const session = win.commonService.session;
      expect(session.network.isFullyLoaded).to.equal(true);
      expect(session.investigation.annotations).to.deep.equal(expectedNotes);
      expect(session.investigation.calculations['network-statistics']).to.deep.equal(savedRun);
    });
  });

  it('shows save errors in place and blocks duplicate submissions while a complete bundle is prepared', () => {
    loadInvestigation(); installSaveAsCaptureHook();
    let releaseCapture: () => void, session: any, previousResult: any;
    const captureGate = new Promise<void>(resolve => releaseCapture = resolve);
    cy.window().then((win: any) => {
      const common = win.commonService, capture = common.investigationSessions.capture.bind(common.investigationSessions);
      session = common.session; previousResult = session.investigation.calculations['network-statistics'];
      let fail = true;
      cy.stub(common.investigationSessions, 'capture').callsFake(async (stash: any) => {
        if (fail) { fail = false; throw new win.Error('Synthetic snapshot preparation failure'); }
        await captureGate; return capture(stash);
      }).as('capture');
    });
    cy.get('[data-testid="app-file-menu-button"]').click(); cy.contains('button[mat-menu-item]', /^Save$/).click();
    cy.get('#stash-name').type('save-feedback'); cy.get('#session-stash-modal p-select').should('contain', 'Investigation bundle (.zip)'); cy.get('#stash-data').click();
    cy.get('#session-stash-modal [role="alert"]').should('contain', 'Synthetic snapshot preparation failure');
    cy.get('#stash-name').should('have.value', 'save-feedback');
    cy.get('#stash-data').should('not.be.disabled').click();
    cy.get('[data-testid="session-save-progress"]').should('be.visible').and('contain', 'Preparing investigation');
    cy.get('#stash-name').should('be.disabled');
    cy.get('#stash-data').should('be.disabled').then($button => { $button[0].click(); $button[0].click(); });
    cy.get('@capture').should('have.been.calledTwice');
    cy.window().then((win: any) => {
      expect(win.__mtCapturedDownloads).to.have.length(0);
      expect(win.commonService.session).to.equal(session);
      expect(session.investigation.calculations['network-statistics']).to.equal(previousResult);
    });
    cy.then(() => releaseCapture());
    cy.get('[data-testid="session-save-notice"]').should('contain', 'save-feedback.zip');
    cy.get('#session-stash-modal').should('not.be.visible');
    writeCapturedDownloadToDisk('save-feedback.zip', `${Cypress.config('downloadsFolder')}/save-feedback.zip`);
    cy.get('@capture').should('have.been.calledTwice');
  });

  it('attaches the selected Waterfall relationship by stable edge ID and clears the shortcut when its pane closes', () => {
    loadInvestigation();
    cy.get('[data-testid="app-view-menu-button"]').click(); cy.contains('button[mat-menu-item]', /^Waterfall$/).click();
    cy.contains('.lm_tab', 'Waterfall').click();
    cy.get('#waterfall-cluster-table-container tbody tr.ui-selectable-row').first().click();
    cy.contains('#waterfall-node-table-container tbody tr.ui-selectable-row', /^A/).click();
    cy.get('#waterfall-link-table-container tbody tr.ui-selectable-row').first().click();
    let edgeId: string;
    cy.window().then((win: any) => edgeId = win.commonService.visuals.waterfall.selectedLinkRow._investigationEdgeId);
    openNotes();
    cy.get('[data-testid="note-use-selected-edges"]').should('contain', '(1)').click();
    saveNote('Cypress selected Waterfall relationship');
    cy.window().should((win: any) => {
      const note = win.commonService.session.investigation.annotations.find((note: any) => note.text === 'Cypress selected Waterfall relationship');
      expect(note.target).to.deep.equal({ type: 'edge', id: edgeId });
    });
    closePanel();
    cy.contains('.lm_tab', 'Waterfall').find('.lm_close_tab').click();
    openNotes(); cy.get('[data-testid="note-use-selected-edges"]').should('not.exist');
  });
});
