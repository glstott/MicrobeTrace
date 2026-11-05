/// <reference types="cypress" />
import JSZip from 'jszip';
import { installSaveAsCaptureHook, writeCapturedDownloadToDisk } from '../../support/journey-helpers';

describe('Exported visualization images in reproducibility reports', () => {
  it('retains exact repeated PNG/SVG exports in the bundle, embeds them offline, and reopens without regenerating them', () => {
    cy.visit('/?skipEula=1&skipDemoSession=1');
    cy.get('#fileDropRef').selectFile('cypress/fixtures/investigation/02-configured.microbetrace', { force: true });
    cy.window({ timeout: 30000 }).should((win: any) => {
      expect(win.commonService.session.network.isFullyLoaded).to.equal(true);
      expect(win.commonService.session.tabLoaded).to.equal(true);
    });
    installSaveAsCaptureHook();
    for (const [index, type] of ['png', 'png', 'svg'].entries()) {
      cy.get('#tool-btn-container a[title="Export Screen"]:visible').first().click();
      cy.contains('.p-dialog-title', 'Export Network Image').parents('.p-dialog').as('imageExport');
      cy.get('@imageExport').find('#network-export-filename').clear().type('repeated-image');
      cy.get('@imageExport').find('#network-export-filetype').click();
      cy.contains('li[role="option"]', new RegExp(`^${type}$`)).click();
      cy.get('@imageExport').find('#network-export').click();
      cy.window({ timeout: 30000 }).should((win: any) => expect(win.commonService.session.investigation.figures).to.have.length(index + 1));
    }
    cy.get('[data-testid="app-view-menu-button"]').click();
    cy.contains('button[mat-menu-item]', /^Heatmap$/).click();
    cy.get('#heatmap svg').should('be.visible');
    cy.get('#heatmap').parent().parent().find('a[title="Export Screen"]').click();
    cy.contains('.p-dialog-title', 'Export Heatmap').parents('.p-dialog').as('heatmapExport');
    cy.get('@heatmapExport').find('#tree-image-filename').clear().type('heatmap-report');
    cy.get('@heatmapExport').find('#network-export-filetype').click();
    cy.contains('li[role="option"]', /^svg$/).click();
    cy.get('@heatmapExport').find('#export-tree').click();
    let expected: any[], expectedEvidence: any, originalRunId: string, replacementRunId: string, recordHtml: string;
    cy.window({ timeout: 30000 }).should((win: any) => expect(win.commonService.session.investigation.figures).to.have.length(4));
    cy.get('@heatmapExport').find('button.p-dialog-close-button').click();
    cy.window({ timeout: 30000 }).should((win: any) => expect(win.__mtCapturedDownloads).to.have.length(4));
    cy.window().then((win: any) => {
      expected = JSON.parse(JSON.stringify(win.commonService.session.investigation.figures));
      expectedEvidence = JSON.parse(JSON.stringify(win.commonService.session.investigation.figureEvidence));
      originalRunId = win.commonService.session.investigation.calculations['network-statistics'].id;
      const downloads = win.__mtCapturedDownloads;
      for (const figure of expected) {
        expect(downloads.some((file: any) => file.fileName === figure.filename && file.dataUrl.split(',')[1] === figure.dataUrl.split(',')[1]), figure.filename).to.equal(true);
        expect(figure.width).to.be.greaterThan(0); expect(figure.height).to.be.greaterThan(0);
      }
      expect(new Set(expected.map(figure => figure.id)).size).to.equal(4);
    });
    cy.get('[data-testid="app-file-menu-button"]').click();
    cy.get('[data-testid="app-file-menu-investigation"]').click();
    cy.get('[data-testid="investigation-tools"] > summary').click();
    cy.get('[data-testid="investigation-calculation-tools"] > summary').click();
    cy.get('#scope-network-statistics').select('full');
    cy.contains('.scope-row', 'Network statistics').contains('button', /^Run$/).click();
    cy.window({ timeout: 30000 }).should((win: any) => {
      const current = win.commonService.session.investigation;
      expect(current.calculations['network-statistics'].id).not.to.equal(originalRunId);
      expect(current.figureEvidence).to.deep.equal(expectedEvidence);
    }).then((win: any) => replacementRunId = win.commonService.session.investigation.calculations['network-statistics'].id);
    cy.get('[data-testid="investigation-panel"]').closest('.p-dialog').find('button.p-dialog-close-button').click();
    cy.get('[data-testid="app-file-menu-button"]').click(); cy.contains('button[mat-menu-item]', /^Save$/).click();
    cy.get('#stash-name').clear().type('report-with-images'); cy.get('#stash-data').click();
    const path = `${Cypress.config('downloadsFolder')}/report-with-images.zip`;
    writeCapturedDownloadToDisk('report-with-images.zip', path);
    cy.readFile(path, 'base64').then(async encoded => {
      const zip = await JSZip.loadAsync(encoded, { base64: true });
      const snapshot = JSON.parse(await zip.file('report-with-images.microbetrace')!.async('text'));
      const manifest = JSON.parse(await zip.file('investigation-manifest.json')!.async('text'));
      const html = await zip.file('investigation-record.html')!.async('text');
      recordHtml = html;
      const document = new DOMParser().parseFromString(html, 'text/html');
      expect(snapshot.investigation.figures).to.deep.equal(expected);
      expect(snapshot.investigation.figureEvidence).to.deep.equal(expectedEvidence);
      expect(document.querySelectorAll('#figures img')).to.have.length(4);
      expect(document.querySelector('#figure-evidence').textContent).to.include(originalRunId).and.not.include(replacementRunId);
      for (const [id, evidence] of Object.entries(expectedEvidence)) {
        const summary = manifest.investigation.figureEvidence[id];
        expect(summary).not.to.have.property('data');
        expect(JSON.parse(await zip.file(summary.path)!.async('text'))).to.deep.equal(evidence);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(await zip.file(summary.path)!.async('uint8array'))));
        expect(Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')).to.equal(id);
      }
      for (const [index, figure] of expected.entries()) {
        expect(document.querySelectorAll('#figures img')[index].getAttribute('src')).to.equal(figure.dataUrl);
        const summary = manifest.investigation.figures[index];
        expect(summary).not.to.have.property('dataUrl');
        expect(await zip.file(summary.path)!.async('base64')).to.equal(figure.dataUrl.split(',')[1]);
      }
    });
    cy.document().then(document => {
      const frame = document.createElement('iframe');
      frame.dataset.testid = 'standalone-evidence-report'; frame.style.width = '390px'; frame.style.height = '850px';
      frame.srcdoc = recordHtml; document.body.appendChild(frame);
    });
    cy.get('iframe[data-testid="standalone-evidence-report"]').should($frame => {
      expect(($frame[0] as HTMLIFrameElement).contentDocument?.querySelector('#figure-evidence')).to.exist;
    }).then($frame => {
      const document = ($frame[0] as HTMLIFrameElement).contentDocument!;
      document.querySelectorAll('details').forEach(details => details.open = true);
    });
    cy.get('iframe[data-testid="standalone-evidence-report"]').should($frame => {
      const frame = $frame[0] as HTMLIFrameElement;
      expect(frame.contentDocument!.documentElement.scrollWidth).to.be.at.most(frame.contentWindow!.innerWidth);
    }).then($frame => $frame.remove());
    cy.visit('/?skipEula=1&skipDemoSession=1');
    cy.get('#fileDropRef').selectFile(path, { force: true });
    cy.window({ timeout: 30000 }).should((win: any) => {
      expect(win.commonService.session.network.isFullyLoaded).to.equal(true);
      expect(win.commonService.session.investigation.figures).to.deep.equal(expected);
      expect(win.commonService.session.investigation.figureEvidence).to.deep.equal(expectedEvidence);
    });
  });
});
