/// <reference types="cypress" />

import { getProfile } from '../datasets/profile';
import {
  assertAfterLaunchCounts,
  launchProfileToTwoD,
} from '../../../support/journey-helpers';

const getNodeId = (node: any): string => String(node?._id ?? node?.id ?? '');

const getEndpointId = (endpoint: any): string => {
  if (endpoint && typeof endpoint === 'object') {
    return String(endpoint._id ?? endpoint.id ?? '');
  }

  return String(endpoint ?? '');
};

const getMetric = (win: any): string => {
  const widgets = win.commonService.session.style.widgets;
  return String(widgets['link-sort-variable'] || widgets['default-distance-metric'] || 'distance');
};

const getNumericMetricValue = (link: any, metric: string): number | null => {
  const value = Number(link?.[metric]);
  return Number.isFinite(value) ? value : null;
};

const waitForTwoDRenderIdle = (): void => {
  cy.window({ timeout: 30000 })
    .its('commonService.session.network.rendering')
    .should('equal', false);
};

const getVisibleDistanceValues = (win: any): number[] => {
  const metric = getMetric(win);
  const visibleIds = new Set(win.commonService.getVisibleNodes().map(getNodeId));
  const values = (win.commonService.session.data.links || [])
    .filter((link: any) => visibleIds.has(getEndpointId(link.source)) && visibleIds.has(getEndpointId(link.target)))
    .map((link: any) => getNumericMetricValue(link, metric))
    .filter((value: number | null): value is number => value !== null);

  return Array.from(new Set(values)).sort((a, b) => a - b);
};

const getCollapseMembershipKeysForThreshold = (win: any, threshold: number): string[] => {
  const metric = getMetric(win);
  const visibleNodes = win.commonService.getVisibleNodes();
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
  (win.commonService.session.data.links || []).forEach((link: any) => {
    const source = getEndpointId(link.source);
    const target = getEndpointId(link.target);
    const value = getNumericMetricValue(link, metric);

    if (visibleIds.has(source) && visibleIds.has(target) && value !== null && value <= threshold) {
      union(source, target);
    }
  });

  const components = new Map<string, string[]>();
  visibleIds.forEach((id) => {
    const root = find(id);
    components.set(root, [...(components.get(root) || []), id]);
  });

  return Array.from(components.values())
    .filter((memberIds) => memberIds.length > 1)
    .map((memberIds) => memberIds.sort().join('|'))
    .sort();
};

const pickCollapseThresholds = (win: any): { low: number; high: number } => {
  const globalThreshold = Number(win.commonService.session.style.widgets['link-threshold']);
  const values = getVisibleDistanceValues(win);
  const low = [...values].reverse().find((value) => value <= globalThreshold) ?? globalThreshold;
  const lowKeys = getCollapseMembershipKeysForThreshold(win, low);
  const high = values.find((value) => (
    value > globalThreshold &&
    JSON.stringify(getCollapseMembershipKeysForThreshold(win, value)) !== JSON.stringify(lowKeys)
  ));

  expect(high, 'collapse threshold above global link threshold changes membership').to.be.a('number');

  return {
    low,
    high: Number(high),
  };
};

const setCollapseThreshold = (threshold: number): void => {
  cy.window().then((win: any) => {
    const commonService = win.commonService;
    const twoD = commonService.visuals.twoD;
    const widgets = commonService.session.style.widgets;
    const metric = getMetric(win);
    const displayedThreshold = commonService.toDisplayedDistanceValue(threshold, metric);

    widgets['network-node-collapse-threshold'] = threshold;
    twoD.SelectedNodeCollapseThresholdDisplayedVariable = displayedThreshold;

    if (widgets['network-node-collapse-enabled'] !== true) {
      twoD.onNodeCollapseEnabledChange(true);
      return;
    }

    twoD.onNodeCollapseThresholdDisplayedChange(displayedThreshold);
  });
  waitForTwoDRenderIdle();
};

const getRenderedCollapseSnapshot = (win: any): {
  aggregateKeys: string[];
  aggregateCount: number;
  representedIds: string[];
} => {
  const cyInstance = win.cytoscapeInstance;
  const aggregateKeys: string[] = [];
  const representedIds = new Set<string>();

  cyInstance.nodes(':visible').forEach((node: any) => {
    if (node.hasClass('parent') || node.hasClass('hidden')) {
      return;
    }

    if (node.data('isCollapsedAggregate')) {
      const memberIds = (node.data('collapsedMemberIds') || []).map(String);
      memberIds.forEach((memberId: string) => representedIds.add(memberId));
      aggregateKeys.push(memberIds.sort().join('|'));
      return;
    }

    representedIds.add(String(node.id()));
  });

  return {
    aggregateKeys: aggregateKeys.sort(),
    aggregateCount: aggregateKeys.length,
    representedIds: Array.from(representedIds).sort(),
  };
};

describe('Journey Flow - 2D uploaded genetic-distance node collapse', () => {
  const profile = getProfile('map-covid-zipcode-threshold');

  it('keeps collapse threshold independent of global links and respects visible nodes', () => {
    launchProfileToTwoD(profile);
    assertAfterLaunchCounts(profile);

    cy.window().then((win: any) => {
      const widgets = win.commonService.session.style.widgets;
      widgets['network-node-collapse-enabled'] = false;
      widgets['network-node-collapse-threshold'] = Number(widgets['link-threshold']);
      win.commonService.visuals.twoD.onNodeCollapseEnabledChange(false);
    });
    waitForTwoDRenderIdle();

    cy.window().then((win: any) => {
      const widgets = win.commonService.session.style.widgets;
      const globalThreshold = Number(widgets['link-threshold']);
      const thresholds = pickCollapseThresholds(win);

      cy.wrap(globalThreshold, { log: false }).as('globalThreshold');
      cy.wrap(thresholds.low, { log: false }).as('lowCollapseThreshold');
      cy.wrap(thresholds.high, { log: false }).as('highCollapseThreshold');
    });

    cy.get('@lowCollapseThreshold').then((lowThreshold) => {
      setCollapseThreshold(Number(lowThreshold));
    });

    cy.window().then((win: any) => {
      cy.wrap(getRenderedCollapseSnapshot(win), { log: false }).as('lowCollapseSnapshot');
    });

    cy.get('@highCollapseThreshold').then((highThreshold) => {
      setCollapseThreshold(Number(highThreshold));
    });

    cy.get('@globalThreshold').then((globalThreshold) => {
      cy.window().then((win: any) => {
        expect(Number(win.commonService.session.style.widgets['link-threshold']), 'global link threshold').to.equal(Number(globalThreshold));
      });
    });
    cy.get('#numberOfVisibleLinks').should('contain.text', String(profile.expectations.afterLaunch.visibleLinks));

    cy.get('@lowCollapseSnapshot').then((lowSnapshot: any) => {
      cy.get('@highCollapseThreshold').then((highThreshold) => {
        cy.window().then((win: any) => {
          const highSnapshot = getRenderedCollapseSnapshot(win);
          expect(highSnapshot.aggregateCount, 'high-threshold aggregate count').to.be.greaterThan(0);
          expect(highSnapshot.aggregateKeys, 'collapse membership changes with collapse threshold')
            .to.not.deep.equal(lowSnapshot.aggregateKeys);

          const memberToHide = highSnapshot.aggregateKeys[0].split('|')[0];
          cy.wrap(memberToHide, { log: false }).as('hiddenCollapseMember');

          win.commonService.session.data.nodes.forEach((node: any) => {
            if (getNodeId(node) === memberToHide) {
              node.visible = false;
            }
          });
          win.commonService.session.data.nodeFilteredValues =
            win.commonService.session.data.nodeFilteredValues.filter((node: any) => getNodeId(node) !== memberToHide);
          win.commonService.session.data.links.forEach((link: any) => {
            if (getEndpointId(link.source) === memberToHide || getEndpointId(link.target) === memberToHide) {
              link.visible = false;
            }
          });
          expect(win.commonService.getVisibleNodes().map(getNodeId), 'hidden member removed from visible data')
            .to.not.include(memberToHide);

          const twoD = win.commonService.visuals.twoD;
          return twoD._rerender(false);
        });
      });
    });

    waitForTwoDRenderIdle();

    cy.get('@hiddenCollapseMember').then((hiddenMember) => {
      cy.window().then((win: any) => {
        const snapshot = getRenderedCollapseSnapshot(win);
        const visibleNodeCount = win.commonService.getVisibleNodes().length;

        expect(snapshot.representedIds, 'hidden node removed from rendered collapse membership')
          .to.not.include(String(hiddenMember));
        expect(snapshot.representedIds.length, 'rendered nodes represent currently visible nodes')
          .to.equal(visibleNodeCount);
      });
    });
  });
});
