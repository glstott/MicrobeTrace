/// <reference types="cypress" />
import JSZip from 'jszip';
import { installSaveAsCaptureHook, writeCapturedDownloadToDisk } from '../../support/journey-helpers';

const notice = '[data-testid="session-save-notice"]';
const dismiss = `${notice} button[aria-label="Dismiss download notification"]`;

function openSave(name: string) {
  cy.get('[data-testid="app-file-menu-button"]').click();
  cy.contains('button[mat-menu-item]', /^Save$/).click();
  cy.get('#stash-name').should('be.visible').clear().type(name);
}

function saveSession(name: string, compress = false) {
  openSave(name);
  if (compress) cy.get('#save-file-compress').check();
  else cy.get('#save-file-compress').uncheck();
  cy.get('#stash-data').should('not.be.disabled').click();
  cy.get(notice).should('be.visible').and('contain', `${name}.${compress ? 'zip' : 'microbetrace'}`);
  cy.get('#session-stash-modal').should('not.be.visible');
}

describe('Session download notification', () => {
  beforeEach(() => {
    cy.visit('/?skipEula=1&skipDemoSession=1');
    cy.get('#fileDropRef').selectFile('cypress/fixtures/investigation/02-configured.microbetrace', { force: true });
    cy.window({ timeout: 30000 }).should((win: any) => {
      expect(win.commonService.session.network.isFullyLoaded).to.equal(true);
      expect(win.commonService.session.tabLoaded).to.equal(true);
      expect(win.commonService.session.data.nodes).to.have.length(6);
    });
    cy.get('[role="application"][aria-label="Network visualization"]').should('be.visible');
    installSaveAsCaptureHook();
  });

  it('dismisses a compressed-download notice by mouse without losing the complete bundle', () => {
    saveSession('notice-bundle', true);
    cy.get(dismiss).should('be.visible').click();
    cy.get(notice).should('not.exist');
    const path = `${Cypress.config('downloadsFolder')}/notice-bundle.zip`;
    writeCapturedDownloadToDisk('notice-bundle.zip', path);
    cy.readFile(path, 'base64').then(async encoded => {
      const zip = await JSZip.loadAsync(encoded, { base64: true });
      expect(Object.keys(zip.files).sort()).to.deep.equal([
        'investigation-manifest.json', 'investigation-record.html', 'notice-bundle.microbetrace',
      ]);
      const snapshot = JSON.parse(await zip.file('notice-bundle.microbetrace')!.async('text'));
      expect(snapshot.session.data.nodes).to.have.length(6);
    });
    cy.get('[role="application"][aria-label="Network visualization"]').should('be.visible');
  });

  it('dismisses a style-download notice with the keyboard and preserves the style file', () => {
    openSave('notice-style');
    cy.get('#session-stash-modal p-select').click();
    cy.contains('li[role="option"]', /^style$/).click();
    cy.get('#stash-data').click();
    cy.get(notice).should('be.visible').and('contain', 'notice-style.style');
    cy.get('#session-stash-modal').should('not.be.visible');
    cy.get(dismiss).focus().type('{enter}');
    cy.get(notice).should('not.exist');
    const path = `${Cypress.config('downloadsFolder')}/notice-style.style`;
    writeCapturedDownloadToDisk('notice-style.style', path);
    cy.readFile(path, 'utf8').then(text => expect(JSON.parse(text)).to.have.property('widgets'));
  });

  it('automatically removes a plain-session notice while keeping the saved session available', () => {
    saveSession('notice-automatic');
    cy.get(notice, { timeout: 7000 }).should('not.exist');
    const path = `${Cypress.config('downloadsFolder')}/notice-automatic.microbetrace`;
    writeCapturedDownloadToDisk('notice-automatic.microbetrace', path);
    cy.readFile(path, 'utf8').then(text => expect(JSON.parse(text).session.data.nodes).to.have.length(6));
    openSave('notice-after-expiry');
    cy.get('#stash-data').should('not.be.disabled');
    cy.get('#session-stash-modal').contains('button', /^Cancel$/).click();
    cy.get(notice).should('not.exist');
  });

  it('gives a consecutive download its own lifetime without an older timer hiding it', () => {
    saveSession('notice-first');
    cy.wait(3000);
    saveSession('notice-second');
    cy.wait(2500);
    cy.get(notice).should('be.visible').and('contain', 'notice-second.microbetrace');
    cy.get(notice, { timeout: 7000 }).should('not.exist');
    cy.window().should((win: any) => {
      expect(win.__mtCapturedDownloads.map((file: any) => file.fileName)).to.deep.equal([
        'notice-first.microbetrace', 'notice-second.microbetrace',
      ]);
      expect(win.commonService.session.data.nodes).to.have.length(6);
    });
  });
});
