/// <reference types="cypress" />

import { getProfile } from '../datasets/profile';
import {
  assertAfterLaunchCounts,
  assertMetricCount,
  goToBubbleView,
  launchProfileToTwoD,
  openBubbleSettingsDialog,
  openGlobalStylingTab,
  setTimelineDate,
  setTimelineField,
  setTimelineRange,
} from '../../../support/journey-helpers';

type WinWithBubble = Window & {
  commonService: any;
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

const clickPrimeOption = (label: string, optionIdPrefix?: string): void => {
  const optionSelector = optionIdPrefix
    ? `li[role="option"][id^="${optionIdPrefix}"]`
    : 'li[role="option"]';

  cy.contains(optionSelector, new RegExp(`^${escapeRegExp(label)}$`), { timeout: 15000 })
    .then(($option) => {
      ($option.get(0) as HTMLElement).click();
    });
};

const selectPrimeOption = (selector: string, label: string): void => {
  cy.get(selector).click({ force: true });
  clickPrimeOption(label);
};

const setBubbleAxis = (
  selector: '#bubble-axis-x' | '#bubble-axis-y',
  label: string,
  expectedWidget: 'bubble-x' | 'bubble-y',
  expectedValue: string,
): void => {
  const axis = selector === '#bubble-axis-x' ? 'X' : 'Y';
  const variableProperty = selector === '#bubble-axis-x' ? 'xVariable' : 'yVariable';

  cy.window().then((win: unknown) => {
    const bubble = (win as WinWithBubble).commonService.visuals.bubble;

    bubble[variableProperty] = expectedValue;
    bubble.widgets[expectedWidget] = expectedValue;
    bubble.onDataChange(axis);
    bubble.cdref?.detectChanges?.();
  });

  cy.get('@bubbleSettings').find(selector).find('.p-select-label').should('contain', label);
  cy.window().its(`commonService.session.style.widgets.${expectedWidget}`).should('equal', expectedValue);
};

const setBubbleCollapsing = (collapsed: boolean): void => {
  cy.window().then((win: unknown) => {
    const bubble = (win as WinWithBubble).commonService.visuals.bubble;

    bubble.SelectedNodeCollapsingTypeVariable = collapsed;
    bubble.onNodeCollapsingChange();
    bubble.cdref?.detectChanges?.();
  });

  cy.window().its('commonService.visuals.bubble.SelectedNodeCollapsingTypeVariable').should('equal', collapsed);
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

const getBubbleDataNodes = (bubble: any) =>
  bubble.cy.nodes().filter((node: any) => !node.hasClass('X_axis') && !node.hasClass('Y_axis'));

const configureBubbleForTimeline = (collapsed: boolean): void => {
  openBubbleSettingsDialog();
  setBubbleAxis('#bubble-axis-x', 'State', 'bubble-x', 'State');
  setBubbleAxis('#bubble-axis-y', 'None', 'bubble-y', 'None');

  if (collapsed) {
    setBubbleCollapsing(true);
  } else {
    setBubbleCollapsing(false);
  }

  cy.closeSettingsPane('Bubble Settings');
};

const assertExpandedBubbleTimelineAligned = (expectedVisibleNodes?: number): void => {
  cy.window().should((win: unknown) => {
    const typedWindow = win as WinWithBubble;
    const visibleNodes = typedWindow.commonService.getVisibleNodes();
    const bubble = typedWindow.commonService.visuals.bubble;
    const renderedNodes = getBubbleDataNodes(bubble);

    expect(renderedNodes.length, 'rendered Bubble nodes stay aligned with visible nodes').to.equal(visibleNodes.length);
    if (expectedVisibleNodes !== undefined) {
      expect(visibleNodes.length, 'visible nodes at timeline checkpoint').to.equal(expectedVisibleNodes);
    }
  });
};

const assertCollapsedBubbleTimelineAligned = (): void => {
  cy.window().should((win: unknown) => {
    const typedWindow = win as WinWithBubble;
    const visibleNodes = typedWindow.commonService.getVisibleNodes();
    const bubble = typedWindow.commonService.visuals.bubble;
    const renderedNodes = getBubbleDataNodes(bubble);
    const aggregateTotal = bubble.visibleData.reduce((sum: number, node: any) => sum + Number(node.totalCount || 0), 0);

    expect(renderedNodes.length, 'collapsed rendered Bubble aggregates').to.be.lessThan(visibleNodes.length);
    expect(aggregateTotal, 'collapsed Bubble aggregate totalCount sum').to.equal(visibleNodes.length);

    bubble.visibleData.forEach((aggregateNode: any) => {
      const renderedNode = bubble.cy.getElementById(aggregateNode.id);
      expect(renderedNode.empty(), `collapsed Bubble aggregate ${aggregateNode.id}`).to.equal(false);
      expect(
        Number(renderedNode.data('nodeSize')),
        `collapsed Bubble nodeSize for ${aggregateNode.id}`,
      ).to.be.closeTo(bubble.nodeSize * Math.sqrt(Number(aggregateNode.totalCount || 0)), 0.001);
    });
  });
};

const assertBubbleDateAxisMatchesSelectedTimelineRange = (field: string): void => {
  cy.window().should((win: unknown) => {
    const typedWindow = win as WinWithBubble;
    const bubble = typedWindow.commonService.visuals.bubble;
    const validDate = (value: unknown): boolean => !Number.isNaN(Date.parse(String(value || '')));
    const sortDates = (left: string, right: string): number => Date.parse(left) - Date.parse(right);
    const state = typedWindow.commonService.session.state;
    const rangeStart = Date.parse(String(state.timeStart));
    const rangeEnd = Date.parse(String(state.timeTarget || state.timeEnd));
    const expectedDates = Array.from(new Set(
      typedWindow.commonService.getVisibleNodesIgnoringTimeline()
        .map((node: any) => String(node[field] || ''))
        .filter((date: string) => {
          const time = Date.parse(date);
          return validDate(date) && time >= rangeStart && time <= rangeEnd;
        }),
    )).sort(sortDates);
    const actualDates = bubble.X_categories
      .map((value: unknown) => String(value || ''))
      .filter(validDate);
    const axisLabels = bubble.cy.nodes('.X_axis').map((node: any) => String(node.data('label') || ''));

    expect(actualDates, 'Bubble X date categories follow the selected timeline range').to.deep.equal(expectedDates);
    expect(actualDates, 'pre-range date buckets removed').not.to.include('6/28/2021');
    expect(actualDates, 'post-range date buckets removed').not.to.include('8/21/2021');
    expect(axisLabels, 'rendered Bubble axis labels omit pre-range dates').not.to.include('06/28/2021');
    expect(axisLabels, 'rendered Bubble axis labels omit post-range dates').not.to.include('08/21/2021');
  });
};

const clickTimelineSliderAtDate = (date: string): void => {
  cy.window().then((win: unknown) => {
    const microbeTrace = (win as WinWithBubble).commonService.visuals.microbeTrace;
    const targetDate = new Date(date);
    const targetX = Math.round(Number(microbeTrace.xAttribute(targetDate)));
    const expectedLabel = String(microbeTrace.handleDateFormat(targetDate));

    cy.get('#global-timeline svg line.track-overlay').first().click(targetX, 0, { force: true });
    cy.get('svg g.slider text.label').should('have.text', expectedLabel);
  });

  cy.window()
    .its('commonService.session.state.timeEnd')
    .should((value) => {
      expect(new Date(value as string | number | Date).toDateString(), 'timeline slider date')
        .to.equal(new Date(date).toDateString());
    });
};

describe('Journey Flow - Bubble uploaded timeline controls', () => {
  const profile = getProfile('timeline-covid-node-link');
  const timeline = profile.expectations.timeline!;
  const startCheckpoint = timeline.checkpoints.find((checkpoint) => checkpoint.id === 'timeline-start') ?? timeline.checkpoints[0];
  const midCheckpoint = timeline.checkpoints.find((checkpoint) => checkpoint.id === 'timeline-mid') ?? timeline.checkpoints[0];
  const recoloredNodeId = 'MZ415508';

  it('keeps Bubble timeline play/pause and slider jumps aligned with uploaded visible membership', () => {
    let initialLabel = '';
    let initialTime = 0;

    launchProfileToTwoD(profile);
    assertAfterLaunchCounts(profile);
    goToBubbleView();
    configureBubbleForTimeline(false);

    setTimelineField(timeline.field);
    assertExpandedBubbleTimelineAligned();

    cy.get('svg g.slider text.label', { timeout: 15000 })
      .invoke('text')
      .then((text) => {
        initialLabel = String(text).trim();
      });

    cy.window().then((win: unknown) => {
      const value = (win as WinWithBubble).commonService.session.state.timeEnd;
      initialTime = new Date(value as string | number | Date).getTime();
    });

    cy.get('#timeline-play-button').should('contain', 'Play').click();
    cy.get('#timeline-play-button', { timeout: 15000 }).should('contain', 'Pause');

    cy.window({ timeout: 15000 }).should((win: unknown) => {
      const nextValue = (win as WinWithBubble).commonService.session.state.timeEnd;
      const nextTime = new Date(nextValue as string | number | Date).getTime();
      expect(Number.isFinite(nextTime), 'timeline playback date').to.equal(true);
      expect(nextTime, 'timeline playback advanced the current date').not.to.equal(initialTime);
    });

    cy.get('#timeline-play-button').should('contain', 'Pause').click();
    cy.get('#timeline-play-button').should('contain', 'Play');

    cy.get('svg g.slider text.label')
      .invoke('text')
      .should((text) => {
        expect(String(text).trim(), 'timeline label after play/pause').not.to.equal(initialLabel);
      });

    assertExpandedBubbleTimelineAligned();

    clickTimelineSliderAtDate(midCheckpoint.date);
    assertMetricCount('#numberOfNodes', midCheckpoint.after.nodes!);
    assertExpandedBubbleTimelineAligned(midCheckpoint.after.nodes);

    clickTimelineSliderAtDate(startCheckpoint.date);
    assertMetricCount('#numberOfNodes', startCheckpoint.after.nodes!);
    assertExpandedBubbleTimelineAligned(startCheckpoint.after.nodes);
  });

  it('keeps collapsed Bubble timeline playback aligned with aggregate totals and scaled node sizes', () => {
    let initialLabel = '';
    let initialTime = 0;

    launchProfileToTwoD(profile);
    assertAfterLaunchCounts(profile);
    goToBubbleView();
    configureBubbleForTimeline(true);

    setTimelineField(timeline.field);

    cy.get('svg g.slider text.label', { timeout: 15000 })
      .invoke('text')
      .then((text) => {
        initialLabel = String(text).trim();
      });

    cy.window().then((win: unknown) => {
      const value = (win as WinWithBubble).commonService.session.state.timeEnd;
      initialTime = new Date(value as string | number | Date).getTime();
    });

    cy.get('#timeline-play-button').should('contain', 'Play').click();
    cy.get('#timeline-play-button', { timeout: 15000 }).should('contain', 'Pause');

    cy.window({ timeout: 15000 }).should((win: unknown) => {
      const nextValue = (win as WinWithBubble).commonService.session.state.timeEnd;
      const nextTime = new Date(nextValue as string | number | Date).getTime();
      expect(Number.isFinite(nextTime), 'collapsed timeline playback date').to.equal(true);
      expect(nextTime, 'collapsed timeline playback advanced the current date').not.to.equal(initialTime);
    });

    cy.get('#timeline-play-button').should('contain', 'Pause').click();
    cy.get('#timeline-play-button').should('contain', 'Play');

    cy.get('svg g.slider text.label')
      .invoke('text')
      .should((text) => {
        expect(String(text).trim(), 'collapsed timeline label after play/pause').not.to.equal(initialLabel);
      });

    setTimelineDate(midCheckpoint.date);
    assertMetricCount('#numberOfNodes', midCheckpoint.after.nodes!);
    assertCollapsedBubbleTimelineAligned();
  });

  it('removes filtered-out date buckets when a Bubble axis is date-based', () => {
    launchProfileToTwoD(profile);
    assertAfterLaunchCounts(profile);
    goToBubbleView();

    openBubbleSettingsDialog();
    setBubbleAxis('#bubble-axis-x', 'Date of symptom onset Date', 'bubble-x', timeline.field);
    setBubbleAxis('#bubble-axis-y', 'None', 'bubble-y', 'None');
    cy.get('@bubbleSettings').find('#xVarDate').click({ force: true });
    cy.window().its('commonService.visuals.bubble.xVarDate').should('equal', true);
    cy.closeSettingsPane('Bubble Settings');

    setTimelineField(timeline.field);
    cy.openGlobalSettings();
    cy.contains('#global-settings-modal .nav-link', 'Timeline').click({ force: true });
    setTimelineRange('7/7/2021', midCheckpoint.date);
    cy.closeGlobalSettings();
    assertExpandedBubbleTimelineAligned();
    assertBubbleDateAxisMatchesSelectedTimelineRange(timeline.field);

    cy.get('#timeline-play-button').should('contain', 'Play').click();
    cy.get('#timeline-play-button', { timeout: 15000 }).should('contain', 'Pause');
    cy.window({ timeout: 15000 }).should((win: unknown) => {
      const state = (win as WinWithBubble).commonService.session.state;
      const currentTime = new Date(state.timeEnd as string | number | Date).getTime();
      expect(currentTime, 'playhead advances inside selected range')
        .to.be.greaterThan(new Date('7/7/2021').getTime())
        .and.lessThan(new Date(midCheckpoint.date).getTime());
    });
    assertBubbleDateAxisMatchesSelectedTimelineRange(timeline.field);
    cy.get('#timeline-play-button').should('contain', 'Pause').click();
    cy.get('#timeline-play-button').should('contain', 'Play');
  });

  it('keeps edited Bubble node colors after timeline mode is turned off', () => {
    const updatedPennsylvaniaColor = '#777777';
    const expectedPennsylvaniaColor = normalizeColor(hexToRgbString(updatedPennsylvaniaColor));

    launchProfileToTwoD(profile);
    assertAfterLaunchCounts(profile);
    goToBubbleView();
    configureBubbleForTimeline(false);

    setTimelineField(timeline.field);
    setTimelineDate(midCheckpoint.date);
    assertExpandedBubbleTimelineAligned(midCheckpoint.after.nodes);

    openGlobalStylingTab();
    selectPrimeOption('#node-color-variable', 'State');
    cy.window().its('commonService.session.style.widgets.node-color-variable').should('equal', 'State');
    cy.get('#key-tables-node-table', { timeout: 15000 }).should('be.visible');
    changeColorTableEntry('#key-tables-node-table', 'Pennsylvania', updatedPennsylvaniaColor);
    cy.closeGlobalSettings();

    cy.window().should((win: unknown) => {
      const bubble = (win as WinWithBubble).commonService.visuals.bubble;
      const renderedNode = bubble.cy.getElementById(recoloredNodeId);

      expect(renderedNode.empty(), `recolored Bubble node ${recoloredNodeId} during timeline`).to.equal(false);
      expect(normalizeColor(renderedNode.style('background-color')), `timeline Bubble color for ${recoloredNodeId}`)
        .to.equal(expectedPennsylvaniaColor);
    });

    setTimelineField('None');

    cy.window()
      .its('commonService.session.style.widgets')
      .should((widgets) => {
        expect(widgets['node-timeline-variable']).to.equal('None');
        expect(widgets['timeline-date-field']).to.equal('None');
      });

    cy.window().should((win: unknown) => {
      const bubble = (win as WinWithBubble).commonService.visuals.bubble;
      const renderedNode = bubble.cy.getElementById(recoloredNodeId);

      expect(renderedNode.empty(), `recolored Bubble node ${recoloredNodeId} after timeline teardown`).to.equal(false);
      expect(normalizeColor(renderedNode.style('background-color')), `post-teardown Bubble color for ${recoloredNodeId}`)
        .to.equal(expectedPennsylvaniaColor);
    });

    openGlobalStylingTab();
    cy.get('#key-tables-node-table td[data-value="Pennsylvania"]')
      .closest('tr')
      .find('input[type="color"]')
      .should('have.value', updatedPennsylvaniaColor);
    cy.closeGlobalSettings();
  });
});
