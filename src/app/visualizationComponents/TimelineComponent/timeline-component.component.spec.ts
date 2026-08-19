import * as d3 from 'd3';

import { TimelineComponent } from './timeline-component.component';
import { createDefaultMixedConfig } from './timeline-mixed-series';

describe('TimelineComponent mixed mode', () => {
  function createComponentShell(): any {
    const component = Object.create(TimelineComponent.prototype) as any;
    component.mixedGraphType = 'Mixed: Bars + Lines';
    component.selectedGraphType = component.mixedGraphType;
    component.widgets = {};
    component.mixedConfig = createDefaultMixedConfig(['onset', 'reported', 'comparison']);
    component.mixedConfig.annotations = [];
    component.mixedAnnotationSequence = 0;
    component.mixedDomainStartInput = '2025-01-01';
    component.refresh = jasmine.createSpy('refresh');
    return component;
  }

  it('uses the expanded settings dialog only for mixed mode', () => {
    const component = createComponentShell();

    expect(component.isMixedGraphType()).toBeTrue();
    expect(component.getEpiSettingsDialogStyle()).toEqual({ width: '760px', height: '700px' });

    component.selectedGraphType = 'Multi: Overlay';
    expect(component.isMixedGraphType()).toBeFalse();
    expect(component.getEpiSettingsDialogStyle()).toEqual({ width: '500px', height: '490px' });
  });

  it('clears the value field when a series returns to Count', () => {
    const component = createComponentShell();
    const series = component.mixedConfig.series[0];
    series.valueMode = 'count';
    series.valueField = 'amount';

    component.onMixedSeriesValueModeChange(series);

    expect(series.valueField).toBe('None');
    expect(component.widgets['epiCurve-mixedConfig']).toBe(component.mixedConfig);
    expect(component.refresh).toHaveBeenCalled();
  });

  it('adds, resets, persists, and removes a callout without changing legacy settings', () => {
    const component = createComponentShell();
    component.width = 100;
    component.x = () => 25;
    component.widgets['epiCurve-cumulative'] = true;

    component.addMixedAnnotation();
    const annotation = component.mixedConfig.annotations[0];
    annotation.text = 'Outbreak declared';
    component.resetMixedAnnotationPosition(annotation);

    expect(annotation.date).toBe('2025-01-01');
    expect(annotation.labelXRatio).toBeCloseTo(0.41, 5);
    expect(annotation.labelYRatio).toBe(0.32);
    expect(component.widgets['epiCurve-mixedConfig']).toBe(component.mixedConfig);
    expect(component.widgets['epiCurve-cumulative']).toBeTrue();

    component.removeMixedAnnotation(annotation.id);
    expect(component.mixedConfig.annotations).toEqual([]);
  });

  it('uses a custom legend label and falls back to the selected field label', () => {
    const component = createComponentShell();
    component.commonService = {
      capitalize: (value: string) => value.replace('reportedDate', 'Reported Date')
    };
    const series = component.mixedConfig.series[1];

    series.label = '2025 reports';
    expect(component.getMixedSeriesLabel(series)).toBe('2025 reports');

    series.label = '';
    series.dateField = 'reportedDate';
    expect(component.getMixedSeriesLabel(series)).toBe('Reported Date');
  });

  it('renders a useful empty-state message in the SVG', () => {
    const component = createComponentShell();
    const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    component.svg = d3.select(svgElement);
    component.width = 300;
    component.height = 180;
    component.margin = { top: 20, right: 20, bottom: 20, left: 20 };

    component.renderMixedEmptyState('Choose at least one valid date series in Settings.');

    const message = svgElement.querySelector('.epi-mixed-empty-state');
    expect(message?.textContent).toBe('Choose at least one valid date series in Settings.');
  });
});
