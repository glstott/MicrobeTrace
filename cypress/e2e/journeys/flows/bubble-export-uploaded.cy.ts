/// <reference types="cypress" />

import { byTestId, testIds } from '../../../support/selectors';
import { getProfile } from '../datasets/profile';
import {
  assertAfterLaunchCounts,
  goToBubbleView,
  launchProfileToTwoD,
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

const configureCollapsedProfessionBubble = (): void => {
  cy.window().then((win: unknown) => {
    const commonService = (win as WinWithBubble).commonService;
    const bubble = commonService.visuals.bubble;
    const widgets = commonService.session.style.widgets;

    widgets['bubble-x'] = 'State';
    widgets['bubble-y'] = 'Node_Class';
    widgets['node-color-variable'] = 'Profession';
    widgets['bubble-collapsed'] = true;

    commonService.createNodeColorMap();
    bubble.xVariable = 'State';
    bubble.yVariable = 'Node_Class';
    bubble.onDataChange('X');
    bubble.onDataChange('Y');
    bubble.SelectedNodeCollapsingTypeVariable = true;
    bubble.onNodeCollapsingChange();
  });

  cy.window().should((win: unknown) => {
    const bubble = (win as WinWithBubble).commonService.visuals.bubble;
    expect(bubble.xVariable, 'Bubble X axis').to.equal('State');
    expect(bubble.yVariable, 'Bubble Y axis').to.equal('Node_Class');
    expect(bubble.SelectedNodeCollapsingTypeVariable, 'Bubble collapsed state').to.equal(true);
  });
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

    configureCollapsedProfessionBubble();

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
        slices: mixedNode.counts
          .filter((count: any) => Number(count.count || 0) > 0)
          .map((count: any) => ({
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

      const expected = expectedPie as ExpectedBubblePieExport;
      const pieGroupPattern = new RegExp(
        `<g[^>]*data-mt-export="bubble-pie"[^>]*data-mt-total-count="${expected.totalCount}"[^>]*>[\\s\\S]*?</g>`,
      );
      const pieGroupMatch = svgText.match(pieGroupPattern);
      expect(pieGroupMatch, 'exported Bubble pie vector group').to.exist;
      const pieGroupText = pieGroupMatch?.[0] || '';

      const sliceMatches = pieGroupText.match(/data-mt-export="bubble-pie-slice"/g) || [];
      expect(sliceMatches.length, 'exported Bubble pie slice count').to.equal(expected.slices.length);
      expected.slices.forEach((expectedSlice) => {
        const slicePattern = new RegExp(
          `<path[^>]*data-mt-export="bubble-pie-slice"[^>]*`
          + `data-mt-slice-label="${escapeRegExp(expectedSlice.label)}"[^>]*`
          + `data-mt-slice-count="${expectedSlice.count}"[^>]*`
          + `fill="${escapeRegExp(expectedSlice.color)}"[^>]*`
          + 'd="M ',
        );
        expect(pieGroupText, `exported Bubble pie slice for ${expectedSlice.label}`).to.match(slicePattern);
      });

      const outlineMatch = pieGroupText.match(/<circle[^>]*data-mt-export="bubble-pie-outline"[^>]*stroke="#000000"[^>]*stroke-width="([^"]+)"/);
      expect(outlineMatch, 'exported Bubble pie black outline').to.exist;
      expect(Number(outlineMatch?.[1]), 'exported Bubble pie outline width').to.be.greaterThan(0);
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

    cy.readFile(exportPath, 'binary', { timeout: 30000 }).should((pngBinary) => {
      expect(pngBinary, 'exported Bubble PNG content').to.be.a('string');
      expect(pngBinary.length, 'exported Bubble PNG byte length').to.be.greaterThan(1000);
    });
  });
});
