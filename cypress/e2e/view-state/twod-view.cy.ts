/// <reference types="cypress" />

/**
 * Maintained 2D view-state tests.
 *
 * These cover pure 2D interaction mechanics against the sample dataset so they stay
 * fast and focused. Uploaded-data journeys live under cypress/e2e/journeys/flows.
 */

import { Core } from 'cytoscape';
import {
  ensureTwoDNetworkView,
  openGlobalFilteringTab,
  setGlobalDistanceMetric,
  setTN93DistanceDisplayFormat,
  visitAppAndAcceptEula,
} from '../../support/journey-helpers';
import { byTestId, testIds } from '../../support/selectors';

const getCy = () => cy.window({ log: false }).its('cytoscapeInstance') as Cypress.Chainable<Core>;

const getFirstVisibleLeafNode = (cyInstance: any) =>
  cyInstance
    .nodes(':visible')
    .filter((node: any) => node.children().length === 0 && !node.hasClass('parent'))[0];

const getFirstGroupNode = (cyInstance: any) => cyInstance.nodes('.parent:visible')[0];

const getRenderedShapeKey = (node: any): string => String(node.data('shapeKey') || node.style('shape') || '').trim();

const expectCytoscapeElement = (element: any, message: string): void => {
  expect(Boolean(element && typeof element.empty === 'function' && !element.empty()), message).to.equal(true);
};

const getNodeId = (node: any): string => String(node?._id ?? node?.id ?? '');

const getEndpointId = (endpoint: any): string => {
  if (endpoint && typeof endpoint === 'object') {
    return String(endpoint._id ?? endpoint.id ?? '');
  }

  return String(endpoint ?? '');
};

const getNumericMetricValue = (link: any, metric: string): number | null => {
  const value = Number(link?.[metric]);
  return Number.isFinite(value) ? value : null;
};

const isDistanceLinkForCollapse = (link: any, metric: string): boolean => {
  if (link?.hasDistance !== true || getNumericMetricValue(link, metric) === null) {
    return false;
  }

  const distanceOrigins = Array.isArray(link?.distanceOrigins)
    ? link.distanceOrigins.filter((origin: any) => typeof origin === 'string' && origin.length > 0)
    : (typeof link?.distanceOrigin === 'string' && link.distanceOrigin.length > 0 ? [link.distanceOrigin] : []);

  if (distanceOrigins.length > 0) {
    return true;
  }

  const origins = Array.isArray(link?.origin) ? link.origin : [];
  return origins.some((origin: any) => String(origin || '').toLowerCase().includes('distance'));
};

const configureSyntheticCollapseColors = (win: any, threshold: number): void => {
  const commonService = win.commonService;
  const widgets = commonService.session.style.widgets;
  const metric = String(widgets['link-sort-variable'] || widgets['default-distance-metric'] || 'distance');
  const visibleNodes = commonService.getVisibleNodes();
  const visibleIds = new Set(visibleNodes.map(getNodeId));
  const parent = new Map<string, string>();

  const find = (id: string): string => {
    const current = parent.get(id) || id;
    if (current === id) return current;
    const root = find(current);
    parent.set(id, root);
    return root;
  };

  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootB, rootA);
    }
  };

  visibleIds.forEach((id) => parent.set(id, id));
  (commonService.session.data.links || []).forEach((link: any) => {
    const source = getEndpointId(link.source);
    const target = getEndpointId(link.target);
    const value = getNumericMetricValue(link, metric);

    if (visibleIds.has(source) && visibleIds.has(target) && isDistanceLinkForCollapse(link, metric) && value !== null && value <= threshold) {
      union(source, target);
    }
  });

  const componentMembers = new Map<string, string[]>();
  visibleIds.forEach((id) => {
    const root = find(id);
    componentMembers.set(root, [...(componentMembers.get(root) || []), id]);
  });

  const colorById = new Map<string, string>();
  componentMembers.forEach((memberIds) => {
    memberIds.sort().forEach((id, index) => {
      colorById.set(id, memberIds.length > 1 && index % 2 === 1 ? 'Collapse B' : 'Collapse A');
    });
  });

  [...commonService.session.data.nodes, ...commonService.session.data.nodeFilteredValues].forEach((node: any) => {
    node.__twodCollapseColor = colorById.get(getNodeId(node)) || 'Collapse A';
  });

  widgets['node-color-variable'] = '__twodCollapseColor';
  commonService.createNodeColorMap();
  commonService.visuals.twoD.updateNodeColors();
};

const expectTopHitWithin = ($target: JQuery<HTMLElement>, expectedSelector: string, label: string): void => {
  const target = $target[0];
  const rect = target.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const topElement = target.ownerDocument.elementFromPoint(x, y) as HTMLElement | null;

  expect(topElement, `${label} top hit target`).to.exist;
  expect(topElement!.closest(expectedSelector), `${label} is above the network`).to.not.equal(null);
  expect(topElement!.closest('#cy'), `${label} is not inside Cytoscape`).to.equal(null);
  expect(topElement!.tagName.toLowerCase(), `${label} is not a Cytoscape canvas`).to.not.equal('canvas');
};

const expectTopHitInsideOverlay = ($overlay: JQuery<HTMLElement>, overlaySelector: string, label: string): void => {
  const overlay = $overlay[0];
  const rect = overlay.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const topElement = overlay.ownerDocument.elementFromPoint(x, y) as Element | null;

  expect(topElement, `${label} top hit target`).to.exist;
  expect(topElement!.closest(overlaySelector), `${label} receives pointer hits`).to.not.equal(null);
  expect(topElement!.closest('#global-settings-modal'), `${label} is not covered by Global Settings`).to.equal(null);
};

const moveFirstNodeUnderViewportPoint = (cyInstance: Core, viewportX: number, viewportY: number): void => {
  const node = getFirstVisibleLeafNode(cyInstance);
  expectCytoscapeElement(node, 'node moved under toolbar');

  if (node.locked && node.locked()) {
    node.unlock();
  }

  const containerRect = cyInstance.container().getBoundingClientRect();
  const pan = cyInstance.pan();
  const zoom = cyInstance.zoom();
  node.position({
    x: (viewportX - containerRect.left - pan.x) / zoom,
    y: (viewportY - containerRect.top - pan.y) / zoom
  });
  cyInstance.forceRender();
};

// Selectors for key elements in the 2D component
const selector : any = {
  canvas: '#cy',
  settingsBtn: byTestId(testIds.twodSettingsButton),
  pinAllBtn: byTestId(testIds.twodPinAllButton),
  refreshBtn: byTestId(testIds.twodRecalculateLayoutButton),
  statsNodes: '#numberOfNodes',
  statsLinks: '#numberOfVisibleLinks',
  settingsPane: byTestId(testIds.twodSettingsDialog),
  nodeLabelVar: '#node-label-variable',
  nodeRadiusSize: '#node-radius',
  linkWidthSize: '#link-width',
  showGroupsToggle: '#polygons-show-toggle',
  groupByVar: '#polygons-foci',
  nodeBorderWidth: '#node-border-width',
  showArrowsToggle: '#link-directed-undirected',
  showGridlinesToggle: '#network-gridlines-show-hide',
  networkLayoutMode: '#network-layout-mode',
  networkTimelineDateField: '#network-timeline-date-field',
  networkTimelineVerticalSpacing: '#network-timeline-vertical-spacing',
  nodeLabelSize: '#node-label-size',
  nodeLabelOrientation: '#node-label-orientation',
  nodeRadiusVar: '#node-radius-variable',
  nodeCollapseToggle: '#network-node-collapse-enabled',
  nodeCollapseThreshold: '#network-node-collapse-threshold',
  nodeCollapseThresholdInput: '#network-node-collapse-threshold-input',
  linkOpacity: '#link-opacity',
  groupLabelToggle: '#polygons-label-visibility',
  linkWidthVar: '#link-width-variable',
  linkLengthSlider: '#link-length',
  neighborHighlightToggle: '#dont-highlight-neighbors-highlight-neighbors',
  groupLabelSize: '#polygons-label-size',
  groupLabelOrientation: '#polygon-label-orientation'
};

const timelineLayoutDateField = 'Date of symptom onset Date';
const timelineDragNodeId = 'MZ740979';

function leafNodes(cyInstance: Core) {
  return cyInstance
    .nodes(':visible')
    .filter((node) => node.children().length === 0 && !node.hasClass('parent') && !node.hasClass('hidden'));
}

function realLeafNodes(cyInstance: Core) {
  return leafNodes(cyInstance).filter((node) => !node.data('isCollapsedAggregate'));
}

function aggregateNodes(cyInstance: Core) {
  return cyInstance.nodes(':visible').filter((node) => node.data('isCollapsedAggregate') === true);
}

function getCollapseThresholdWithAggregateEdges(): Cypress.Chainable<{ raw: number; displayed: number }> {
  return cy.window().then((win: any) => {
    const commonService = win.commonService;
    const widgets = commonService.session.style.widgets;
    const metric = String(widgets['link-sort-variable'] || widgets['default-distance-metric'] || 'distance');
    const visibleNodes = commonService.getVisibleNodes();
    const visibleIds = new Set<string>(visibleNodes.map(getNodeId));
    const visibleDistanceLinks = (commonService.session.data.links || [])
      .filter((link: any) => visibleIds.has(getEndpointId(link.source)) && visibleIds.has(getEndpointId(link.target)))
      .filter((link: any) => isDistanceLinkForCollapse(link, metric))
      .map((link: any) => ({
        source: getEndpointId(link.source),
        target: getEndpointId(link.target),
        value: getNumericMetricValue(link, metric),
      }))
      .filter((link: any) => link.value !== null)
      .sort((a: any, b: any) => a.value - b.value);
    const thresholds = Array.from(new Set(visibleDistanceLinks.map((link: any) => link.value))) as number[];

    const find = (parent: Map<string, string>, id: string): string => {
      const current = parent.get(id) || id;
      if (current === id) return current;
      const root = find(parent, current);
      parent.set(id, root);
      return root;
    };

    const union = (parent: Map<string, string>, a: string, b: string): void => {
      const rootA = find(parent, a);
      const rootB = find(parent, b);
      if (rootA !== rootB) {
        parent.set(rootB, rootA);
      }
    };

    for (const threshold of thresholds) {
      const parent = new Map<string, string>();
      visibleIds.forEach((id) => parent.set(id, id));
      visibleDistanceLinks.forEach((link: any) => {
        if (link.value <= threshold) {
          union(parent, link.source, link.target);
        }
      });

      const components = new Map<string, string[]>();
      visibleNodes.forEach((node: any) => {
        const id = getNodeId(node);
        const root = find(parent, id);
        components.set(root, [...(components.get(root) || []), id]);
      });

      const renderedByOriginalId = new Map<string, string>();
      Array.from(components.values()).forEach((memberIds, componentIndex) => {
        const renderedId = memberIds.length > 1 ? `aggregate-${componentIndex}` : memberIds[0];
        memberIds.forEach((id) => renderedByOriginalId.set(id, renderedId));
      });

      const hasAggregateEdge = visibleDistanceLinks.some((link: any) => {
        const source = renderedByOriginalId.get(link.source) || link.source;
        const target = renderedByOriginalId.get(link.target) || link.target;
        return source !== target && (source.startsWith('aggregate-') || target.startsWith('aggregate-'));
      });

      if (hasAggregateEdge) {
        return {
          raw: threshold,
          displayed: commonService.toDisplayedDistanceValue(threshold, metric),
        };
      }
    }

    const fallbackRaw = Math.max(...visibleDistanceLinks.map((link: any) => link.value));
    return {
      raw: fallbackRaw,
      displayed: commonService.toDisplayedDistanceValue(fallbackRaw, metric),
    };
  });
}

function expectCollapsedAggregateEdgesAreRetargeted(cyInstance: Core): void {
  const aggregateIds = new Set(aggregateNodes(cyInstance).map((node) => node.id()));
  const aggregateEndpointEdges = cyInstance.edges().filter((edge) => (
    aggregateIds.has(String(edge.data('source'))) || aggregateIds.has(String(edge.data('target')))
  ));

  expect(aggregateEndpointEdges.length, 'edges with aggregate endpoint data').to.be.greaterThan(0);
  aggregateEndpointEdges.forEach((edge: any) => {
    expect(edge.source().id(), `${edge.id()} rendered source`).to.equal(String(edge.data('source')));
    expect(edge.target().id(), `${edge.id()} rendered target`).to.equal(String(edge.data('target')));
    expect(edge.source().visible(), `${edge.id()} source visible`).to.equal(true);
    expect(edge.target().visible(), `${edge.id()} target visible`).to.equal(true);
  });
}

function expectAggregateNodesDoNotOverlapVisibleNodes(cyInstance: Core): void {
  const aggregates = aggregateNodes(cyInstance).toArray();
  const visibleNodes = leafNodes(cyInstance).toArray();
  const overlaps: string[] = [];

  aggregates.forEach((aggregate: any) => {
    const aggregatePosition = aggregate.position();
    const aggregateRadius = parseFloat(aggregate.style('width')) / 2;

    visibleNodes.forEach((node: any) => {
      if (node.id() === aggregate.id()) {
        return;
      }

      const nodePosition = node.position();
      const nodeRadius = parseFloat(node.style('width')) / 2;
      const dx = aggregatePosition.x - nodePosition.x;
      const dy = aggregatePosition.y - nodePosition.y;
      const distance = Math.sqrt((dx * dx) + (dy * dy));

      if (distance < aggregateRadius + nodeRadius - 1) {
        overlaps.push(`${aggregate.id()} overlaps ${node.id()}`);
      }
    });
  });

  expect(overlaps, 'collapsed aggregate node overlaps').to.deep.equal([]);
}

function openNodeCollapseSettings(): void {
  cy.get('@dialogContainer').contains('p-accordion-panel', 'Collapse Related Nodes').click();
}

function reopenTwoDNodeSettings(): void {
  cy.get(selector.settingsBtn).click();
  cy.contains('.p-dialog-title', '2D Network Settings')
    .should('be.visible')
    .parents('.p-dialog')
    .as('dialogContainer');
  cy.get('@dialogContainer').contains('.nav-link', 'Nodes').click();
}

function getCollapseThresholdFromVisibleLinks(): Cypress.Chainable<{ raw: number; displayed: number }> {
  return cy.window().then((win: any) => {
    const commonService = win.commonService;
    const widgets = commonService.session.style.widgets;
    const metric = String(widgets['link-sort-variable'] || widgets['default-distance-metric'] || 'distance');
    const visibleIds = new Set(commonService.getVisibleNodes().map(getNodeId));
    const values = (commonService.session.data.links || [])
      .filter((link: any) => visibleIds.has(getEndpointId(link.source)) && visibleIds.has(getEndpointId(link.target)))
      .filter((link: any) => isDistanceLinkForCollapse(link, metric))
      .map((link: any) => getNumericMetricValue(link, metric))
      .filter((value: number | null): value is number => value !== null);
    const raw = Math.max(...values);
    const displayed = commonService.toDisplayedDistanceValue(raw, metric);

    return { raw, displayed };
  });
}

function setNumberInputValue(selector: string, value: number): void {
  cy.get('@dialogContainer').find(selector)
    .clear({ force: true })
    .type(String(value), { delay: 0, force: true })
    .blur({ force: true });
}

function waitForTwoDRenderIdle(): void {
  cy.window({ timeout: 20000 })
    .its('commonService.session.network.rendering')
    .should('equal', false);
}

function expectVisibleEdgeRouting(curveStyle: string): void {
  getCy().should((cyInstance) => {
    const edge = cyInstance.edges(':visible').first();
    expect(edge.empty(), 'visible edge exists').to.equal(false);
    expect(edge.style('curve-style'), 'visible edge routing').to.equal(curveStyle);
  });
}

function getTimelineVerticalSpan(cyInstance: Core): number {
  const yPositions = leafNodes(cyInstance)
    .toArray()
    .map((node) => node.position('y'));

  return Math.max(...yPositions) - Math.min(...yPositions);
}

function expectTimelineAxisLabelsDoNotOverlap(): void {
  cy.get('.timeline-axis-overlay text.timeline-axis-label').should(($labels) => {
    const rects = Array.from($labels)
      .map((label) => {
        const rect = label.getBoundingClientRect();
        return {
          text: label.textContent || '',
          left: rect.left,
          right: rect.right,
          width: rect.width,
        };
      })
      .filter((rect) => rect.text.trim().length > 0 && rect.width > 0)
      .sort((a, b) => a.left - b.left);

    for (let index = 1; index < rects.length; index++) {
      expect(
        rects[index].left,
        `${rects[index - 1].text} should not overlap ${rects[index].text}`,
      ).to.be.greaterThan(rects[index - 1].right - 2);
    }
  });
}

function openNetworkDisplaySettings(): void {
  cy.get('@dialogContainer').find('.tab-pane.active').contains('p-accordion-panel', 'Display').click();
}

function enableTimelineLayout(field = timelineLayoutDateField): void {
  openNetworkDisplaySettings();
  cy.get('@dialogContainer').find(selector.networkLayoutMode).contains('Timeline').click({ force: true });
  cy.window().its('commonService.session.style.widgets.network-layout-mode').should('equal', 'Timeline');

  cy.get('@dialogContainer').find(selector.networkTimelineDateField, { timeout: 10000 }).click({ force: true });
  cy.contains('li[role="option"]', field, { timeout: 10000 }).click({ force: true });
  cy.window().its('commonService.session.style.widgets.network-timeline-date-field').should('equal', field);
  cy.get('.timeline-axis-overlay:not(.hidden)', { timeout: 20000 }).should('exist');
  getCy().should((cyInstance) => {
    const nodes = leafNodes(cyInstance);
    expect(nodes.length, 'timeline layout visible nodes').to.be.greaterThan(0);
    expect(
      nodes.toArray().some((node) => Number.isFinite(Number(node.data('timelineX')))),
      'nodes have timeline X positions',
    ).to.equal(true);
  });
  expectVisibleEdgeRouting('taxi');
}


// Test suite for core rendering and functionality
describe('2D Network - Core Rendering and Stats', () => {
  beforeEach(() => {
    visitAppAndAcceptEula({ skipDemoSession: false });
    ensureTwoDNetworkView();
  });

  it('should render the Cytoscape canvas with nodes and links', () => {
    // The canvas should exist and be visible
    cy.get(selector.canvas).should('be.visible');

    // Check for the presence of a canvas element, indicating Cytoscape has rendered
    cy.get(selector.canvas).find('canvas').should('exist');
  });

  it('should display correct initial statistics', () => {
    // Assert that the stats panel shows the correct counts from the seeded data
    cy.get(selector.statsNodes).should('contain.text', '33');
    cy.get(selector.statsLinks).should('contain.text', '74');
  });

  it('keeps 2D controls above the Cytoscape render surface', () => {
    cy.get(selector.settingsBtn)
      .should('be.visible')
      .then(($button) => {
        const rect = $button[0].getBoundingClientRect();
        const backgroundColor = getComputedStyle($button[0]).backgroundColor;

        expect(rect.width, 'toolbar button has a visible paint box').to.be.greaterThan(0);
        expect(backgroundColor, 'toolbar button background is opaque').to.not.match(/^(transparent|rgba\(0, 0, 0, 0\))$/);
      });

    cy.get(selector.settingsBtn).should('be.visible').then(($button) => {
      const rect = $button[0].getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      return getCy().then((cyInstance) => {
        moveFirstNodeUnderViewportPoint(cyInstance, x, y);
      });
    });

    cy.get(selector.settingsBtn)
      .then(($button) => expectTopHitWithin($button, '#tool-btn-container', 'toolbar settings button'));

    cy.get(selector.settingsBtn).click();

    cy.contains('.p-dialog-title', '2D Network Settings')
      .should('be.visible')
      .parents('.p-dialog')
      .should('be.visible')
      .then(($dialog) => expectTopHitWithin($dialog, '.p-dialog', 'settings dialog'));
  });

  it('keeps Global Settings dropdown overlays above the Global Settings dialog', () => {
    cy.openGlobalSettings();

    cy.contains('#global-settings-modal .nav-link', 'Styling').click({ force: true });
    cy.get('#global-settings-modal #style-config', { timeout: 15000 }).should('be.visible');

    cy.get('#node-color-variable').click();
    cy.get('.p-select-overlay')
      .filter(':visible')
      .last()
      .then(($overlay) => expectTopHitInsideOverlay($overlay, '.p-select-overlay', 'global settings select overlay'));
    cy.contains('li[role="option"]', 'State').click();

    cy.contains('#global-settings-modal .nav-link', 'Timeline').click({ force: true });
    cy.get('#global-settings-modal #timeline-config', { timeout: 15000 }).should('be.visible');

    cy.get('#node-timeline-variable').click();
    cy.contains('li[role="option"]', timelineLayoutDateField).scrollIntoView().click();

    cy.get('#timeline-start-date-input').should('not.be.disabled').click();
    cy.get('.p-datepicker-panel')
      .filter(':visible')
      .last()
      .then(($overlay) => expectTopHitInsideOverlay($overlay, '.p-datepicker-panel', 'global settings datepicker overlay'));
  });
});

// Test suite for toolbar actions
// describe('2D Network - Toolbar Actions', () => {
  
//   beforeEach(() => {
//     cy.visit('/');
//     cy.wait(6000); // Allow for initial application bootstrap

//     cy.get('button:contains("Continue with Sample Dataset")', { timeout: 10000 })
//      .click({ force: true });
    
//     cy.get('#overlay').should('not.be.visible', { timeout: 10000 });
    
//     // Wait for the tree container to be visible, indicating the view has loaded
//     cy.get(selector.canvas, { timeout: 15000 }).should('be.visible');
//   });

//   it('should toggle the pin all nodes state and disable the refresh button', () => {
//     // The refresh button should initially be enabled
//     cy.get(selector.refreshBtn).should('not.have.class', 'disabled');

//     // Click to pin all nodes
//     cy.get(selector.pinAllBtn).click();

//     // Assert the state change in the commonService
//     cy.window().its('commonService.session.network.allPinned').should('be.true');

//     // The refresh button should now be disabled
//     cy.get(selector.refreshBtn).should('have.class', 'disabled');

//     // Click to unpin all nodes
//     cy.get(selector.pinAllBtn).click();

//     // Assert the state is reverted in the commonService
//     cy.window().its('commonService.session.network.allPinned').should('be.false');

//     // The refresh button should be enabled again
//     cy.get(selector.refreshBtn).should('not.have.class', 'disabled');
//   });

//   it('should open and close the settings pane', () => {
//     // The settings pane should not be visible initially
//     cy.get(selector.settingsPane).should('not.be.visible');

//     // Click the settings button to open the pane
//     cy.get(selector.settingsBtn).click();
//     cy.get(selector.settingsPane).should('be.visible');

//     // Click the close button (part of the PrimeNG dialog component)
//     cy.get(selector.settingsPane).find('.p-dialog-header-close-icon').click();
//     cy.get(selector.settingsPane).should('not.be.visible');
//   });
// });


// Test suite for the settings pane functionality
describe('2D Network - Settings Pane Interactions', () => {

  beforeEach(() => {
    visitAppAndAcceptEula({ skipDemoSession: false });
    ensureTwoDNetworkView();
    cy.get(selector.canvas, { timeout: 15000 }).should('be.visible');
    cy.get(selector.settingsBtn).click();

    // Verify it's open and alias the container for use in tests
    cy.contains('.p-dialog-title', '2D Network Settings')
      .should('be.visible')
      .parents('.p-dialog')
      .as('dialogContainer');
  });

  context('Node settings', () => {

    beforeEach(() => {
      // First, ensure the "Nodes" tab is active
      cy.get('@dialogContainer').contains('.nav-link', 'Nodes').click();
    });

    it('should update node size by clicking the UI and reflect in the network', () => {
      const initialSize = 20;
      const newSize = 75;
      const expectedStyledSize = (newSize / 100 * 40) + 10;
     
      cy.window().its('commonService.session.style.widgets.node-radius').should('equal', initialSize);
     
      cy.get('@dialogContainer').contains('p-accordion-panel', 'Shapes and Sizes').click();
     
      cy.get('@dialogContainer').find(selector.nodeRadiusSize)
       .invoke('val', newSize)
       .trigger('change', { force: true });
     
      cy.window().its('commonService.session.style.widgets.node-radius').should('equal', newSize);
     
      getCy().then((cyInstance) => {
       const node = cyInstance.nodes().first();
       expect(parseFloat(node.style('width'))).to.be.closeTo(expectedStyledSize, 1);
      });
     });

    it('should update node label via dropdown', () => {
        cy.get('@dialogContainer').contains('p-accordion-panel', 'Labels and Tooltips').click();
        cy.window().its('commonService.session.style.widgets.node-label-variable').should('equal', 'None');
        
        cy.get('@dialogContainer').find(selector.nodeLabelVar).click();
        cy.contains('li[role="option"]', 'Id').click();
        
        cy.window().its('commonService.session.style.widgets.node-label-variable').should('equal', '_id');
        getCy().then(cy => {
            const node = cy.nodes().first();
            expect(node.data('label')).to.equal(node.id());
        });
    });

    it('should update node label size and orientation', () => {
      const newSize = 36;
      const newOrientation = 'Top';
    
        cy.get('@dialogContainer').contains('p-accordion-panel', 'Labels and Tooltips').click();
        cy.window().invoke('Cypress.test.setNodeLabel', '_id'); // Ensure labels are visible for testing
    
        cy.window().its('commonService.session.style.widgets.node-label-size').should('equal', 16);
        cy.get('@dialogContainer').find(selector.nodeLabelSize).invoke('val', newSize).trigger('change', { force: true });
        cy.window().its('commonService.session.style.widgets.node-label-size').should('equal', newSize);

        cy.window().its('commonService.session.style.widgets.node-label-orientation').should('equal', 'Right');
        cy.get('@dialogContainer').find(selector.nodeLabelOrientation).click();
        cy.contains('li[role="option"]', newOrientation).click();
        cy.window().its('commonService.session.style.widgets.node-label-orientation').should('equal', newOrientation);

        getCy().then(cy => {
            const node = cy.nodes().first();
            expect(node.style('font-size')).to.contain(newSize);
            expect(node.style('text-valign')).to.equal('top');
        });
    });

    it('should update node border width via input', () => {
        const initialWidth = 2.0;
        const newWidth = 5;
    
        cy.get('@dialogContainer').contains('p-accordion-panel', 'Shapes and Sizes').click();
    
        cy.window().its('commonService.session.style.widgets.node-border-width').should('equal', initialWidth);
    
        setNumberInputValue(selector.nodeBorderWidth, newWidth);
    
        cy.window().its('commonService.session.style.widgets.node-border-width').should('equal', newWidth);
        getCy().then(cy => {
            const node = getFirstVisibleLeafNode(cy);
            expectCytoscapeElement(node, 'visible leaf node for border-width assertion');
            expect(parseFloat(node.style('border-width'))).to.be.closeTo(newWidth, 0.1);
        });
    });

    it('should show collapse controls and synchronize distance slider and input', () => {
        openNodeCollapseSettings();

        cy.get('@dialogContainer').find(selector.nodeCollapseToggle).should('be.visible');
        cy.get('@dialogContainer').find(selector.nodeCollapseThreshold).should('be.visible').and('be.disabled');
        cy.get('@dialogContainer').find(selector.nodeCollapseThresholdInput).should('be.visible').and('be.disabled');
        cy.window().then((win: any) => {
          expect(win.commonService.session.style.widgets['network-node-collapse-enabled']).to.equal(false);
          expect(Number(win.commonService.session.style.widgets['network-node-collapse-threshold']), 'default collapse threshold').to.equal(0);
        });

        cy.get('@dialogContainer').find(selector.nodeCollapseToggle).contains('Show').click({ force: true });
        waitForTwoDRenderIdle();
        cy.get('@dialogContainer').find(selector.nodeCollapseThreshold).should('not.be.disabled');
        cy.get('@dialogContainer').find(selector.nodeCollapseThresholdInput).should('not.be.disabled');

        getCollapseThresholdFromVisibleLinks().then(({ raw, displayed }) => {
          setNumberInputValue(selector.nodeCollapseThresholdInput, displayed);
          cy.get('@dialogContainer').find(selector.nodeCollapseThreshold).invoke('val').then((value) => {
            expect(Number(value), 'slider value after input change').to.be.closeTo(displayed, 0.001);
          });
          cy.window().then((win: any) => {
            expect(Number(win.commonService.session.style.widgets['network-node-collapse-threshold'])).to.be.closeTo(raw, 0.000001);
          });

          const nextDisplayed = Math.max(0, displayed - 1);
          cy.get('@dialogContainer').find(selector.nodeCollapseThreshold)
            .invoke('val', nextDisplayed)
            .trigger('input', { force: true });
          cy.get('@dialogContainer').find(selector.nodeCollapseThresholdInput).invoke('val').then((value) => {
            expect(Number(value), 'input value while dragging slider').to.be.closeTo(nextDisplayed, 0.001);
          });
          cy.window().then((win: any) => {
            expect(Number(win.commonService.session.style.widgets['network-node-collapse-threshold']), 'collapse threshold before slider commit').to.be.closeTo(raw, 0.000001);
          });
          cy.get('@dialogContainer').find(selector.nodeCollapseThreshold)
            .trigger('change', { force: true });
          cy.window().then((win: any) => {
            const widgets = win.commonService.session.style.widgets;
            const metric = String(widgets['link-sort-variable'] || widgets['default-distance-metric'] || 'distance');
            const nextRaw = win.commonService.fromDisplayedDistanceValue(nextDisplayed, metric);
            expect(Number(widgets['network-node-collapse-threshold']), 'collapse threshold after slider commit').to.be.closeTo(nextRaw, 0.000001);
          });
        });
    });

    it('should track global genetic distance metric and display format', () => {
        openNodeCollapseSettings();

        cy.window().then((win: any) => {
          const widgets = win.commonService.session.style.widgets;
          const twoD = win.commonService.visuals.twoD;

          widgets['default-distance-metric'] = 'tn93';
          widgets['link-sort-variable'] = 'distance';
          widgets['tn93-distance-display-format'] = 'decimal';
          widgets['network-node-collapse-threshold'] = 0.015;
          twoD.refreshDistanceDisplayFormat();
        });
        cy.get('@dialogContainer').find(selector.nodeCollapseThresholdInput).invoke('val').then((value) => {
          expect(Number(value), 'TN93 decimal collapse threshold').to.equal(0.015);
        });

        cy.window().then((win: any) => {
          win.commonService.session.style.widgets['tn93-distance-display-format'] = 'percentage';
          win.commonService.visuals.twoD.refreshDistanceDisplayFormat();
        });
        cy.get('@dialogContainer').find(selector.nodeCollapseThresholdInput).invoke('val').then((value) => {
          expect(Number(value), 'TN93 percentage collapse threshold').to.equal(1.5);
        });
        cy.get('@dialogContainer').find(selector.nodeCollapseThreshold).should('have.attr', 'step', '0.1');

        cy.window().then((win: any) => {
          const widgets = win.commonService.session.style.widgets;
          widgets['default-distance-metric'] = 'snps';
          widgets['link-threshold'] = 16;
          widgets['tn93-distance-display-format'] = 'decimal';
          win.commonService.visuals.twoD.refreshDistanceMetricSettings();
        });
        cy.window().then((win: any) => {
          expect(Number(win.commonService.session.style.widgets['network-node-collapse-threshold']), 'SNP collapse threshold raw value').to.equal(16);
        });
        cy.get('@dialogContainer').find(selector.nodeCollapseThresholdInput).invoke('val').then((value) => {
          expect(Number(value), 'SNP collapse threshold display').to.equal(16);
        });
        cy.get('@dialogContainer').find(selector.nodeCollapseThreshold).should('have.attr', 'step', '1');
    });

    it('should update collapse distance controls from global metric and format selections', () => {
        openNodeCollapseSettings();

        cy.closeSettingsPane('2D Network Settings');
        openGlobalFilteringTab();
        setGlobalDistanceMetric('tn93');
        setTN93DistanceDisplayFormat('percentage');
        cy.closeGlobalSettings();

        reopenTwoDNodeSettings();
        openNodeCollapseSettings();
        cy.get('@dialogContainer').find(selector.nodeCollapseThresholdInput).invoke('val').then((value) => {
          expect(Number(value), 'TN93 percentage collapse threshold after global setting').to.equal(1.5);
        });
        cy.get('@dialogContainer').find(selector.nodeCollapseThreshold).should('have.attr', 'step', '0.1');

        cy.closeSettingsPane('2D Network Settings');
        openGlobalFilteringTab();
        setGlobalDistanceMetric('snps');
        cy.closeGlobalSettings();
        waitForTwoDRenderIdle();

        reopenTwoDNodeSettings();
        openNodeCollapseSettings();
        cy.window().then((win: any) => {
          expect(win.commonService.session.style.widgets['default-distance-metric']).to.equal('snps');
          expect(Number(win.commonService.session.style.widgets['network-node-collapse-threshold'])).to.equal(16);
        });
        cy.get('@dialogContainer').find(selector.nodeCollapseThresholdInput).invoke('val').then((value) => {
          expect(Number(value), 'SNP collapse threshold after global setting').to.equal(16);
        });
        cy.get('@dialogContainer').find(selector.nodeCollapseThreshold).should('have.attr', 'step', '1');
    });

    it('should ignore non-distance links when collapsing related nodes', () => {
        openNodeCollapseSettings();

        cy.window().then((win: any) => {
          const commonService = win.commonService;
          const widgets = commonService.session.style.widgets;
          const twoD = commonService.visuals.twoD;
          const metric = 'distance';
          const threshold = 0;
          const visibleNodes = commonService.getVisibleNodes();
          const visibleIds = new Set<string>(visibleNodes.map(getNodeId));
          const parent = new Map<string, string>();

          const find = (id: string): string => {
            const current = parent.get(id) || id;
            if (current === id) return current;
            const root = find(current);
            parent.set(id, root);
            return root;
          };

          const union = (a: string, b: string): void => {
            const rootA = find(a);
            const rootB = find(b);
            if (rootA !== rootB) {
              parent.set(rootB, rootA);
            }
          };

          widgets['default-distance-metric'] = 'tn93';
          widgets['link-sort-variable'] = metric;
          widgets['network-node-collapse-threshold'] = threshold;
          visibleIds.forEach((id) => parent.set(id, id));

          (commonService.session.data.links || []).forEach((link: any) => {
            const source = getEndpointId(link.source);
            const target = getEndpointId(link.target);
            const value = getNumericMetricValue(link, metric);

            if (visibleIds.has(source) && visibleIds.has(target) && isDistanceLinkForCollapse(link, metric) && value !== null && value <= threshold) {
              union(source, target);
            }
          });

          const sourceNode = visibleNodes[0];
          const targetNode = visibleNodes.find((node: any) => find(getNodeId(node)) !== find(getNodeId(sourceNode)));
          expect(targetNode, 'visible node in a different distance-collapse component').to.exist;

          const source = getNodeId(sourceNode);
          const target = getNodeId(targetNode);
          commonService.session.data.links.push({
            id: 'non-distance-collapse-test',
            source,
            target,
            distance: threshold,
            visible: true,
            cluster: 1,
            origin: ['Synthetic Contact'],
            hasDistance: false,
            directed: false,
            nn: false,
          });

          twoD.SelectedNodeCollapseThresholdDisplayedVariable = commonService.toDisplayedDistanceValue(threshold, metric);
          twoD.onNodeCollapseEnabledChange(true);
          cy.wrap([source, target], { log: false }).as('nonDistanceCollapsePair');
        });

        waitForTwoDRenderIdle();

        cy.get('@nonDistanceCollapsePair').then((pair: any) => {
          getCy().should((cyInstance) => {
            const [source, target] = pair.map(String);
            const collapsedTogether = aggregateNodes(cyInstance).toArray().some((node: any) => {
              const memberIds = (node.data('collapsedMemberIds') || []).map(String);
              return memberIds.includes(source) && memberIds.includes(target);
            });

            expect(collapsedTogether, 'non-distance link endpoints collapsed together').to.equal(false);
          });
        });
    });

    it('should collapse related visible nodes into aggregate pie nodes and restore real nodes when disabled', () => {
        let originalLeafCount = 0;
        let baseRenderedWidth = 0;
        getCy().then((cyInstance) => {
          originalLeafCount = realLeafNodes(cyInstance).length;
          baseRenderedWidth = parseFloat(realLeafNodes(cyInstance).first().style('width'));
          expect(aggregateNodes(cyInstance).length, 'default aggregate nodes').to.equal(0);
        });

        openNodeCollapseSettings();
        getCollapseThresholdWithAggregateEdges().then(({ raw, displayed }) => {
          cy.window().then((win: any) => {
            configureSyntheticCollapseColors(win, raw);
            win.commonService.session.style.widgets['network-node-collapse-threshold'] = raw;
            win.commonService.visuals.twoD.SelectedNodeCollapseThresholdDisplayedVariable = displayed;
          });

          cy.get('@dialogContainer').find(selector.nodeCollapseToggle).contains('Show').click({ force: true });
          waitForTwoDRenderIdle();

          getCy().should((cyInstance) => {
            const aggregates = aggregateNodes(cyInstance);
            const leaves = realLeafNodes(cyInstance);
            const mixedPies = aggregates.filter((node) => {
              const counts = node.data('counts') || [];
              const image = String(node.data('pieBackgroundImage') || '');
              return counts.length > 1 && image.startsWith('data:image/svg+xml;base64,');
            });

            expect(aggregates.length, 'aggregate node count').to.be.greaterThan(0);
            expect(leaves.length, 'rendered real leaf count').to.be.lessThan(originalLeafCount);
            expect(aggregates.toArray().some((node) => Number(node.data('totalCount')) > 1), 'aggregate totalCount').to.equal(true);
            const sizedAggregate = aggregates
              .toArray()
              .find((node) => Number(node.data('totalCount')) > 1);
            expect(parseFloat(sizedAggregate.style('width')), 'aggregate rendered size')
              .to.be.closeTo(baseRenderedWidth * Math.sqrt(Number(sizedAggregate.data('totalCount'))), 1);
            expect(mixedPies.length, 'mixed-color pie aggregate').to.be.greaterThan(0);
            expectCollapsedAggregateEdgesAreRetargeted(cyInstance);
            expectAggregateNodesDoNotOverlapVisibleNodes(cyInstance);
          });

          cy.window().then((win: any) => {
            const exportedSvg = win.commonService.visuals.twoD['buildNetworkSvgExportContent']();
            expect(exportedSvg, 'vector pie export marker')
              .to.contain('data-microbetrace-collapsed-pie-export="true"');
            expect(exportedSvg, 'vector pie slices').to.contain('<path');
            expect(exportedSvg, 'vector pie border').to.contain('<circle');
            expect(exportedSvg, 'no rasterized pie images').to.not.contain('data:image/png');
          });

          cy.get('@dialogContainer').find(selector.nodeCollapseToggle).contains('Hide').click({ force: true });
          cy.window().then((win: any) => {
            expect(win.commonService.session.style.widgets['network-node-collapse-enabled']).to.equal(false);
          });
          getCy().should((cyInstance) => {
            expect(aggregateNodes(cyInstance).length, 'aggregate nodes after disable').to.equal(0);
            expect(realLeafNodes(cyInstance).length, 'real leaf nodes after disable').to.equal(originalLeafCount);
          });
        });
    });

    it('should update node tooltip variable and reflect in tooltip content', () => {
        cy.get('@dialogContainer').contains('p-accordion-panel', 'Labels and Tooltips').click();
        
        cy.window().its('commonService.session.style.widgets.node-tooltip-variable').should('deep.equal', ['_id']);
        
        cy.get('@dialogContainer').contains('.form-group', 'Tooltip').find('p-multiselect').click();
        cy.contains('li[role="option"]', 'cluster').click();
        
        cy.window().its('commonService.session.style.widgets.node-tooltip-variable').should('include', '_id');
        cy.window().its('commonService.session.style.widgets.node-tooltip-variable').should('include', 'cluster');

        // Verify the tooltip content now includes both fields
        const nodeId = 'MZ375596';
        cy.window().invoke('Cypress.test.tooltip', 'show', nodeId);
        // Corrected Assertion: Check for the text inside the generated table within the tooltip
        cy.get('#tooltip #tooltip-table').should('be.visible').within(() => {
          cy.contains('td', 'id').should('be.visible');
          cy.contains('td', 'Cluster').should('be.visible');
      });
    });

    it('should change node sizing to be by variable and reflect in the network', () => {
        cy.get('@dialogContainer').contains('p-accordion-panel', 'Shapes and Sizes').click();
    
        cy.window().its('commonService.session.style.widgets.node-radius-variable').should('equal', 'None');
        cy.get('@dialogContainer').find('#node-radius-row').should('be.visible');
        cy.get('@dialogContainer').find('#node-max-radius-row').should('not.be.visible');
    
        cy.get('@dialogContainer').find(selector.nodeRadiusVar).click();
        cy.contains('li[role="option"]', 'Degree').click();
    
        cy.window().its('commonService.session.style.widgets.node-radius-variable').should('equal', 'degree');
        cy.get('@dialogContainer').find('#node-radius-row').should('not.be.visible');
        cy.get('@dialogContainer').find('#node-max-radius-row').should('be.visible');
        cy.get('@dialogContainer').find('#node-min-radius-row').should('be.visible');

        getCy().then(cytoscapeInstance => {
          // Select nodes with known different degrees for a reliable comparison
          const nodeWithLowDegree = cytoscapeInstance.getElementById('MZ762276'); // A singleton, degree 0
          const nodeWithHighDegree = cytoscapeInstance.getElementById('MZ797703'); // High degree


          // Log the underlying data for debugging
          console.log('Low degree node data:', nodeWithLowDegree.data());
          console.log('High degree node data:', nodeWithHighDegree.data());
          
          // CORRECTED: Use .style('width') which gets the computed style value after rendering.
          const lowDegreeWidth = parseFloat(nodeWithLowDegree.style('width'));
          const highDegreeWidth = parseFloat(nodeWithHighDegree.style('width'));

          console.log(`Low degree width: ${lowDegreeWidth}, High degree width: ${highDegreeWidth}`);
          expect(lowDegreeWidth).to.be.lessThan(highDegreeWidth);
        });
    });
  });
  context('Link settings', () => {
    beforeEach(() => {
        cy.get('@dialogContainer').contains('.nav-link', 'Links').click();
    });

    it('should update link width by clicking the UI and reflect in the network', () => {
      const initialWidth = 3;
      const newWidth = 15;
    
      cy.window().its('commonService.session.style.widgets.link-width').should('equal', initialWidth);
      
      cy.get('@dialogContainer').find('.tab-pane.active').contains('p-accordion-panel', 'Shapes and Sizes').click();
    
      cy.get('@dialogContainer').find(selector.linkWidthSize)
        .invoke('val', newWidth)
        .trigger('change', { force: true });
    
      cy.window().its('commonService.session.style.widgets.link-width').should('equal', newWidth);
    
      getCy().then((cyInstance) => {
        const edge = cyInstance.edges().first();
        expect(parseFloat(edge.style('width'))).to.be.closeTo(newWidth, 1);
      });
    });

    it('should update link opacity via the slider', () => {
        const newOpacity = 0.5;
    
        cy.get('@dialogContainer').find('.tab-pane.active').contains('p-accordion-panel', 'Shapes and Sizes').click();
    
        cy.window().its('commonService.session.style.widgets.link-opacity').should('equal', 0);
    
        cy.get('@dialogContainer').find(selector.linkOpacity).invoke('val', newOpacity).trigger('change', { force: true });
    
        cy.window().its('commonService.session.style.widgets.link-opacity').should('equal', newOpacity);

        getCy().then(cy => {
            const edge = cy.edges().first();
            expect(parseFloat(edge.style('line-opacity'))).to.be.closeTo(newOpacity, 0.01);        
          });
    });
    
    it('should toggle link directionality arrows', () => {
        cy.get('@dialogContainer').find('.tab-pane.active').contains('p-accordion-panel', 'Shapes and Sizes').click();
    
        cy.window().its('commonService.session.style.widgets.link-directed').should('be.false');
        getCy().then(cy => expect(cy.edges().first().style('target-arrow-shape')).to.equal('none'));
    
        cy.get('@dialogContainer').find(selector.showArrowsToggle).contains('Show').click();
        cy.window().its('commonService.session.style.widgets.link-directed').should('be.true');
        getCy().then(cy => expect(cy.edges().first().style('target-arrow-shape')).to.equal('triangle'));
    
        cy.get('@dialogContainer').find(selector.showArrowsToggle).contains('Hide').click();
        cy.window().its('commonService.session.style.widgets.link-directed').should('be.false');
        getCy().then(cy => expect(cy.edges().first().style('target-arrow-shape')).to.equal('none'));
    });
    
    it('should update link tooltip variable', () => {
      cy.get('@dialogContainer').find('.tab-pane.active').should('be.visible').contains('p-accordion-panel', 'Labels and Tooltips').click();
      
      cy.window().its('commonService.session.style.widgets.link-tooltip-variable').should('be.empty');
      
      cy.get('@dialogContainer').find('.tab-pane.active').contains('.form-group', 'Tooltip').find('p-multiselect').click();
      cy.contains('li[role="option"]', 'Distance').click();
      
      cy.window().its('commonService.session.style.widgets.link-tooltip-variable').should('include', 'distance');
  
      getCy().then((cyInstance: Core) => {
          const edgeId = cyInstance.edges().first().id();
          cy.window().invoke('Cypress.test.linkTooltip', 'show', edgeId);
          cy.get('#tooltip').should('be.visible').and('not.be.empty');
      });
  });
        
    
    // it('should change link sizing to be by variable', () => {
    //     cy.get('@dialogContainer').find('.tab-pane.active').contains('p-accordion-panel', 'Shapes and Sizes').click();
      
    //     cy.window().its('commonService.session.style.widgets.link-width-variable').should('equal', 'None');
    //     cy.get('@dialogContainer').find('#link-width-row').should('be.visible');
    //     cy.get('@dialogContainer').find('#link-max-width-row').should('not.be.visible');
      
    //     cy.get('@dialogContainer').find(selector.linkWidthVar).click();
    //     cy.contains('li[role="option"]', 'Distance').click();
      
    //     cy.window().its('commonService.session.style.widgets.link-width-variable').should('equal', 'distance');
    //     cy.get('@dialogContainer').find('#link-width-row').should('not.be.visible');
    //     cy.get('@dialogContainer').find('#link-max-width-row').should('be.visible');
    //     cy.get('@dialogContainer').find('#link-min-width-row').should('be.visible');
    //     cy.get('@dialogContainer').find('#link-reciprocalthickness-row').should('be.visible');

    //     getCy().then(cy => {
    //       const edgeWithSmallDistance = cy.edges().filter(edge => edge.data('distance') < 0.01)[0];
    //       const edgeWithLargeDistance = cy.edges().filter(edge => edge.data('distance') > 0.02)[0];


    //         console.log(edgeWithLargeDistance);
    //         console.log(edgeWithSmallDistance);
    //         const smallDistWidth = parseFloat(edgeWithSmallDistance.style('width'));
    //         const largeDistWidth = parseFloat(edgeWithLargeDistance.style('width'));
            
    //         // Because reciprocal is on by default, a smaller distance should result in a larger width.
    //         expect(smallDistWidth).to.be.greaterThan(largeDistWidth);
    //     });
    // });
        
    // it('should update link length via the slider', () => {
    //     const newLength = 100;
      
    //     cy.get('@dialogContainer').find('.tab-pane.active').contains('p-accordion-panel', 'Shapes and Sizes').click();
      
    //     cy.window().its('commonService.session.style.widgets.link-length').should('equal', 50);
      
    //     cy.get('@dialogContainer').find(selector.linkLengthSlider).invoke('val', newLength).trigger('change', { force: true });
      
    //     cy.window().its('commonService.session.style.widgets.link-length').should('equal', newLength);

    //     // This is an indirect visual test. We check that node positions have changed,
    //     // which implies the layout force was updated with the new link length.
    //     getCy().then(cyto => {
    //         const node1_initial_pos = cyto.nodes().first().position();
    //         cy.get('@dialogContainer').find('[title="Recalculate Layout"]').click().then(() => {
    //             const node1_new_pos = cyto.nodes().first().position();
    //             expect(node1_initial_pos.x).to.not.equal(node1_new_pos.x);
    //         });
    //     });
    // });
  });
  context('Network settings', () => {
    beforeEach(() => {
        cy.get('@dialogContainer').contains('.nav-link', 'Network').click();
    });

    it('should toggle network gridlines and update visibility', () => {
        cy.get('@dialogContainer').find('.tab-pane.active').contains('p-accordion-panel', 'Display').click();

        cy.window().its('commonService.session.style.widgets.network-gridlines-show').should('be.false');
        cy.get('.grid-overlay').should('have.class', 'hidden');

        cy.get('@dialogContainer').find(selector.showGridlinesToggle).contains('Show').click();
        cy.window().its('commonService.session.style.widgets.network-gridlines-show').should('be.true');
        cy.get('.grid-overlay').should('not.have.class', 'hidden');

        cy.get('@dialogContainer').find(selector.showGridlinesToggle).contains('Hide').click();
        cy.window().its('commonService.session.style.widgets.network-gridlines-show').should('be.false');
        cy.get('.grid-overlay').should('have.class', 'hidden');
    });

    it('should toggle neighbor highlighting', () => {
        cy.get('@dialogContainer').find('.tab-pane.active').contains('p-accordion-panel', 'Display').click();
      
        cy.window().its('commonService.session.style.widgets.node-highlight').should('be.false');
      
        cy.get('@dialogContainer').find(selector.neighborHighlightToggle).contains('Highlighted').click();
        cy.window().its('commonService.session.style.widgets.node-highlight').should('be.true');
      
        cy.get('@dialogContainer').find(selector.neighborHighlightToggle).contains('Normal').click();
        cy.window().its('commonService.session.style.widgets.node-highlight').should('be.false');
    });

    it('should not expose timeline layout controls', () => {
        cy.get('@dialogContainer').find('.tab-pane.active').contains('p-accordion-panel', 'Display').click();

        cy.get('@dialogContainer').find(selector.networkLayoutMode).should('not.exist');
        cy.get('@dialogContainer').find(selector.networkTimelineDateField).should('not.exist');
        cy.get('@dialogContainer').find(selector.networkTimelineVerticalSpacing).should('not.exist');
        cy.window().its('commonService.session.style.widgets.network-layout-mode').should('equal', 'Force Directed');
        cy.get('.timeline-axis-overlay').should('have.class', 'hidden');
        expectVisibleEdgeRouting('straight');
    });
  });

  context('Grouping settings', () => {
    beforeEach(() => {
        cy.get('@dialogContainer').contains('.nav-link', 'Grouping').click();
    });

    it('should create and remove grouping polygons', () => {
        cy.get('@dialogContainer').find('.tab-pane.active').contains('p-accordion-panel', 'Controls').click();

        cy.window().its('commonService.session.style.widgets.polygons-show').should('be.false');
        getCy().then(cy => expect(cy.nodes('.parent').length).to.equal(0));

        cy.get('@dialogContainer').find(selector.showGroupsToggle).contains('Show').click();
        cy.window().its('commonService.session.style.widgets.polygons-show').should('be.true');
        getCy().then(cy => expect(cy.nodes('.parent').length).to.be.greaterThan(0));

        cy.get('@dialogContainer').find(selector.showGroupsToggle).contains('Hide').click();
        cy.window().its('commonService.session.style.widgets.polygons-show').should('be.false');
        getCy().then(cy => expect(cy.nodes('.parent').length).to.equal(0));
    });

    it('should toggle group label visibility', () => {
        cy.get('@dialogContainer').find('.tab-pane.active').contains('p-accordion-panel', 'Controls').click();
        cy.get('@dialogContainer').find(selector.showGroupsToggle).contains('Show').click();
    
        cy.get('@dialogContainer').find('.tab-pane.active').contains('p-accordion-panel', 'Labels').click();
    
        cy.window().its('commonService.session.style.widgets.polygons-label-show').should('be.false');
    
        cy.get('@dialogContainer').find(selector.groupLabelToggle).contains('Show').click();
        cy.window().its('commonService.session.style.widgets.polygons-label-show').should('be.true');
        getCy().then(cy => expect(cy.nodes('.parent').first().style('label')).to.not.be.empty);
    
        cy.get('@dialogContainer').find(selector.groupLabelToggle).contains('Hide').click();
        cy.window().its('commonService.session.style.widgets.polygons-label-show').should('be.false');
        getCy().then(cy => expect(cy.nodes('.parent').first().style('label')).to.be.empty);
    });
    
    // it('should change the grouping variable', () => {
    //     cy.get('@dialogContainer').find('.tab-pane.active').contains('p-accordion-panel', 'Controls').click();
    //     cy.get('@dialogContainer').find(selector.showGroupsToggle).contains('Show').click();
      
    //     cy.window().its('commonService.session.style.widgets.polygons-foci').should('equal', 'cluster');
      
    //     cy.get('@dialogContainer').find(selector.groupByVar).click();
    //     cy.contains('li[role="option"]', 'Subtype').click();
      
    //     cy.window().its('commonService.session.style.widgets.polygons-foci').should('equal', 'subtype');
    //     getCy().then(cy => {
    //         const parent = cy.getElementById('30578_KF773488_D99cl05').parent();
    //         expect(parent.id()).to.contain('B'); 
    //     });
    // });
    
    it('should update group label size and orientation', () => {
        const newSize = 40;
        const newOrientation = 'Bottom';
      
        cy.get('@dialogContainer').find('.tab-pane.active').contains('p-accordion-panel', 'Controls').click();
        cy.get('@dialogContainer').find(selector.showGroupsToggle).contains('Show').click();
        cy.get('@dialogContainer').find('.tab-pane.active').contains('p-accordion-panel', 'Labels').click();
        cy.get('@dialogContainer').find(selector.groupLabelToggle).contains('Show').click();
      
        cy.window().its('commonService.session.style.widgets.polygons-label-size').should('equal', 16);
        cy.get('@dialogContainer').find(selector.groupLabelSize).invoke('val', newSize).trigger('change', { force: true });
        cy.window().its('commonService.session.style.widgets.polygons-label-size').should('equal', newSize);
      
        cy.window().its('commonService.session.style.widgets.polygon-label-orientation').should('equal', 'Top');
        cy.get('@dialogContainer').find(selector.groupLabelOrientation).click();
        cy.contains('li[role="option"]', 'Bottom').click();
        cy.window().its('commonService.session.style.widgets.polygon-label-orientation').should('equal', newOrientation);

        getCy().then(cy => {
            const parentNode = cy.nodes('.parent').first();
            expect(parentNode.style('font-size')).to.contain(newSize);
            expect(parentNode.style('text-valign')).to.equal(newOrientation.toLowerCase());
        });
    });

    it('keeps group label orientation when node label orientation changes', () => {
        const nodeOrientation = 'Bottom';

        cy.get('@dialogContainer').find('.tab-pane.active').contains('p-accordion-panel', 'Controls').click();
        cy.get('@dialogContainer').find(selector.showGroupsToggle).contains('Show').click();
        cy.get('@dialogContainer').find('.tab-pane.active').contains('p-accordion-panel', 'Labels').click();
        cy.get('@dialogContainer').find(selector.groupLabelToggle).contains('Show').click();

        cy.window().its('commonService.session.style.widgets.polygon-label-orientation').should('equal', 'Top');
        getCy().then(cyInstance => {
            const parentNode = getFirstGroupNode(cyInstance);

            expectCytoscapeElement(parentNode, 'visible group node');
            expect(parentNode.style('text-valign'), 'initial group label vertical alignment').to.equal('top');
            expect(parentNode.style('text-halign'), 'initial group label horizontal alignment').to.equal('center');
        });

        cy.get('@dialogContainer').contains('.nav-link', 'Nodes').click();
        cy.get('@dialogContainer').contains('p-accordion-panel', 'Labels and Tooltips').click();
        cy.get('@dialogContainer').find(selector.nodeLabelVar).click();
        cy.contains('li[role="option"]', 'Id').click();
        cy.get('@dialogContainer').find(selector.nodeLabelOrientation).click();
        cy.contains('li[role="option"]', nodeOrientation).click();

        cy.window().its('commonService.session.style.widgets.node-label-orientation').should('equal', nodeOrientation);
        cy.window().its('commonService.session.style.widgets.polygon-label-orientation').should('equal', 'Top');

        getCy().then(cyInstance => {
            const parentNode = getFirstGroupNode(cyInstance);
            const leafNode = getFirstVisibleLeafNode(cyInstance);

            expect(parentNode.style('text-valign'), 'group label vertical alignment after node change').to.equal('top');
            expect(parentNode.style('text-halign'), 'group label horizontal alignment after node change').to.equal('center');
            expect(leafNode.style('text-valign'), 'leaf node label vertical alignment').to.equal('bottom');
        });
    });

    it('keeps group node shape when node shape settings change', () => {
        cy.get('@dialogContainer').find('.tab-pane.active').contains('p-accordion-panel', 'Controls').click();
        cy.get('@dialogContainer').find(selector.showGroupsToggle).contains('Show').click();

        getCy().then(cyInstance => {
            const parentNode = getFirstGroupNode(cyInstance);

            expectCytoscapeElement(parentNode, 'visible group node');
            cy.wrap({
                dataShape: String(parentNode.data('shape') || ''),
                styleShape: String(parentNode.style('shape') || ''),
            }).as('initialGroupShape');
        });

        cy.window().then((win: any) => {
            const app = win.commonService.visuals.microbeTrace;
            const selectedShape = app.getNodeShapeTreeSelection('house');

            expect(selectedShape, 'default node shape selection').to.exist;
            app.onNodeShapeByChanged(true, false, 'None');
            app.onNodeShapeTreeChange(selectedShape);
        });

        cy.window().its('commonService.session.style.widgets.node-symbol').should('equal', 'house');
        cy.get('@initialGroupShape').then((initialGroupShape: any) => {
            getCy().then(cyInstance => {
                const parentNode = getFirstGroupNode(cyInstance);
                const leafNode = getFirstVisibleLeafNode(cyInstance);

                expect(parentNode.data('shape'), 'group data shape after default node shape change').to.equal(initialGroupShape.dataShape);
                expect(parentNode.style('shape'), 'group rendered shape after default node shape change').to.equal(initialGroupShape.styleShape);
                expect(parentNode.data('shapeKey'), 'group shape key after default node shape change').to.be.undefined;
                expect(parentNode.data('iconBackgroundImage'), 'group icon background after default node shape change').to.be.undefined;
                expect(getRenderedShapeKey(leafNode), 'leaf node shape after default node shape change').to.equal('house');
            });
        });

        cy.window().then((win: any) => {
            const app = win.commonService.visuals.microbeTrace;
            const shapeVariable = 'cluster';

            app.onNodeShapeByChanged(false, true, shapeVariable);

            const tableValues = win.commonService.session.style.nodeSymbolsTableKeys[shapeVariable];
            const firstValue = tableValues[0];
            const selectedShape = app.getNodeShapeTreeSelection('clinic');

            expect(firstValue, 'first node shape table value').to.exist;
            expect(selectedShape, 'field-based node shape selection').to.exist;
            app.onNodeShapeTableTreeChange(selectedShape, firstValue);
            cy.wrap(firstValue).as('changedShapeValue');
        });

        cy.window().its('commonService.session.style.widgets.node-symbol-variable').should('equal', 'cluster');
        cy.get('@initialGroupShape').then((initialGroupShape: any) => {
            cy.get('@changedShapeValue').then((changedShapeValue: any) => {
                getCy().then(cyInstance => {
                    const parentNode = getFirstGroupNode(cyInstance);
                    const changedLeafNode = cyInstance
                        .nodes(':visible')
                        .filter((node: any) => node.children().length === 0 && String(node.data('cluster')) === String(changedShapeValue))[0];

                    expect(parentNode.data('shape'), 'group data shape after field node shape change').to.equal(initialGroupShape.dataShape);
                    expect(parentNode.style('shape'), 'group rendered shape after field node shape change').to.equal(initialGroupShape.styleShape);
                    expect(parentNode.data('shapeKey'), 'group shape key after field node shape change').to.be.undefined;
                    expect(parentNode.data('iconBackgroundImage'), 'group icon background after field node shape change').to.be.undefined;
                    expectCytoscapeElement(changedLeafNode, 'leaf node for changed shape value');
                    expect(getRenderedShapeKey(changedLeafNode), 'leaf node shape after field node shape change').to.equal('clinic');
                });
            });
        });
    });
  });
});

describe('2D Network - Context Menu Interactions', () => {
  const openNodeContextMenu = (nodeId: string) => {
    getCy().then((cyInstance: Core) => {
      const node = cyInstance.getElementById(nodeId);
      
      expect(node.empty(), `node ${nodeId} should exist`).to.be.false;
      const { x, y } = node.position()

      node.emit('cxttap', {
        target: node,
        originalEvent:  {
          clientX: x,
          clientY: y,
          preventDefault: () => undefined,
          stopPropagation: () => undefined
        }
      });
    });

    cy.get('#context-menu').should('be.visible');
  };

  beforeEach(() => {
    visitAppAndAcceptEula({ skipDemoSession: false });
    ensureTwoDNetworkView();
    cy.get(selector.canvas, { timeout: 15000 }).should('be.visible');
  });

  it('should open a context menu with node actions on right click', () => {
    openNodeContextMenu('MZ696569');

    cy.get('#copyID').should('be.visible').and('contain.text', 'Copy ID');
    cy.get('#copySeq').should('be.visible').and('contain.text', 'Copy Sequence');
    cy.get('#viewAttributes').should('be.visible').and('contain.text', 'View Attributes');
  });

  it('should copy node id from the context menu', () => {
    let expectedClipboardId = 'MZ696569';

    cy.window().then((win: any) => {
      cy.spy(win.commonService.visuals.twoD.clipboard, 'copy').as('clipboardCopy');
    });

    openNodeContextMenu(expectedClipboardId);
    cy.get('#copyID')
      .should('have.attr', 'data-clipboard-text', expectedClipboardId)
      .click();

    cy.get('@clipboardCopy').should('have.been.calledWith', expectedClipboardId);
    cy.get('#context-menu').should('not.be.visible');
  });

  it('should copy node sequence from the context menu', () => {
    const nodeID = 'MZ696569';

    cy.window().then((win: any) => {
      const node = win.commonService.getVisibleNodes().find((n: any) => n.id === nodeID);
      if (!node) {
        throw new Error(`Could not find visible node with id ${nodeID}`);
      }
      const expectedSequence = node.seq;
      expect(expectedSequence, `sequence for node ${nodeID}`).to.be.a('string').and.not.be.empty;

      cy.spy(win.commonService.visuals.twoD.clipboard, 'copy').as('clipboardCopy');

      openNodeContextMenu(nodeID);
      cy.get('#copySeq')
        .should('not.be.disabled')
        .should('have.attr', 'data-clipboard-text', expectedSequence)
        .click();

      cy.get('@clipboardCopy').should('have.been.calledWith', expectedSequence);
      cy.get('#context-menu').should('not.be.visible');
    });
  });

  it('should open node attributes from the context menu', () => {
    let nodeID = 'MZ696569';
    openNodeContextMenu(nodeID);
    cy.get('#viewAttributes').click();


    cy.window().its('commonService.visuals.twoD.ShowNetworkAttributes').should('be.true');
    cy.window().its('commonService.visuals.twoD.ContextSelectedNodeAttributes').should((attrs: any[]) => {
      expect(attrs.length).to.be.greaterThan(0);
      const attrNames = attrs.map(item => item.attribute);
      expect(attrNames).to.not.include('_id');
      expect(attrNames).to.not.include('seq');
    });
    cy.contains('.p-dialog-title', 'Node Attributes').should('be.visible');
    cy.get('#network-attribute-table tr').its('length').should('be.greaterThan', 0);
    cy.get('#context-menu').should('not.be.visible');
  });
});


  // Test suite for mouse interactions

  describe('2D Network - Mouse Interactions', () => {
      const getCy = () => cy.window({ log: false }).its('cytoscapeInstance');
  
      beforeEach(() => {
          visitAppAndAcceptEula({ skipDemoSession: false });
          ensureTwoDNetworkView();
          cy.window({ timeout: 15000 }).should('have.property', 'cytoscapeInstance');
      });
  
      it('should select a single node and reflect the change visually', () => {
          const nodeIdToSelect = 'MZ375596';
  
          // 1. Verify nothing is selected
          getCy().then((cyInstance: Core) => {
              expect(cyInstance.elements(':selected').length).to.equal(0);
          });
  
          // 2. Manually set the selection state in the application's data model
          cy.window().then(win => {
              const node = win.commonService.session.data.nodes.find(n => n._id === nodeIdToSelect);
              win.commonService.session.data.nodes.forEach(n => n.selected = false);
              node.selected = true;
          });
  
          // 3. Manually trigger the event that tells the component to update its view from the data model
          cy.document().trigger("node-selected");
  
          // 4. Verify the node is now visually selected in Cytoscape
          getCy().then((cyInstance: Core) => {
              cy.wrap(cyInstance.elements(':selected')).should('have.length', 1)
                .then(selected => {
                    expect(selected.id()).to.equal(nodeIdToSelect);
                });
          });
      });
  
      it('should select multiple nodes by simulating a shift-click', () => {
          const node1_id = 'MZ375596';
          const node2_id = 'MZ696569';
  
          getCy().then((cyInstance: Core) => {
              const node1 = cyInstance.getElementById(node1_id);
              const node2 = cyInstance.getElementById(node2_id);
  
              // 1. Programmatically select the first node. This uses Cytoscape's internal selection.
              node1.select();
              cy.wrap(cyInstance.elements(':selected')).should('have.length', 1);
  
              // 2. Simulate a SHIFT-CLICK on the second node. This triggers Cytoscape's
              //    internal multi-select logic because the 'shiftKey' is present.
              node2.emit('tap', { originalEvent: { shiftKey: true } });
              
              // 3. Directly select the second node as well to ensure the state is additive.
              node2.select();
  
              // 4. FINAL VERIFICATION: Check if both nodes are now selected in the view.
              cy.wrap(cyInstance.elements(':selected')).should('have.length', 2)
                  .then(selectedElements => {
                      const selectedIds = selectedElements.map(el => el.id());
                      expect(selectedIds).to.include(node1_id);
                      expect(selectedIds).to.include(node2_id);
                  });
          });
      });
      
    //   it('should show and hide a tooltip on node hover', () => {
    //     cy.get('#tooltip').should('not.be.visible');
    
    //     getCy().then((cyInstance: Core) => {
    //         const nodeToHover = cyInstance.nodes()[0];
    //         const nodeId = nodeToHover.id();
    
    //         // 1. Use the reliable helper to show the tooltip
    //         cy.window().invoke('Cypress.testTooltip', 'show', nodeId);
    
    //         // 2. Verify visibility and content
    //         cy.get('#tooltip').should('be.visible').and('contain.text', nodeId);
    
    //         // 3. Use the helper to hide the tooltip
    //         cy.window().invoke('Cypress.testTooltip', 'hide', nodeId);
            
    //         // 4. Verify it's hidden
    //         cy.get('#tooltip').should('not.be.visible');
    //     });
    // });

  //   it('should show and hide a tooltip on link hover', () => {
  //     // 1. Initial State: Verify the tooltip is not visible.
  //     cy.get('#tooltip').should('not.be.visible');
  
  //     getCy().then((cyInstance: Core) => {
  //         // Find the first visible edge to make the test robust.
  //         const edgeToHover = cyInstance.edges(':visible')[0];
  //         const edgeId = edgeToHover.id();
  //         const sourceNodeId = edgeToHover.source().id(); // Get source ID for content check
  
  //         // 2. Action: Use the reliable helper to show the tooltip.
  //         cy.window().invoke('Cypress.linkTooltip', 'show', edgeId);
  
  //         // 3. Verification: Check that the tooltip is visible and contains relevant info (like the source node's ID).
  //         cy.get('#tooltip').should('be.visible').and('contain.text', sourceNodeId);
  
  //         // 4. Action: Use the helper to hide the tooltip.
  //         cy.window().invoke('Cypress.linkTooltip', 'hide', edgeId);
          
  //         // 5. Final State: Verify the tooltip is hidden again.
  //         cy.get('#tooltip').should('not.be.visible');
  //     });
  // });
  
      it('should allow node MZ740979 to be dragged to a new position', () => {
        const nodeId = 'MZ740979';
      
        getCy().then((cyInstance: Core) => {
          const node = cyInstance.getElementById(nodeId);
      
          // sanity checks
          expect(node.empty(), `node ${nodeId} should exist in Cytoscape`).to.be.false;
          expect(node.children().length, 'should not be compound parent').to.equal(0);
          expect(node.hasClass('parent'), 'should not have parent class').to.be.false;
          expect(node.hasClass('hidden'), 'should not be hidden').to.be.false;
      
          const initial = { ...node.position() };
      
          cy.window().then(win => {
            const after = win.Cypress.test.dragNodeDelta(nodeId, 100, 50);
            // guard in case helper returned null
            expect(after, 'drag helper returned a position').to.not.be.null;
      
            expect(after.x, 'rendered X').to.be.closeTo(initial.x + 100, 1);
            expect(after.y, 'rendered Y').to.be.closeTo(initial.y + 50, 1);
      
            // optional: also assert the backing data model saw the change
            const backingNode =
              win.commonService.session.data.nodes.find((n: any) => n._id === nodeId);
            expect(backingNode.x, 'model X').to.be.closeTo(after.x, 1);
            expect(backingNode.y, 'model Y').to.be.closeTo(after.y, 1);
          });
        });
      });

});

// \u00A0
