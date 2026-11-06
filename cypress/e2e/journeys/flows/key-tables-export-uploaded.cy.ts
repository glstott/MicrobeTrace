/// <reference types="cypress" />
import { assertInvestigationImageBundle, rememberInvestigationImageInputs } from '../../../support/investigation-export-helpers';
import { expandAccordionTabByHeader, openGlobalStylingTab, openTwoDSettingsDialog } from '../../../support/journey-helpers';

describe('Journey Flow - Key-table image exports in investigation bundles', () => {
  beforeEach(() => {
    cy.visit('/?skipEula=1&skipDemoSession=1');
    cy.get('#fileDropRef').selectFile('cypress/fixtures/investigation/02-configured.microbetrace', { force: true });
    cy.window({ timeout: 30000 }).should((win: any) => {
      expect(win.commonService.session.network.isFullyLoaded).to.equal(true);
      expect(win.commonService.session.tabLoaded).to.equal(true);
      expect(win.commonService.pendingDashboardRestore).not.to.exist;
      expect(win.commonService.visuals.microbeTrace.applyingPendingDashboardRestore).to.equal(false);
    });
    openGlobalStylingTab();
    cy.get('#node-symbol-variable').find('.p-select-dropdown').click({ force: true });
    cy.contains('.p-select-overlay:visible li[role="option"]', /^Ward$/).click();
    cy.window().its('commonService.session.style.widgets.node-symbol-variable').should('equal', 'Ward');
    cy.closeGlobalSettings();

    openTwoDSettingsDialog();
    cy.get('@twoDSettings').contains('.nav-link', 'Grouping').click();
    cy.get('@twoDSettings').find('.tab-pane:visible').as('keyTableGrouping');
    expandAccordionTabByHeader('@keyTableGrouping', 'Colors');
    cy.get('@keyTableGrouping').find('#colorPolygons').contains('Show').click();
    cy.window().its('commonService.session.style.widgets.polygons-color-show').should('equal', true);
    cy.get('@keyTableGrouping').find('#polygon-color-table-toggle').contains('Show').click();
    cy.closeSettingsPane('2D Network Settings');
  });

  for (const format of ['png', 'svg'] as const) {
    it(`retains the exact ${format.toUpperCase()} export of node colors, link colors, shapes and groups with its supporting records`, () => {
      const filename = `key-tables-${format}-${Date.now()}`;
      const path = `${Cypress.config('downloadsFolder')}/${filename}.${format}`;
      cy.get('[data-testid="app-file-menu-button"]').click();
      cy.contains('button[mat-menu-item]', /^Export Tables$/).click();
      cy.contains('.p-dialog-title', /^Export Tables$/).parents('.p-dialog').as('keyTableExport');
      cy.get('@keyTableExport').find('input[placeholder="Filename"]').clear().type(filename);
      cy.get('@keyTableExport').find('select').select(format);
      for (const id of ['checkbox1', 'checkbox2', 'checkbox3', 'checkbox4']) {
        cy.get('@keyTableExport').find(`#${id}`).should('not.be.disabled').check();
      }
      rememberInvestigationImageInputs('keyTableImageInputs');
      cy.get('@keyTableExport').find('#network-export').click();
      cy.readFile(path, 'base64', { timeout: 60000, log: false }).should(encoded => {
        expect(encoded.length, 'nonempty key-table image').to.be.greaterThan(100);
      });
      assertInvestigationImageBundle([{ path, view: 'Key tables', inputsAlias: 'keyTableImageInputs' }]);
    });
  }
});
