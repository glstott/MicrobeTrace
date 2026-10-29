/// <reference types="cypress" />

import { visitAppAndAcceptEula } from '../../support/journey-helpers';

const openThreeD = (): void => {
  cy.get('[data-testid="app-view-menu-button"]').click();
  cy.get('[data-testid="app-view-menu-3d-network"]').click();
  cy.get('[data-testid="threed-webgl-canvas"]', { timeout: 30000 }).should('be.visible');
  cy.get('[data-testid="threed-canvas"]').should('have.attr', 'data-rendered', 'true');
};

const assertVisibleGraphMatchesSession = (): void => {
  cy.window().should((win: any) => {
    const service = win.commonService;
    const view = service.visuals.threeD;
    const ids = new Set(service.getVisibleNodes().map((node: any) => String(node._id ?? node.id)));
    const links = service.getVisibleLinksForCurrentTimeline().filter((link: any) => ids.has(String(link.source)) && ids.has(String(link.target)));
    expect(view.nodeCount, '3D nodes').to.equal(ids.size);
    expect(view.linkCount, '3D links').to.equal(links.length);
    expect(view.error, 'renderer error').to.equal('');
  });
};

describe('3D Network - shared network and view state', () => {
  beforeEach(() => {
    visitAppAndAcceptEula({ skipDemoSession: false, dismissWelcomeOverlay: true, extraQuery: { renderer: 'sigma' } });
    openThreeD();
  });

  it('renders the visible network and keeps 2D coordinates and canonical endpoints independent', () => {
    assertVisibleGraphMatchesSession();
    cy.window().then((win: any) => {
      const data = win.commonService.session.data;
      const coordinates = data.nodes.map((node: any) => [node._id, node.x, node.y]);
      const endpoints = data.links.map((link: any) => [link.source, link.target]);
      cy.get('[data-testid="threed-recalculate-button"]').click();
      cy.get('[data-testid="threed-freeze-button"]').click().should('have.attr', 'aria-pressed', 'true');
      cy.window().should((current: any) => {
        expect(current.commonService.session.data.nodes.map((node: any) => [node._id, node.x, node.y])).to.deep.equal(coordinates);
        expect(current.commonService.session.data.links.map((link: any) => [link.source, link.target])).to.deep.equal(endpoints);
      });
    });
  });

  it('synchronizes selection in both directions while the 2D pane is hidden', () => {
    cy.window().then((win: any) => {
      const service = win.commonService;
      const ids = service.getVisibleNodes().slice(0, 2).map((node: any) => String(node._id));
      service.visuals.threeD.selectNode(ids[0], { shiftKey: false, ctrlKey: false, metaKey: false });
      service.visuals.threeD.selectNode(ids[1], { shiftKey: true, ctrlKey: false, metaKey: false });
      expect(service.session.data.nodes.filter((node: any) => node.selected).map((node: any) => node._id)).to.have.members(ids);
      service.visuals.twoD.sigmaRenderer?.selectNodes([ids[1]]);
      if (!service.visuals.twoD.sigmaRenderer) {
        service.session.data.nodes.forEach((node: any) => node.selected = node._id === ids[1]);
        win.$(win.document).trigger('node-selected');
      }
      cy.wrap(ids[1]).as('selectedId');
    });
    cy.get('@selectedId').then(id => {
      cy.window().should((win: any) => {
        const view = win.commonService.visuals.threeD;
        expect(view.renderer.nodes.get(String(id)).color).to.equal(win.commonService.session.style.widgets['selected-color']);
      });
    });
    cy.get('[data-testid="threed-canvas"]').focus().type('{esc}');
    cy.window().should((win: any) => expect(win.commonService.session.data.nodes.every((node: any) => !node.selected)).to.equal(true));
  });

  it('follows subset and timeline filtering without retaining dangling links', () => {
    cy.window().then((win: any) => {
      const home = win.commonService.visuals.microbeTrace;
      home.SelectedNetworkSubsetNodeField = 'State';
      home.SelectedNetworkSubsetNodeOperator = 'equals';
      home.SelectedNetworkSubsetNodeValue = 'Texas';
      home.applyNetworkSubsetFilter();
    });
    cy.get('[data-testid="threed-counts"]').should('contain.text', '12 nodes');
    assertVisibleGraphMatchesSession();
    cy.window().then((win: any) => win.commonService.visuals.microbeTrace.clearNetworkSubsetFilter());
    cy.get('[data-testid="threed-counts"]').should('contain.text', '33 nodes');
    cy.window().then((win: any) => {
      const home = win.commonService.visuals.microbeTrace;
      home.onTimelineChanged('Date of symptom onset Date');
      home.onTimelineRangeEndInputChanged('2021-06-28');
    });
    assertVisibleGraphMatchesSession();
  });

  it('restores the camera, positions, and frozen state after closing and reopening', () => {
    cy.get('[data-testid="threed-freeze-button"]').click();
    cy.get('[data-testid="threed-canvas"]').focus().type('+');
    cy.window().then((win: any) => {
      const home = win.commonService.visuals.microbeTrace;
      const stash = JSON.parse(JSON.stringify(home.buildSessionStash()));
      expect(stash.session.meta.threeDViewState.layoutFrozen).to.equal(true);
      expect(stash.tabs.some((tab: any) => tab.label === '3D Network')).to.equal(true);
      cy.wrap(stash.session.meta.threeDViewState).as('savedThreeD');
      home._removeGlView('3D Network');
    });
    cy.get('[data-testid="threed-view"]').should('not.exist');
    openThreeD();
    cy.get('[data-testid="threed-freeze-button"]').should('have.attr', 'aria-pressed', 'true');
    cy.get('@savedThreeD').then((saved: any) => {
      cy.window().should((win: any) => {
        const state = win.commonService.visuals.threeD.renderer.getState();
        ['x', 'y', 'z'].forEach(axis => expect(state.camera.position[axis]).to.be.closeTo(saved.camera.position[axis], 0.001));
        expect(state.positions).to.deep.equal(saved.positions);
      });
    });
  });

  it('exports the current view as a PNG through the shared export pipeline', () => {
    cy.window().then((win: any) => {
      win.__mtTestSaveAs = cy.stub().as('saveImage');
    });
    cy.get('[data-testid="threed-export-button"]').click();
    cy.get('#threed-export-filename').clear().type('3d-regression');
    cy.get('[data-testid="threed-export-confirm"]').click();
    cy.get('@saveImage').should('have.been.calledOnce').then((stub: any) => {
      const [blob, filename] = stub.firstCall.args;
      expect(filename).to.equal('3d-regression.png');
      expect(blob.type).to.equal('image/png');
      expect(blob.size).to.be.greaterThan(1000);
    });
  });

  it('restores a Classic session whose only visualization is 3D Network', () => {
    cy.window().then((win: any) => {
      const service = win.commonService;
      const stash = JSON.parse(JSON.stringify(service.visuals.microbeTrace.buildSessionStash()));
      delete stash.dashboardLayout;
      delete stash.dashboardState;
      delete stash.session.meta.threeDViewState;
      stash.tabs = [{ label: 'Files', isActive: false }, { label: '3d_network', isActive: true }];
      stash.session.layout = { type: 'stack', content: [{ type: '3d_network' }] };
      stash.session.style.widgets['default-view'] = '3d_network';
      stash.session.style.widgets['3DNet-node-radius'] = 7.5;
      service.session = service.sessionSkeleton();
      return service.applySession(stash);
    });
    cy.get('[data-testid="threed-webgl-canvas"]', { timeout: 30000 }).should('be.visible');
    cy.window().should((win: any) => {
      expect(win.commonService.session.style.widgets['default-view']).to.equal('3D Network');
      expect(win.commonService.visuals.threeD.settings.nodeSize).to.equal(7.5);
      expect(win.commonService.visuals.microbeTrace.displayloadingInformationModal).to.equal(false);
    });
  });
});
