/// <reference types="cypress" />

import { Core } from 'cytoscape';
import {
  goToTransmissionChainView,
  visitAppAndAcceptEula,
} from '../../support/journey-helpers';
import { byTestId, testIds } from '../../support/selectors';

const dateField = 'Date of symptom onset Date';

const getTransmissionCy = () =>
  cy.window({ log: false })
    .its('commonService.visuals.transmissionChain.cy') as Cypress.Chainable<Core>;

const leafNodes = (cyInstance: Core) =>
  cyInstance
    .nodes(':visible')
    .filter((node) => node.children().length === 0 && !node.hasClass('parent') && !node.hasClass('hidden'));

const getDataNodeId = (node: any): string =>
  String(node?.id ?? node?.Id ?? node?.ID ?? node?.name ?? node?.Name ?? '');

const openSettings = (): void => {
  cy.get('body').then(($body) => {
    const isAlreadyOpen = $body.find('.p-dialog-title:contains("Transmission Chain View Settings"):visible').length > 0;
    if (!isAlreadyOpen) {
      cy.get(byTestId(testIds.transmissionChainSettingsButton), { timeout: 15000 }).click({ force: true });
    }

    cy.contains('.p-dialog-title', 'Transmission Chain View Settings', { timeout: 15000 })
      .should('be.visible')
      .parents('.p-dialog')
      .as('dialogContainer');
  });
};

const selectDateField = (): void => {
  cy.get('@dialogContainer').find('#transmission-chain-date-field', { timeout: 10000 }).click({ force: true });
  cy.contains('li[role="option"]', dateField, { timeout: 10000 }).click({ force: true });
  cy.window().its('commonService.session.style.widgets.transmission-chain-date-field').should('equal', dateField);
  cy.get('.timeline-axis-overlay:not(.hidden)', { timeout: 20000 }).should('exist');
};

const openDisplayPanel = (): void => {
  cy.get('@dialogContainer').then(($dialog) => {
    if ($dialog.find('#transmission-chain-line-style:visible').length === 0) {
      cy.wrap($dialog).contains('p-accordion-header', 'Display').click({ force: true });
    }
  });
  cy.get('@dialogContainer').find('#transmission-chain-line-style', { timeout: 10000 }).should('be.visible');
};

const selectLineStyle = (label: string, value: string): void => {
  openDisplayPanel();
  cy.get('@dialogContainer').find('#transmission-chain-line-style').click({ force: true });
  cy.contains('li[role="option"]', label, { timeout: 10000 }).click({ force: true });
  cy.window().its('commonService.session.style.widgets.transmission-chain-line-style').should('equal', value);
};

const getFirstVisibleOrigin = (): Cypress.Chainable<string> =>
  cy.window().then((win: any) => {
    const origins = (win.commonService.getVisibleLinks(true) || [])
      .flatMap((link: any) => Array.isArray(link.origin) ? link.origin : [link.origin])
      .map((origin: any) => String(origin || '').trim())
      .filter(Boolean);

    expect(origins.length, 'visible link origins').to.be.greaterThan(0);
    return origins[0];
  });

describe('Transmission Chain View', () => {
  beforeEach(() => {
    visitAppAndAcceptEula({ skipDemoSession: false });
    goToTransmissionChainView();
    openSettings();
  });

  it('opens as a dedicated view with transmission chain settings', () => {
    cy.get('.lm_tab.lm_active', { timeout: 20000 }).should('contain.text', 'Transmission Chain View');
    cy.get('@dialogContainer').contains('p-accordion-header', 'Layout').should('exist');
    cy.get('@dialogContainer').find('#transmission-chain-date-field').should('exist');
    cy.get('@dialogContainer').find('#transmission-chain-link-origins').should('exist');
    cy.get('@dialogContainer').find('#transmission-chain-link-origins input[type="checkbox"]').should('have.length.greaterThan', 0);
    cy.get('@dialogContainer').find('#transmission-chain-vertical-spacing').should('exist');
    openDisplayPanel();
    cy.get('@dialogContainer').find('#transmission-chain-line-style').should('contain.text', 'Stepped');
    cy.get('@dialogContainer').find('#transmission-chain-line-style').click({ force: true });
    cy.contains('li[role="option"]', 'Stepped').should('be.visible');
    cy.contains('li[role="option"]', 'Straight').should('be.visible');
    cy.contains('li[role="option"]', 'Curved').should('be.visible');
    cy.contains('li[role="option"]', 'Fan-out Curves').should('be.visible');
    cy.get('body').type('{esc}');
    cy.window().its('commonService.session.style.widgets.transmission-chain-line-style').should('equal', 'Stepped');
    cy.get('@dialogContainer').find('#network-layout-mode').should('not.exist');
    cy.get('@dialogContainer').find('#network-node-collapse-enabled').should('not.exist');
    getTransmissionCy().should((cyInstance) => {
      expect(cyInstance.nodes(':visible').length, 'blank startup nodes').to.equal(0);
      expect(cyInstance.edges(':visible').length, 'blank startup edges').to.equal(0);
    });
    cy.window().its('commonService.visuals.twoD').should('exist');
    cy.window().its('commonService.visuals.transmissionChain').should('exist');
  });

  it('arranges dated nodes from left to right and renders the timeline axis', () => {
    selectDateField();

    getTransmissionCy().then((cyInstance) => {
      const datedNodes = leafNodes(cyInstance)
        .toArray()
        .map((node) => ({
          id: node.id(),
          x: node.position('x'),
          time: Date.parse(String(node.data(dateField))),
        }))
        .filter((node) => Number.isFinite(node.time))
        .sort((a, b) => a.time - b.time);

      expect(datedNodes.length, 'dated nodes').to.be.greaterThan(1);
      expect(datedNodes[0].x, `${datedNodes[0].id} should be left of ${datedNodes[datedNodes.length - 1].id}`)
        .to.be.lessThan(datedNodes[datedNodes.length - 1].x);
      const visibleEdges = cyInstance.edges(':visible');
      expect(visibleEdges.length, 'visible chain links').to.be.greaterThan(0);
      expect(visibleEdges.first().style('curve-style'), 'edge routing').to.equal('taxi');
    });
  });

  it('renders the curved line style with manual curve offsets', () => {
    selectDateField();
    selectLineStyle('Curved', 'Curved');

    getTransmissionCy().should((cyInstance) => {
      const visibleEdges = cyInstance.edges(':visible');
      const firstEdge = visibleEdges.first() as any;

      expect(visibleEdges.length, 'visible chain links').to.be.greaterThan(0);
      expect(firstEdge.style('curve-style'), 'curved edge routing').to.equal('unbundled-bezier');
      expect(Math.abs(Number(firstEdge.data('transmissionChainCurveDistance'))), 'curved chain link distance')
        .to.be.greaterThan(0);
    });
  });

  it('fans out shared-endpoint chain links', () => {
    selectDateField();
    selectLineStyle('Fan-out Curves', 'Fanout');

    const syntheticOrigin = 'Synthetic Fanout Links';
    cy.window().then((win: any) => {
      const datedNodes = win.commonService.session.data.nodes
        .filter((node: any) => getDataNodeId(node) && Number.isFinite(Date.parse(String(node[dateField]))));

      expect(datedNodes.length, 'dated source and targets for fanout links').to.be.greaterThan(2);
      const [sourceNode, firstTargetNode, secondTargetNode] = datedNodes;
      const source = getDataNodeId(sourceNode);
      const firstTarget = getDataNodeId(firstTargetNode);
      const secondTarget = getDataNodeId(secondTargetNode);

      win.commonService.session.data.links.push(
        {
          id: 'transmission-chain-fanout-a',
          source,
          target: firstTarget,
          origin: [syntheticOrigin],
          visible: true,
          distance: 0,
        },
        {
          id: 'transmission-chain-fanout-b',
          source,
          target: secondTarget,
          origin: [syntheticOrigin],
          visible: true,
          distance: 0,
        },
      );
      win.commonService.visuals.transmissionChain.onTransmissionChainLinkOriginsChange([syntheticOrigin]);
    });

    getTransmissionCy().should((cyInstance) => {
      const fannedEdges = cyInstance.edges(':visible')
        .filter((edge) => String(edge.id()).startsWith('transmission-chain-fanout-'));
      const distances = fannedEdges.toArray()
        .map((edge) => Number(edge.data('transmissionChainCurveDistance')));

      expect(fannedEdges.length, 'synthetic fanout edges').to.equal(2);
      expect(distances.every((distance) => Math.abs(distance) > 0), 'nonzero fanout distances').to.equal(true);
      expect(new Set(distances).size, 'distinct fanout distances').to.be.greaterThan(1);
      fannedEdges.forEach((edge) => {
        expect(edge.style('curve-style'), `${edge.id()} routing`).to.equal('unbundled-bezier');
        expect(edge.data('transmissionChainFanoutGroupSize'), `${edge.id()} fanout group size`).to.equal(2);
      });
    });
  });

  it('uses selected link lists for rendered chain links', () => {
    selectDateField();

    getFirstVisibleOrigin().then((origin) => {
      let expectedLinks = 0;
      cy.window().then((win: any) => {
        expectedLinks = win.commonService.getVisibleLinks(true)
          .filter((link: any) => (Array.isArray(link.origin) ? link.origin : [link.origin])
            .some((linkOrigin: any) => String(linkOrigin || '').trim() === origin))
          .length;

        win.commonService.visuals.transmissionChain.onTransmissionChainLinkOriginsChange([origin]);
      });

      getTransmissionCy().should((cyInstance) => {
        expect(cyInstance.edges(':visible').length, `visible links for ${origin}`).to.equal(expectedLinks);
      });
    });
  });

  it('renders nodes with no edges when all link lists are cleared', () => {
    selectDateField();

    cy.window().then((win: any) => {
      win.commonService.visuals.transmissionChain.onTransmissionChainLinkOriginsChange([]);
    });

    getTransmissionCy().should((cyInstance) => {
      expect(leafNodes(cyInstance).length, 'nodes remain visible').to.be.greaterThan(0);
      expect(cyInstance.edges(':visible').length, 'visible links').to.equal(0);
    });
  });

  it('matches multi-origin links when any selected origin is enabled', () => {
    selectDateField();

    const syntheticOrigin = 'Synthetic Transmission Origin';
    cy.window().then((win: any) => {
      const link = win.commonService.session.data.links.find((candidate: any) => candidate.visible);
      expect(link, 'visible link for synthetic origin').to.exist;
      link.origin = Array.from(new Set([...(Array.isArray(link.origin) ? link.origin : [link.origin]), syntheticOrigin]));
      win.commonService.visuals.transmissionChain.onTransmissionChainLinkOriginsChange([syntheticOrigin]);
    });

    getTransmissionCy().should((cyInstance) => {
      expect(cyInstance.edges(':visible').length, 'synthetic-origin visible links').to.equal(1);
    });
  });
});

describe('Transmission Chain legacy migration', () => {
  it('migrates legacy 2D timeline sessions to Transmission Chain View', () => {
    visitAppAndAcceptEula({ skipDemoSession: false });

    cy.window().then((win: any) => {
      const legacySession = JSON.parse(JSON.stringify(win.commonService.session));
      legacySession.style.widgets['default-view'] = '2D Network';
      legacySession.style.widgets['network-layout-mode'] = 'Timeline';
      legacySession.style.widgets['network-timeline-date-field'] = dateField;
      legacySession.style.widgets['network-timeline-vertical-spacing'] = 180;
      legacySession.layout = {
        type: 'stack',
        content: [{ type: '2D Network' }],
      };

      win.commonService['migrateLegacyTimelineLayoutSession'](legacySession);

      expect(legacySession.style.widgets['default-view']).to.equal('Transmission Chain View');
      expect(legacySession.style.widgets['network-layout-mode']).to.equal('Force Directed');
      expect(legacySession.style.widgets['transmission-chain-date-field']).to.equal(dateField);
      expect(legacySession.style.widgets['transmission-chain-vertical-spacing']).to.equal(180);
      expect(legacySession.layout.content[0].type).to.equal('Transmission Chain View');
    });
  });
});
