/// <reference types="cypress" />

import { getProfile } from '../datasets/profile';
import {
  assertAfterLaunchCounts,
  goToMapView,
  launchProfileToTwoD,
  openGlobalStylingTab,
  openMapSettingsDialog,
  selectMapField,
  setMapNodeCollapsing,
  setTimelineDate,
  setTimelineField,
} from '../../../support/journey-helpers';
import { readRenderedMapNodeStyle } from '../../../support/map-helpers';

type WinWithMap = Window & {
  commonService: any;
};

const normalizeColor = (value: string): string => String(value || '').replace(/\s+/g, '').toLowerCase();

const getNodeId = (data: any): string => String(data?._id ?? data?.ID ?? data?.id ?? '');

const assertRenderedNodeColor = (nodeId: string, expectedColor: string): void => {
  cy.window().should((win: unknown) => {
    const typedWindow = win as WinWithMap;
    const layer = typedWindow.commonService.visuals.gisMap.layers.featureGroup
      .getLayers()
      .find((candidate: any) => getNodeId(candidate?.data) === nodeId);

    expect(layer, `rendered Map node layer ${nodeId}`).to.exist;
    expect(readRenderedMapNodeStyle(layer).fillColor, `Map node color for ${nodeId}`).to.equal(expectedColor);
  });
};

const assertRenderedLinkColor = (linkId: string, expectedColor: string): void => {
  cy.window().should((win: unknown) => {
    const typedWindow = win as WinWithMap;
    const layer = typedWindow.commonService.visuals.gisMap.layers.links
      .getLayers()
      .find((candidate: any) => String(candidate?.data?.id || '') === linkId);

    expect(layer, `rendered Map link layer ${linkId}`).to.exist;
    expect(normalizeColor(layer.options.color), `Map link color for ${linkId}`).to.equal(expectedColor);
  });
};

const setColorVariable = (target: 'node' | 'link', variable: string): void => {
  cy.window().then((win: unknown) => {
    const typedWindow = win as WinWithMap;
    const microbeTrace = typedWindow.commonService.visuals.microbeTrace;

    if (target === 'node') {
      microbeTrace.SelectedColorNodesByVariable = variable;
      microbeTrace.onColorNodesByChanged();
    } else {
      microbeTrace.SelectedColorLinksByVariable = variable;
      microbeTrace.onColorLinksByChanged();
    }

    microbeTrace.cdref?.detectChanges?.();
  });

  cy.window()
    .its(`commonService.session.style.widgets.${target}-color-variable`)
    .should('equal', variable);
};

const getColorTableCountTotal = ($rows: JQuery<HTMLElement>): number =>
  $rows
    .toArray()
    .slice(1)
    .reduce((total, row) => {
      const countText = Cypress.$(row).find('td.tableCount').first().text().replace(/,/g, '').trim();
      const count = Number(countText);
      return total + (Number.isFinite(count) ? count : 0);
    }, 0);

const assertColorTableCountTotal = (tableSelector: string, expectedTotal: number): void => {
  cy.get(`${tableSelector} tr`, { timeout: 15000 }).should(($rows) => {
    expect($rows.length, `${tableSelector} has a header row`).to.be.greaterThan(0);
    expect(getColorTableCountTotal($rows), `${tableSelector} count total`).to.equal(expectedTotal);
  });
};

const assertColorTablesMatchVisibleTopology = (): void => {
  cy.window().then((win: unknown) => {
    const typedWindow = win as WinWithMap;
    const summary = typedWindow.commonService.getVisibleTopologySummary();

    assertColorTableCountTotal('#node-color-table', summary.nodeCount);
    assertColorTableCountTotal('#link-color-table', summary.linkCount);
  });
};

describe('Journey Flow - Map uploaded timeline color persistence', () => {
  const profile = getProfile('timeline-covid-node-link');
  const timeline = profile.expectations.timeline!;

  it('updates Map node and link color tables as timeline visibility changes', () => {
    const midCheckpoint = timeline.checkpoints.find((checkpoint) => checkpoint.id === 'timeline-mid') ?? timeline.checkpoints[0];
    const startCheckpoint = timeline.checkpoints.find((checkpoint) => checkpoint.id === 'timeline-start') ?? timeline.checkpoints[0];

    launchProfileToTwoD(profile);
    assertAfterLaunchCounts(profile);
    goToMapView();

    openMapSettingsDialog();
    selectMapField('map-field-zipcode', 'Zipcode', 'map-field-zipcode', 'Zip_code');
    setMapNodeCollapsing('Off');
    cy.closeSettingsPane('Geospatial Settings');

    setTimelineField(timeline.field);
    openGlobalStylingTab();
    setColorVariable('node', 'cluster');
    setColorVariable('link', 'cluster');

    setTimelineDate(midCheckpoint.date);
    assertColorTablesMatchVisibleTopology();

    setTimelineDate(startCheckpoint.date);
    assertColorTablesMatchVisibleTopology();

    cy.closeGlobalSettings();
  });

  it('keeps edited Map node and link colors after timeline mode is turned off', () => {
    const updatedNodeColor = '#777777';
    const updatedLinkColor = '#000000';
    const nodeColorVariable = 'Lineage';
    const expectedNodeColor = normalizeColor(updatedNodeColor);
    const expectedLinkColor = normalizeColor(updatedLinkColor);
    const midCheckpoint = timeline.checkpoints.find((checkpoint) => checkpoint.id === 'timeline-mid') ?? timeline.checkpoints[0];
    let targetNodeId = '';
    let targetLinkId = '';

    launchProfileToTwoD(profile);
    assertAfterLaunchCounts(profile);
    goToMapView();

    openMapSettingsDialog();
    selectMapField('map-field-zipcode', 'Zipcode', 'map-field-zipcode', 'Zip_code');
    setMapNodeCollapsing('Off');
    cy.closeSettingsPane('Geospatial Settings');

    setTimelineField(timeline.field);
    setTimelineDate(midCheckpoint.date);

    cy.window().should((win: unknown) => {
      const typedWindow = win as WinWithMap;
      expect(typedWindow.commonService.visuals.gisMap.layers.featureGroup.getLayers().length, 'rendered midpoint Map nodes')
        .to.be.greaterThan(0);
    });

    openGlobalStylingTab();
    setColorVariable('node', nodeColorVariable);
    cy.window().its('commonService.session.style.widgets.link-color-variable').should('equal', 'None');

    cy.get('#node-color-table tr', { timeout: 15000 })
      .eq(1)
      .find('input[type="color"]')
      .should('have.length', 1)
      .then(($input) => {
        const input = $input.get(0) as HTMLInputElement;
        input.value = updatedNodeColor;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    cy.get('#node-color-table tr')
      .eq(1)
      .find('input[type="color"]')
      .should('have.value', updatedNodeColor);

    cy.get('#link-color').should('be.visible').then(($input) => {
      const input = $input.get(0) as HTMLInputElement;
      input.value = updatedLinkColor;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    cy.get('#link-color').should('have.value', updatedLinkColor);

    cy.closeGlobalSettings();

    cy.window().should((win: unknown) => {
      const typedWindow = win as WinWithMap;
      const nodeLayer = typedWindow.commonService.visuals.gisMap.layers.featureGroup
        .getLayers()
        .find((candidate: any) => {
          const nodeId = getNodeId(candidate?.data);
          return Boolean(nodeId) && readRenderedMapNodeStyle(candidate).fillColor === expectedNodeColor;
        });

      expect(nodeLayer, 'rendered Map node recolored during timeline mode').to.exist;
    });

    cy.window().should((win: unknown) => {
      const typedWindow = win as WinWithMap;
      const linkLayer = typedWindow.commonService.visuals.gisMap.layers.links
        .getLayers()
        .find((candidate: any) => normalizeColor(candidate?.options?.color) === expectedLinkColor);

      expect(linkLayer, 'rendered Map link recolored during timeline mode').to.exist;
    });

    cy.window().then((win: unknown) => {
      const typedWindow = win as WinWithMap;
      const nodeLayer = typedWindow.commonService.visuals.gisMap.layers.featureGroup
        .getLayers()
        .find((candidate: any) => {
          const nodeId = getNodeId(candidate?.data);
          return Boolean(nodeId) && readRenderedMapNodeStyle(candidate).fillColor === expectedNodeColor;
        });

      expect(nodeLayer, 'recolored uploaded Map node to persist after teardown').to.exist;
      targetNodeId = getNodeId(nodeLayer.data);
      expect(targetNodeId, 'captured recolored uploaded Map node id').not.to.equal('');

      const linkLayer = typedWindow.commonService.visuals.gisMap.layers.links
        .getLayers()
        .find((candidate: any) => normalizeColor(candidate?.options?.color) === expectedLinkColor);

      expect(linkLayer, 'recolored uploaded Map link to persist after teardown').to.exist;
      targetLinkId = String(linkLayer?.data?.id || '');
      expect(targetLinkId, 'captured recolored uploaded Map link id').not.to.equal('');
    });

    setTimelineField('None');

    cy.window()
      .its('commonService.session.style.widgets')
      .should((widgets) => {
        expect(widgets['node-timeline-variable']).to.equal('None');
        expect(widgets['timeline-date-field']).to.equal('None');
      });

    cy.then(() => {
      expect(targetNodeId, 'captured recolored uploaded Map node id after teardown').not.to.equal('');
      assertRenderedNodeColor(targetNodeId, expectedNodeColor);
      expect(targetLinkId, 'captured recolored uploaded Map link id after teardown').not.to.equal('');
      assertRenderedLinkColor(targetLinkId, expectedLinkColor);
    });

    openGlobalStylingTab();
    cy.get('#node-color-table tr')
      .eq(1)
      .find('input[type="color"]')
      .should('have.value', updatedNodeColor);
    cy.get('#link-color').should('have.value', updatedLinkColor);
    cy.closeGlobalSettings();
  });
});
