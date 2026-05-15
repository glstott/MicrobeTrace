/// <reference types="cypress" />

import moment from 'moment';
import { getProfile } from '../datasets/profile';
import {
  assertAfterLaunchCounts,
  assertMetricCount,
  assertNetworkMatchesOracleSnapshot,
  computeOracleForProfile,
  getOracleSnapshot,
  launchProfileToTwoD,
  moveTimelineRangeHandle,
  openGlobalStylingTab,
  setTimelineRange,
  setTimelineField,
} from '../../../support/journey-helpers';
import type { OracleStep } from '../../../oracle/types';

type WinWithCy = Window & {
  commonService: any;
  cytoscapeInstance?: any;
};

type RenderedTopologySummary = {
  nodes: number;
  visibleLinks: number;
  clusters: number;
  singletons: number;
};

const normalizeColor = (value: string): string => String(value || '').replace(/\s+/g, '').toLowerCase();

const hexToRgbString = (hex: string): string => {
  const normalized = hex.replace('#', '');
  const expanded = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;

  const red = parseInt(expanded.slice(0, 2), 16);
  const green = parseInt(expanded.slice(2, 4), 16);
  const blue = parseInt(expanded.slice(4, 6), 16);

  return `rgb(${red}, ${green}, ${blue})`;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeLogicalLinkId = (value: string): string => String(value || '').replace(/-\d+$/, '');

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

const changeColorTableEntry = (tableSelector: string, value: string, nextColor: string): void => {
  cy.get(`${tableSelector} td[data-value="${value}"]`, { timeout: 15000 })
    .closest('tr')
    .find('input[type="color"]')
    .should('have.length', 1)
    .then(($input) => {
      const input = $input.get(0) as HTMLInputElement;
      input.value = nextColor;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

  cy.get(`${tableSelector} td[data-value="${value}"]`)
    .closest('tr')
    .find('input[type="color"]')
    .should('have.value', nextColor);
};

const getRenderedVisibleNodeIds = (win: WinWithCy): string[] => {
  const cyInstance = win.cytoscapeInstance;
  expect(cyInstance, 'cytoscapeInstance').to.exist;

  return cyInstance
    .nodes(':visible')
    .filter((node: any) => node.children().length === 0)
    .map((node: any) => String(node.id()))
    .sort();
};

const getRenderedVisibleLinkIds = (win: WinWithCy): string[] => {
  const cyInstance = win.cytoscapeInstance;
  expect(cyInstance, 'cytoscapeInstance').to.exist;

  return Array.from(new Set(
    cyInstance
      .edges(':visible')
      .map((edge: any) => normalizeLogicalLinkId(String(edge.id()))),
  )).sort();
};

const getSessionVisibleNodeIds = (win: WinWithCy): string[] =>
  win.commonService.getVisibleNodes()
    .map((node: any) => String(node?._id ?? node?.id ?? ''))
    .filter(Boolean)
    .sort();

const assertTwoDTimelineNodeMembershipAligned = (): void => {
  cy.window().should((win: unknown) => {
    const typedWindow = win as WinWithCy;

    expect(
      getRenderedVisibleNodeIds(typedWindow),
      'rendered 2D node ids stay aligned with session-visible nodes',
    ).to.deep.equal(getSessionVisibleNodeIds(typedWindow));
  });
};

const assertRenderedLogicalLinkCountMatchesMetric = (): void => {
  cy.window().then((win: unknown) => {
    const renderedLinkCount = getRenderedVisibleLinkIds(win as WinWithCy).length;

    cy.get('#numberOfVisibleLinks').should(($metric) => {
      const metricValue = parseInt(String($metric.text()).replace(/,/g, ''), 10);
      expect(metricValue, 'rendered 2D logical link count matches the visible-link metric').to.equal(renderedLinkCount);
    });
  });
};

const getRenderedTopologySummary = (win: WinWithCy): RenderedTopologySummary => {
  const cyInstance = win.cytoscapeInstance;
  expect(cyInstance, 'cytoscapeInstance').to.exist;

  const nodeIds = getRenderedVisibleNodeIds(win);
  const nodeIdSet = new Set(nodeIds);
  const adjacency = new Map<string, Set<string>>();
  const uniqueLinks = new Map<string, { source: string; target: string }>();

  nodeIds.forEach((nodeId) => {
    adjacency.set(nodeId, new Set<string>());
  });

  cyInstance.edges(':visible').forEach((edge: any) => {
    const source = String(edge.source().id());
    const target = String(edge.target().id());

    if (source === target || !nodeIdSet.has(source) || !nodeIdSet.has(target)) {
      return;
    }

    const logicalId = normalizeLogicalLinkId(String(edge.id()));
    if (!uniqueLinks.has(logicalId)) {
      uniqueLinks.set(logicalId, { source, target });
    }
  });

  uniqueLinks.forEach(({ source, target }) => {
    adjacency.get(source)?.add(target);
    adjacency.get(target)?.add(source);
  });

  const visited = new Set<string>();
  let clusters = 0;
  let singletons = 0;

  nodeIds.forEach((nodeId) => {
    if (visited.has(nodeId)) {
      return;
    }

    const stack = [nodeId];
    let componentSize = 0;
    visited.add(nodeId);

    while (stack.length > 0) {
      const current = stack.pop() as string;
      componentSize += 1;

      adjacency.get(current)?.forEach((neighbor) => {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      });
    }

    if (componentSize === 1 && (adjacency.get(nodeId)?.size ?? 0) === 0) {
      singletons += 1;
    } else if (componentSize > 1) {
      clusters += 1;
    }
  });

  return {
    nodes: nodeIds.length,
    visibleLinks: uniqueLinks.size,
    clusters,
    singletons,
  };
};

const assertRenderedTopologyMetricsMatchStats = (): void => {
  cy.window()
    .then((win: unknown) => getRenderedTopologySummary(win as WinWithCy))
    .then((summary) => {
      assertMetricCount('#numberOfNodes', summary.nodes);
      assertMetricCount('#numberOfVisibleLinks', summary.visibleLinks);
      assertMetricCount('#numberOfDisjointComponents', summary.clusters);
      assertMetricCount('#numberOfSingletonNodes', summary.singletons);
    });
};

const assertTimelineRangeHandleHitAreas = (): void => {
  cy.get('#global-timeline svg .timeline-range-start-hit-area', { timeout: 15000 })
    .should('have.attr', 'r', '18')
    .and('have.attr', 'pointer-events', 'all');

  cy.get('#global-timeline svg .timeline-range-end-hit-area')
    .should('have.attr', 'r', '18')
    .and('have.attr', 'pointer-events', 'all');

  cy.get('#global-timeline svg .timeline-range-start-label')
    .should('have.attr', 'pointer-events', 'none');

  cy.get('#global-timeline svg text.label')
    .should('have.attr', 'pointer-events', 'none');
};

const clickTimelineSliderAtDate = (date: string): void => {
  cy.window().then((win: unknown) => {
    const typedWindow = win as WinWithCy;
    const microbeTrace = typedWindow.commonService.visuals.microbeTrace;
    const targetDate = moment(date).toDate();
    const targetX = Number(microbeTrace.xAttribute(targetDate));
    const expectedLabel = moment(date).format('MMM D');

    cy.get('#global-timeline svg line.track-overlay').first().click(targetX, 0, { force: true });
    cy.get('svg g.slider text.label').should('have.text', expectedLabel);
  });

  cy.window()
    .its('commonService.session.state.timeEnd')
    .should((value) => {
      expect(moment(value as string | number | Date).format('M/D/YYYY'), 'timeline slider date')
        .to.equal(moment(date).format('M/D/YYYY'));
    });
};

const assertRenderedNodeColor = (nodeId: string, expectedColor: string): void => {
  cy.window().should((win: unknown) => {
    const cyInstance = (win as WinWithCy).cytoscapeInstance;
    expect(cyInstance, 'cytoscapeInstance').to.exist;

    const node = cyInstance.getElementById(nodeId);
    expect(node.empty(), `rendered 2D node ${nodeId}`).to.equal(false);
    expect(normalizeColor(node.style('background-color')), `2D node color for ${nodeId}`).to.equal(expectedColor);
  });
};

const assertRenderedLinkColor = (linkId: string, expectedColor: string): void => {
  cy.window().should((win: unknown) => {
    const cyInstance = (win as WinWithCy).cytoscapeInstance;
    expect(cyInstance, 'cytoscapeInstance').to.exist;

    const edge = cyInstance
      .edges()
      .toArray()
      .find((candidate: any) => normalizeLogicalLinkId(String(candidate.id())) === normalizeLogicalLinkId(linkId));

    expect(Boolean(edge), `rendered 2D link ${linkId}`).to.equal(true);
    expect(normalizeColor(String(edge.style('line-color') || '')), `2D link color for ${linkId}`).to.equal(expectedColor);
  });
};

const assertNoRuntimeErrorBanner = (): void => {
  cy.get('body').should('not.contain.text', 'Unexpected application error');
};

const assertProcessingModalClosed = (): void => {
  cy.get('body').then(($body) => {
    if ($body.find('#loading-information-modal').length > 0) {
      cy.get('#loading-information-modal').should('not.be.visible');
    }
  });
};

const waitForTwoDRenderIdle = (timeout = 30000): void => {
  cy.window({ timeout })
    .its('commonService.session.network.rendering')
    .should('equal', false);
};

describe('Journey Flow - 2D uploaded timeline controls', () => {
  const profile = getProfile('timeline-covid-node-link');
  const timeline = profile.expectations.timeline!;
  const startCheckpoint = timeline.checkpoints.find((checkpoint) => checkpoint.id === 'timeline-start') ?? timeline.checkpoints[0];
  const midCheckpoint = timeline.checkpoints.find((checkpoint) => checkpoint.id === 'timeline-mid') ?? timeline.checkpoints[0];
  const maxCheckpoint = timeline.checkpoints.find((checkpoint) => checkpoint.id === 'timeline-max') ?? timeline.checkpoints[timeline.checkpoints.length - 1];

  it('keeps 2D timeline play/pause and manual slider checkpoints aligned on uploaded data', () => {
    let initialLabel = '';
    let initialTime = 0;
    let timelineStartTime = 0;
    let pausedTime = 0;

    const oracleSteps: OracleStep[] = [
      {
        id: 'timeline-enabled',
        kind: 'set-timeline-field',
        field: timeline.field,
      },
      {
        id: midCheckpoint.id,
        kind: 'set-timeline-date',
        date: midCheckpoint.date,
      },
      {
        id: startCheckpoint.id,
        kind: 'set-timeline-date',
        date: startCheckpoint.date,
      },
    ];

    computeOracleForProfile(profile, oracleSteps);

    launchProfileToTwoD(profile);
    assertAfterLaunchCounts(profile);

    setTimelineField(timeline.field);
    assertTimelineRangeHandleHitAreas();

    getOracleSnapshot('oracleResult', 'timeline-enabled').then((snapshot) => {
      assertNetworkMatchesOracleSnapshot(snapshot);
    });

    cy.get('svg g.slider text.label', { timeout: 15000 })
      .invoke('text')
      .then((text) => {
        initialLabel = String(text).trim();
      });

    cy.window().then((win: unknown) => {
      const state = (win as WinWithCy).commonService.session.state;
      timelineStartTime = new Date(state.timeStart as string | number | Date).getTime();
      initialTime = new Date(state.timeEnd as string | number | Date).getTime();
    });

    cy.get('#timeline-play-button').should('contain', 'Play').click();
    cy.get('#timeline-play-button', { timeout: 15000 }).should('contain', 'Pause');

    cy.window({ timeout: 15000 }).should((win: unknown) => {
      const nextValue = (win as WinWithCy).commonService.session.state.timeEnd;
      const nextTime = new Date(nextValue as string | number | Date).getTime();
      expect(Number.isFinite(nextTime), 'timeline playback date').to.equal(true);
      expect(nextTime, 'timeline playback advanced past the start date').to.be.greaterThan(timelineStartTime);
      expect(nextTime, 'timeline playback remains before the target date').to.be.lessThan(initialTime);
    });

    cy.get('#timeline-play-button').should('contain', 'Pause').click();
    cy.get('#timeline-play-button').should('contain', 'Play');

    cy.window().then((win: unknown) => {
      const value = (win as WinWithCy).commonService.session.state.timeEnd;
      pausedTime = new Date(value as string | number | Date).getTime();
      expect(pausedTime, 'captured paused timeline date').to.be.greaterThan(timelineStartTime);
    });

    cy.get('svg g.slider text.label')
      .invoke('text')
      .should((text) => {
        expect(String(text).trim(), 'timeline label after play/pause').not.to.equal(initialLabel);
      });

    cy.get('#timeline-play-button').should('contain', 'Play').click();
    cy.get('#timeline-play-button', { timeout: 15000 }).should('contain', 'Pause');

    cy.window().then((win: unknown) => {
      const resumedValue = (win as WinWithCy).commonService.session.state.timeEnd;
      const resumedTime = new Date(resumedValue as string | number | Date).getTime();
      expect(Number.isFinite(resumedTime), 'timeline resumed playback date').to.equal(true);
      expect(resumedTime, 'timeline resumes from paused date instead of restarting')
        .to.be.at.least(pausedTime);
    });

    cy.get('#timeline-play-button').should('contain', 'Pause').click();
    cy.get('#timeline-play-button').should('contain', 'Play');

    assertTwoDTimelineNodeMembershipAligned();
    assertRenderedLogicalLinkCountMatchesMetric();
    assertRenderedTopologyMetricsMatchStats();

    clickTimelineSliderAtDate(midCheckpoint.date);
    getOracleSnapshot('oracleResult', midCheckpoint.id).then((snapshot) => {
      assertNetworkMatchesOracleSnapshot(snapshot);
    });

    clickTimelineSliderAtDate(startCheckpoint.date);
    getOracleSnapshot('oracleResult', startCheckpoint.id).then((snapshot) => {
      assertNetworkMatchesOracleSnapshot(snapshot);
    });
  });

  it('links custom timeline range fields, draggable handles, playback bounds, and reset behavior', () => {
    const inputRangeStart = '7/7/2021';
    const inputRangeEnd = midCheckpoint.date;
    const draggedRangeStart = '7/11/2021';

    const oracleSteps: OracleStep[] = [
      {
        id: 'timeline-enabled',
        kind: 'set-timeline-field',
        field: timeline.field,
      },
      {
        id: 'range-from-inputs',
        kind: 'set-timeline-range',
        start: inputRangeStart,
        end: inputRangeEnd,
      },
      {
        id: 'range-from-handle',
        kind: 'set-timeline-range',
        start: draggedRangeStart,
        end: inputRangeEnd,
      },
      {
        id: 'range-reset',
        kind: 'set-timeline-range',
        start: startCheckpoint.date,
        end: maxCheckpoint.date,
      },
    ];

    computeOracleForProfile(profile, oracleSteps);

    launchProfileToTwoD(profile);
    assertAfterLaunchCounts(profile);
    setTimelineField(timeline.field);

    cy.openGlobalSettings();
    cy.contains('#global-settings-modal .nav-link', 'Timeline').click({ force: true });
    setTimelineRange(inputRangeStart, inputRangeEnd);
    cy.closeGlobalSettings();

    getOracleSnapshot('oracleResult', 'range-from-inputs').then((snapshot) => {
      assertNetworkMatchesOracleSnapshot(snapshot);
    });

    moveTimelineRangeHandle('start', draggedRangeStart);
    getOracleSnapshot('oracleResult', 'range-from-handle').then((snapshot) => {
      assertNetworkMatchesOracleSnapshot(snapshot);
    });

    cy.get('#timeline-play-button').should('contain', 'Play').click();
    cy.get('#timeline-play-button', { timeout: 15000 }).should('contain', 'Pause');

    cy.window({ timeout: 15000 }).should((win: unknown) => {
      const value = (win as WinWithCy).commonService.session.state.timeEnd;
      const currentTime = new Date(value as string | number | Date).getTime();
      expect(currentTime, 'bounded playback starts inside selected range')
        .to.be.at.least(new Date(draggedRangeStart).getTime())
        .and.at.most(new Date(inputRangeEnd).getTime());
    });

    cy.wait(500);
    cy.window({ timeout: 15000 }).should((win: unknown) => {
      const value = (win as WinWithCy).commonService.session.state.timeEnd;
      const currentTime = new Date(value as string | number | Date).getTime();
      expect(currentTime, 'bounded playback remains inside selected range')
        .to.be.at.least(new Date(draggedRangeStart).getTime())
        .and.at.most(new Date(inputRangeEnd).getTime());
    });

    cy.get('#timeline-play-button').should('contain', 'Pause').click();
    cy.get('#timeline-play-button').should('contain', 'Play');

    cy.openGlobalSettings();
    cy.contains('#global-settings-modal .nav-link', 'Timeline').click({ force: true });
    cy.get('#timeline-reset-range-button').click({ force: true });
    cy.closeGlobalSettings();

    getOracleSnapshot('oracleResult', 'range-reset').then((snapshot) => {
      assertNetworkMatchesOracleSnapshot(snapshot);
    });
  });

  it('keeps edited 2D node colors after timeline mode is turned off', () => {
    const updatedNodeColor = '#123456';
    const expectedNodeColor = normalizeColor(hexToRgbString(updatedNodeColor));
    let targetClusterValue = '';
    let targetNodeId = '';

    launchProfileToTwoD(profile);
    assertAfterLaunchCounts(profile);

    setTimelineField(timeline.field);
    waitForTwoDRenderIdle();
    assertNoRuntimeErrorBanner();
    clickTimelineSliderAtDate(midCheckpoint.date);
    waitForTwoDRenderIdle();
    assertNoRuntimeErrorBanner();
    assertTwoDTimelineNodeMembershipAligned();
    assertRenderedLogicalLinkCountMatchesMetric();

    openGlobalStylingTab();
    selectPrimeOption('#node-color-variable', 'Cluster');
    cy.window().its('commonService.session.style.widgets.node-color-variable').should('equal', 'cluster');

    cy.window().then((win: unknown) => {
      const cyInstance = (win as WinWithCy).cytoscapeInstance;
      expect(cyInstance, 'cytoscapeInstance').to.exist;

      const visibleNode = cyInstance
        .nodes(':visible')
        .filter((node: any) => node.children().length === 0)
        .first();

      expect(visibleNode.empty(), 'visible 2D node at midpoint timeline checkpoint').to.equal(false);
      targetClusterValue = String(visibleNode.data('cluster'));
      expect(targetClusterValue, 'visible cluster value to recolor').not.to.equal('');
    });

    cy.then(() => {
      expect(targetClusterValue, 'captured visible cluster value').not.to.equal('');
      changeColorTableEntry('#node-color-table', targetClusterValue, updatedNodeColor);
    });

    cy.window().should((win: unknown) => {
      const cyInstance = (win as WinWithCy).cytoscapeInstance;
      expect(cyInstance, 'cytoscapeInstance').to.exist;

      const recoloredNode = cyInstance
        .nodes(':visible')
        .filter((node: any) => node.children().length === 0)
        .toArray()
        .find((node: any) => normalizeColor(String(node.style('background-color') || '')) === expectedNodeColor);

      expect(Boolean(recoloredNode), 'recolored 2D node during timeline mode').to.equal(true);
    });

    cy.window().then((win: unknown) => {
      const cyInstance = (win as WinWithCy).cytoscapeInstance;
      expect(cyInstance, 'cytoscapeInstance').to.exist;

      const recoloredNode = cyInstance
        .nodes(':visible')
        .filter((node: any) => node.children().length === 0)
        .toArray()
        .find((node: any) =>
          String(node.data('cluster')) === targetClusterValue &&
          normalizeColor(String(node.style('background-color') || '')) === expectedNodeColor,
        );

      expect(Boolean(recoloredNode), 'recolored 2D node to persist after teardown').to.equal(true);
      targetNodeId = String(recoloredNode.id());
      expect(targetNodeId, 'captured recolored 2D node id').not.to.equal('');
    });

    cy.contains('#global-settings-modal .nav-link', 'Timeline').click({ force: true });
    cy.get('#global-settings-modal #timeline-config').should('exist');
    cy.get('#node-timeline-variable').click({ force: true });
    clickVisiblePrimeOption('None');
    cy.closeGlobalSettings();

    cy.window()
      .its('commonService.session.style.widgets')
      .should((widgets) => {
        expect(widgets['node-timeline-variable']).to.equal('None');
        expect(widgets['timeline-date-field']).to.equal('None');
      });
    waitForTwoDRenderIdle();
    assertNoRuntimeErrorBanner();

    cy.then(() => {
      expect(targetNodeId, 'captured recolored 2D node id after teardown').not.to.equal('');
      assertRenderedNodeColor(targetNodeId, expectedNodeColor);
    });
  });

  it('keeps edited 2D link colors after timeline mode is turned off', () => {
    const updatedLinkColor = '#0f4c81';
    const expectedLinkColor = normalizeColor(hexToRgbString(updatedLinkColor));
    let targetLinkRowIndex = -1;
    let targetLinkId = '';

    launchProfileToTwoD(profile);
    assertAfterLaunchCounts(profile);

    setTimelineField(timeline.field);
    waitForTwoDRenderIdle();
    assertNoRuntimeErrorBanner();
    assertProcessingModalClosed();

    clickTimelineSliderAtDate(midCheckpoint.date);
    waitForTwoDRenderIdle();
    assertNoRuntimeErrorBanner();
    assertProcessingModalClosed();
    assertTwoDTimelineNodeMembershipAligned();
    assertRenderedLogicalLinkCountMatchesMetric();

    openGlobalStylingTab();
    selectPrimeOption('#link-tooltip-variable', 'Cluster');
    cy.window().its('commonService.session.style.widgets.link-color-variable').should('equal', 'cluster');

    cy.get('#link-color-table tr', { timeout: 15000 })
      .then(($rows) => {
        targetLinkRowIndex = Array.from($rows).findIndex((row) => {
          const hasColorInput = row.querySelector('input[type="color"]') !== null;
          return hasColorInput;
        });

        expect(targetLinkRowIndex, 'editable 2D link color-table row index at midpoint timeline checkpoint')
          .to.be.greaterThan(0);
      });

    cy.then(() => {
      expect(targetLinkRowIndex, 'captured editable 2D link color-table row index').to.be.greaterThan(0);
      cy.get('#link-color-table tr')
        .eq(targetLinkRowIndex)
        .find('input[type="color"]')
        .should('have.length', 1)
        .then(($input) => {
          const input = $input.get(0) as HTMLInputElement;
          input.value = updatedLinkColor;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        });
      cy.get('#link-color-table tr')
        .eq(targetLinkRowIndex)
        .find('input[type="color"]')
        .should('have.value', updatedLinkColor);
    });

    waitForTwoDRenderIdle();
    assertNoRuntimeErrorBanner();
    assertProcessingModalClosed();

    cy.window().should((win: unknown) => {
      const cyInstance = (win as WinWithCy).cytoscapeInstance;
      expect(cyInstance, 'cytoscapeInstance').to.exist;

      const recoloredEdge = cyInstance
        .edges(':visible')
        .toArray()
        .find((edge: any) => normalizeColor(String(edge.style('line-color') || '')) === expectedLinkColor);

      expect(Boolean(recoloredEdge), 'recolored 2D link during timeline mode').to.equal(true);
      targetLinkId = String(recoloredEdge.id());
      expect(targetLinkId, 'captured recolored 2D link id').not.to.equal('');
    });

    cy.contains('#global-settings-modal .nav-link', 'Timeline').click({ force: true });
    cy.get('#global-settings-modal #timeline-config').should('exist');
    cy.get('#node-timeline-variable').click({ force: true });
    clickVisiblePrimeOption('None');
    cy.closeGlobalSettings();

    cy.window()
      .its('commonService.session.style.widgets')
      .should((widgets) => {
        expect(widgets['node-timeline-variable']).to.equal('None');
        expect(widgets['timeline-date-field']).to.equal('None');
      });
    waitForTwoDRenderIdle();
    assertNoRuntimeErrorBanner();
    assertProcessingModalClosed();

    cy.then(() => {
      expect(targetLinkId, 'captured recolored 2D link id after teardown').not.to.equal('');
      assertRenderedLinkColor(targetLinkId, expectedLinkColor);
    });

    openGlobalStylingTab();
    cy.get('#link-color-table input[type="color"]', { timeout: 15000 })
      .should(($inputs) => {
        const values = Array.from($inputs).map((input) => String((input as HTMLInputElement).value).toLowerCase());
        expect(values, 'rebuilt 2D link color-table values after timeline teardown').to.include(updatedLinkColor);
      });
    cy.closeGlobalSettings();
  });
});
