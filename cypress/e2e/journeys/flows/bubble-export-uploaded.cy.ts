/// <reference types="cypress" />

import { byTestId, testIds } from '../../../support/selectors';
import { getProfile } from '../datasets/profile';
import {
  assertAfterLaunchCounts,
  goToBubbleView,
  launchProfileToTwoD,
  openBubbleSettingsDialog,
  openGlobalStylingTab,
} from '../../../support/journey-helpers';

type ExpectedBubblePieSlice = {
  label: string;
  count: number;
  color: string;
};

type ExpectedBubblePieExport = {
  nodeId: string;
  totalCount: number;
  slices: ExpectedBubblePieSlice[];
};

type WinWithBubble = Window & {
  commonService: any;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const clickVisiblePrimeOption = (label: string): void => {
  cy.get('.p-select-overlay', { timeout: 15000 })
    .last()
    .find('p-selectitem')
    .contains('li', new RegExp(`^${escapeRegExp(label)}$`))
    .click({ force: true });
};

const selectPrimeOption = (selector: string, label: string): void => {
  cy.get(selector).click({ force: true });
  clickVisiblePrimeOption(label);
};

const setBubbleAxis = (
  selector: '#bubble-axis-x' | '#bubble-axis-y',
  label: string,
  expectedWidget: 'bubble-x' | 'bubble-y',
  expectedValue: string,
): void => {
  cy.get('@bubbleSettings').find(selector).find('.p-select-dropdown').click({ force: true });
  clickVisiblePrimeOption(label);
  cy.wait(100);
  cy.get('@bubbleSettings').find(selector).find('.p-select-label').should('contain', label);
  cy.window().its(`commonService.session.style.widgets.${expectedWidget}`).should('equal', expectedValue);
};

describe('Journey Flow - Bubble export on uploaded data', () => {
  const profile = getProfile('color-by-uploaded-categorical');

  it('exports collapsed uploaded Bubble pie charts as vector SVG paths', () => {
    const exportFileBase = `cypress_bubble_export_${Date.now()}`;
    const exportPath = `cypress/downloads/${exportFileBase}.svg`;
    let expectedPie: ExpectedBubblePieExport | undefined;

    launchProfileToTwoD(profile);
    assertAfterLaunchCounts(profile);
    goToBubbleView();

    openBubbleSettingsDialog();
    setBubbleAxis('#bubble-axis-x', 'State', 'bubble-x', 'State');
    setBubbleAxis('#bubble-axis-y', 'NodeClass', 'bubble-y', 'Node_Class');
    cy.closeSettingsPane('Bubble Settings');

    openGlobalStylingTab();
    selectPrimeOption('#node-color-variable', 'Profession');
    cy.window().its('commonService.session.style.widgets.node-color-variable').should('equal', 'Profession');
    cy.closeGlobalSettings();

    openBubbleSettingsDialog();
    cy.get('@bubbleSettings').find('#bubble-node-collapsing').contains('On').click({ force: true });
    cy.window().its('commonService.visuals.bubble.SelectedNodeCollapsingTypeVariable').should('equal', true);
    cy.closeSettingsPane('Bubble Settings');

    cy.window().then((win: unknown) => {
      const bubble = (win as WinWithBubble).commonService.visuals.bubble;
      const mixedNode = bubble.visibleData.find((node: any) =>
        node.totalCount === 6
        && Array.isArray(node.counts)
        && node.counts.some((count: any) => count.label === 'Healthcare' && count.count === 4)
        && node.counts.some((count: any) => count.label === 'Education' && count.count === 2),
      );

      expect(mixedNode, 'mixed uploaded Bubble aggregate').to.exist;
      expectedPie = {
        nodeId: String(mixedNode.id),
        totalCount: Number(mixedNode.totalCount),
        slices: mixedNode.counts.map((count: any) => ({
          label: String(count.label),
          count: Number(count.count),
          color: String((win as WinWithBubble).commonService.temp.style.nodeColorMap(count.label)),
        })),
      };
    });

    cy.get(byTestId(testIds.bubbleExportButton), { timeout: 15000 }).click({ force: true });
    cy.contains('.p-dialog-title', 'Export Bubble View')
      .should('be.visible')
      .parents('.p-dialog')
      .as('exportDialog');

    cy.get('@exportDialog')
      .find('#bubble-export-filename')
      .invoke('val', exportFileBase)
      .trigger('input')
      .trigger('change');

    cy.get('@exportDialog').find('#bubble-export-filetype').select('svg');
    cy.get('@exportDialog').find('#bubble-export-confirm').click({ force: true });
    cy.contains('.p-dialog-title', 'Export Bubble View').should('not.exist');

    cy.readFile(exportPath, 'utf8', { timeout: 20000 }).should((svgText) => {
      expect(expectedPie, 'expected pie metadata').to.exist;
      expect(svgText, 'exported Bubble SVG content').to.include('<svg');
      expect(svgText.length, 'exported Bubble SVG length').to.be.greaterThan(100);
      expect(svgText, 'Bubble pie export avoids raster PNG payloads').not.to.include('data:image/png;base64');

      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, 'image/svg+xml');
      const expected = expectedPie as ExpectedBubblePieExport;
      const pieGroups = Array.from(doc.querySelectorAll('g[data-mt-export="bubble-pie"]'));
      const pieGroup = pieGroups.find((group) => {
        if (group.getAttribute('data-mt-total-count') !== String(expected.totalCount)) {
          return false;
        }

        const candidateSlices = Array.from(group.querySelectorAll('path[data-mt-export="bubble-pie-slice"]'));
        return candidateSlices.length === expected.slices.length
          && expected.slices.every((expectedSlice) =>
            candidateSlices.some((candidate) =>
              candidate.getAttribute('data-mt-slice-label') === expectedSlice.label
              && candidate.getAttribute('data-mt-slice-count') === String(expectedSlice.count)
              && candidate.getAttribute('fill') === expectedSlice.color
              && /^M /.test(candidate.getAttribute('d') || '')
            )
          );
      });
      expect(pieGroup, 'exported Bubble pie vector group').to.exist;
      expect(pieGroup?.getAttribute('data-mt-total-count'), 'exported Bubble pie total count')
        .to.equal(String(expected.totalCount));

      const slices = Array.from(pieGroup?.querySelectorAll('path[data-mt-export="bubble-pie-slice"]') || []);
      expect(slices.length, 'exported Bubble pie slice count').to.equal(expected.slices.length);
      expected.slices.forEach((expectedSlice) => {
        const slice = slices.find((candidate) =>
          candidate.getAttribute('data-mt-slice-label') === expectedSlice.label
        );
        expect(slice, `exported Bubble pie slice for ${expectedSlice.label}`).to.exist;
        expect(slice?.getAttribute('data-mt-slice-count'), `exported Bubble pie count for ${expectedSlice.label}`)
          .to.equal(String(expectedSlice.count));
        expect(slice?.getAttribute('fill'), `exported Bubble pie color for ${expectedSlice.label}`)
          .to.equal(expectedSlice.color);
        expect(slice?.getAttribute('d'), `exported Bubble pie path for ${expectedSlice.label}`)
          .to.match(/^M /);
      });

      const outline = pieGroup?.querySelector('circle[data-mt-export="bubble-pie-outline"]');
      expect(outline, 'exported Bubble pie black outline').to.exist;
      expect(outline?.getAttribute('stroke'), 'exported Bubble pie outline color').to.equal('#000000');
      expect(Number(outline?.getAttribute('stroke-width')), 'exported Bubble pie outline width').to.be.greaterThan(0);
    });
  });

  it('exports the uploaded Bubble view as a PNG file after changing the advanced scale', () => {
    const exportFileBase = `cypress_bubble_export_png_${Date.now()}`;
    const exportPath = `cypress/downloads/${exportFileBase}.png`;
    const exportScale = '1.5';
    let initialDimensions = '';

    launchProfileToTwoD(profile);
    assertAfterLaunchCounts(profile);
    goToBubbleView();

    cy.get(byTestId(testIds.bubbleExportButton), { timeout: 15000 }).click({ force: true });
    cy.contains('.p-dialog-title', 'Export Bubble View')
      .should('be.visible')
      .parents('.p-dialog')
      .as('exportDialog');

    cy.get('@exportDialog')
      .find('#bubble-export-filename')
      .invoke('val', exportFileBase)
      .trigger('input')
      .trigger('change');

    cy.get('@exportDialog').find('#bubble-export-filetype').select('png');
    cy.get('@exportDialog').contains('p-accordion-header', 'Advanced').click({ force: true });
    cy.get('@exportDialog').find('#bubble-export-scale').should('be.visible');

    cy.get('@exportDialog')
      .find('#bubble-export-dimensions')
      .invoke('text')
      .then((text) => {
        initialDimensions = String(text).trim();
      });

    cy.get('@exportDialog')
      .find('#bubble-export-scale')
      .clear()
      .type(exportScale)
      .trigger('input')
      .trigger('change');

    cy.get('@exportDialog')
      .find('#bubble-export-dimensions')
      .invoke('text')
      .should((text) => {
        expect(String(text).trim(), 'updated Bubble export dimensions').not.to.equal(initialDimensions);
      });

    cy.get('@exportDialog').find('#bubble-export-confirm').click({ force: true });
    cy.contains('.p-dialog-title', 'Export Bubble View').should('not.exist');

    cy.readFile(exportPath, null, { timeout: 30000 }).should((pngBuffer) => {
      const byteLength = (pngBuffer as { byteLength?: number; length?: number } | null)?.byteLength
        ?? (pngBuffer as { length?: number } | null)?.length
        ?? 0;

      expect(pngBuffer, 'exported Bubble PNG buffer').not.to.equal(null);
      expect(byteLength, 'exported Bubble PNG byte length').to.be.greaterThan(1000);
    });
  });
});
