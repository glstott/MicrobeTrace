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
    cy.readFile(path, 'base64').then({ timeout: 60000 }, async encoded => {
      const zip = await JSZip.loadAsync(encoded, { base64: true });
      const snapshot = JSON.parse(await zip.file('report-with-images.microbetrace')!.async('text'));
      const manifest = JSON.parse(await zip.file('investigation-manifest.json')!.async('text'));
      const html = await zip.file('investigation-record.html')!.async('text');
      recordHtml = html;
      const document = new DOMParser().parseFromString(html, 'text/html');
      const findings = document.querySelector('#findings [data-operation="network-statistics"]');
      expect(findings?.getAttribute('data-run-id'), 'numerical findings use the current saved run').to.equal(replacementRunId);
      expect(findings?.textContent, 'numerical findings show the saved scope').to.include('Scope when run: Full network');
      const nodeRow = Array.from(findings!.querySelectorAll('tbody tr')).find(row => row.querySelector('td')?.textContent === 'Nodes');
      expect(nodeRow?.querySelectorAll('td')[1].textContent, 'readable saved node count').to.equal(String(snapshot.investigation.calculations['network-statistics'].output.summary.nodeCount));
      const historicalFindings = document.querySelector('#figure-evidence [data-operation="network-statistics"]');
      expect(historicalFindings?.getAttribute('data-run-id'), 'figure findings use the original saved run').to.equal(originalRunId);
      expect(historicalFindings?.textContent, 'historical numerical findings identify status at image export').to.include('Status at image export:');
      expect(Cypress._.isEqual(snapshot.investigation.figures, expected), 'saved images match the exact original records').to.equal(true);
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
        expect(document.querySelectorAll('#figures img')[index].getAttribute('src') === figure.dataUrl, `embedded image bytes: ${figure.id}`).to.equal(true);
        const summary = manifest.investigation.figures[index];
        expect(summary).not.to.have.property('dataUrl');
        expect(await zip.file(summary.path)!.async('base64') === figure.dataUrl.split(',')[1], `bundle image bytes: ${figure.id}`).to.equal(true);
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
      expect(Cypress._.isEqual(win.commonService.session.investigation.figures, expected), 'reopened images match the exact original records').to.equal(true);
      expect(win.commonService.session.investigation.figureEvidence).to.deep.equal(expectedEvidence);
    });
  });

  it('saves reviewed titles and multiline captions, preserves image evidence, and reopens the retained image', () => {
    const title = 'Northern cluster < 3 SNPs';
    const caption = 'Three linked cases.\nLimitations: incomplete sampling <script>text only</script> & uncertain dates.';
    const filename = `reviewed-caption-${Date.now()}`;
    const path = `${Cypress.config('downloadsFolder')}/${filename}.zip`;
    let originals: any[], expected: any, evidence: any, calculations: any, removedId: string;
    cy.visit('/?skipEula=1&skipDemoSession=1');
    cy.get('#fileDropRef').selectFile('cypress/fixtures/investigation/02-configured.microbetrace', { force: true });
    cy.window({ timeout: 30000 }).should((win: any) => {
      expect(win.commonService.session.network.isFullyLoaded).to.equal(true);
      expect(win.commonService.session.tabLoaded).to.equal(true);
      expect(win.commonService.pendingDashboardRestore).not.to.exist;
      expect(win.commonService.visuals.microbeTrace.applyingPendingDashboardRestore).to.equal(false);
    });
    installSaveAsCaptureHook();
    for (let index = 0; index < 2; index++) {
      cy.get('#tool-btn-container a[title="Export Screen"]:visible').first().click();
      cy.contains('.p-dialog-title', 'Export Network Image').parents('.p-dialog').as('captionExport');
      cy.get('@captionExport').find('#network-export-filename').clear().type('same-image');
      cy.get('@captionExport').find('#network-export').click();
      cy.window({ timeout: 30000 }).should((win: any) => expect(win.commonService.session.investigation.figures).to.have.length(index + 1));
    }
    cy.window().then((win: any) => {
      const workspace = win.commonService.session.investigation;
      originals = JSON.parse(JSON.stringify(workspace.figures));
      evidence = JSON.parse(JSON.stringify(workspace.figureEvidence));
      calculations = JSON.parse(JSON.stringify(workspace.calculations));
      expect(originals[0].filename).to.equal(originals[1].filename);
      expect(originals[0].id).not.to.equal(originals[1].id);
      removedId = originals[1].id;
    });
    cy.get('[data-testid="app-file-menu-button"]').click();
    cy.get('[data-testid="app-file-menu-investigation"]').click();
    // The dialog moves focus after its entrance animation; finish that step before typing.
    cy.get('[data-testid="investigation-save"]').should('be.focused');
    cy.get('[data-testid="investigation-image-review"]').should('have.prop', 'open', false).children('summary').click();
    cy.get('[data-testid="investigation-image"] img').should('have.length', 2).each($image => {
      cy.wrap($image).scrollIntoView().should('be.visible').and($element => expect(($element[0] as HTMLImageElement).naturalWidth).to.be.greaterThan(0));
    });
    cy.get('[data-testid="investigation-image-title"]').first().type(title);
    cy.get('[data-testid="investigation-image-caption"]').first().type(caption, { parseSpecialCharSequences: false });
    cy.window().should((win: any) => {
      const figure = win.commonService.session.investigation.figures[0];
      expect(figure.title).to.equal(title);
      expect(figure.caption).to.equal(caption);
    });
    cy.get('[data-testid="investigation-image-down"]').first().click();
    cy.get('[data-testid="investigation-image-title"]').eq(1).should('have.value', title);
    cy.get('[data-testid="investigation-image-caption"]').eq(1).should('have.value', caption);
    cy.get('[data-testid="investigation-image-remove"]').first().click();
    cy.get('[data-testid="investigation-image"]').should('have.length', 1);
    cy.get('[data-testid="investigation-image-review"] > summary').should('contain', '(1)');
    cy.window().then((win: any) => {
      const workspace = win.commonService.session.investigation;
      expected = { ...originals[0], title, caption };
      expect(Cypress._.isEqual(workspace.figures, [expected]), 'review preserves the exact original image and edited text').to.equal(true);
      expect(workspace.figureEvidence).to.deep.equal(evidence);
      expect(workspace.calculations).to.deep.equal(calculations);
    });
    cy.viewport(390, 844);
    cy.get('[data-testid="investigation-image-caption"]').scrollIntoView().should('be.visible');
    cy.get('[data-testid="investigation-panel"]').closest('.p-dialog').find('.p-dialog-content').should($content => {
      expect($content[0].scrollWidth).to.be.at.most($content[0].clientWidth + 1);
    });
    cy.viewport(1280, 720);
    cy.get('[data-testid="investigation-save"]').click();
    cy.get('#stash-name').clear().type(filename);
    cy.get('#stash-data').click();
    writeCapturedDownloadToDisk(`${filename}.zip`, path);
    cy.readFile(path, 'base64').then({ timeout: 60000 }, async encoded => {
      const zip = await JSZip.loadAsync(encoded, { base64: true });
      const snapshot = JSON.parse(await zip.file(`${filename}.microbetrace`)!.async('text'));
      const manifest = JSON.parse(await zip.file('investigation-manifest.json')!.async('text'));
      const document = new DOMParser().parseFromString(await zip.file('investigation-record.html')!.async('text'), 'text/html');
      expect(Cypress._.isEqual(snapshot.investigation.figures, [expected]), 'saved reviewed image matches exactly').to.equal(true);
      expect(snapshot.investigation.figureEvidence).to.deep.equal(evidence);
      expect(manifest.investigation.figures[0]).to.include({ title, caption, id: expected.id, sha256: expected.sha256 });
      expect(document.querySelector('#figures h3')!.textContent).to.equal(title);
      expect(document.querySelector('.figure-caption')!.textContent).to.equal(caption);
      expect(document.querySelector('#figures script')).not.to.exist;
      expect(await zip.file(manifest.investigation.figures[0].path)!.async('base64') === expected.dataUrl.split(',')[1], 'reviewed image bytes match the original download').to.equal(true);
      expect(Object.keys(zip.files).filter(name => name.startsWith(`figures/${removedId}.`))).to.have.length(0);
    });
    cy.visit('/?skipEula=1&skipDemoSession=1');
    cy.get('#fileDropRef').selectFile(path, { force: true });
    cy.window({ timeout: 30000 }).should((win: any) => {
      const workspace = win.commonService.session.investigation;
      expect(win.commonService.session.network.isFullyLoaded).to.equal(true);
      expect(win.commonService.session.tabLoaded).to.equal(true);
      expect(Cypress._.isEqual(workspace.figures, [expected]), 'reopened reviewed image matches exactly').to.equal(true);
      expect(workspace.figureEvidence).to.deep.equal(evidence);
      expect(workspace.calculations).to.deep.equal(calculations);
    });
    cy.get('[data-testid="app-file-menu-button"]').click();
    cy.get('[data-testid="app-file-menu-investigation"]').click();
    cy.get('[data-testid="investigation-image-review"] > summary').click();
    cy.get('[data-testid="investigation-image-title"]').should('have.value', title);
    cy.get('[data-testid="investigation-image-caption"]').should('have.value', caption);
  });
});
