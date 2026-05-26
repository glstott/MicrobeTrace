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
    cy.get('@dialogContainer').contains('p-accordion-panel', 'Layout').should('be.visible');
    cy.get('@dialogContainer').find('#transmission-chain-date-field').should('exist');
    cy.get('@dialogContainer').find('#transmission-chain-link-origins').should('exist');
    cy.get('@dialogContainer').find('#transmission-chain-vertical-spacing').should('exist');
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
      expect(cyInstance.edges(':visible').first().style('curve-style'), 'edge routing').to.equal('taxi');
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
