import { ElementRef } from '@angular/core';
import { of } from 'rxjs';
import { EvolutionaryRateComponent } from './evolutionary-rate.component';

describe('EvolutionaryRateComponent', () => {
  function createComponent(options: {
    nodeFields?: string[];
    nodes?: any[];
    widgets?: Record<string, any>;
    pairDistances?: Record<string, number>;
    phylogenetic?: boolean;
    patristicDistances?: Record<string, number>;
    bestFitPatristicDistances?: Record<string, number>;
  } = {}) {
    const widgets = {
      'default-distance-metric': 'snps',
      'tn93-distance-display-format': 'decimal',
      'background-color': '#ffffff',
      'background-color-contrast': '#000000',
      'selected-color': '#ff8300',
      'selected-node-stroke-color': '#ff8300',
      'selected-node-stroke-width': '4px',
      'node-color': '#1f77b4',
      'node-symbol': 'ellipse',
      'node-symbol-variable': 'None',
      'evolutionary-rate-date-field': 'None',
      'evolutionary-rate-root-method': 'as-provided',
      'evolutionary-rate-table-visible': 'Show',
      'evolutionary-rate-node-label-variable': 'None',
      'evolutionary-rate-node-label-size': 16,
      'evolutionary-rate-node-label-orientation': 'Right',
      'evolutionary-rate-node-tooltip-variable': ['_id'],
      'evolutionary-rate-node-radius-variable': 'None',
      'evolutionary-rate-node-radius': 20,
      'evolutionary-rate-node-radius-min': 15,
      'evolutionary-rate-node-radius-max': 85,
      'evolutionary-rate-node-border-width': 2,
      ...options.widgets,
    };
    const nodes = options.nodes || [];
    const commonService = {
      session: {
        data: {
          nodeFields: options.nodeFields || ['_id', 'collectionDate'],
          nodes,
          nodeFilteredValues: nodes.map(node => ({ ...node })),
        },
        style: {
          widgets,
          nodeSymbolsTableKeys: {},
          nodeSymbolsTable: {},
        },
      },
      temp: {
        style: {
          nodeSymbolMap: () => 'ellipse',
        },
      },
      titleize: (value: string) => value,
      getVisibleNodes: () => nodes,
      hasValidTimelineDateValue: (value: any) => value !== null && value !== undefined && value !== '',
      hasPhylogeneticDistanceSource: () => Boolean(options.phylogenetic),
      getPatristicRootDistanceMap: jasmine.createSpy('getPatristicRootDistanceMap').and.callFake(
        async () => new Map(Object.entries(options.patristicDistances || {}))
      ),
      getPatristicBestFitRootDistanceMap: jasmine.createSpy('getPatristicBestFitRootDistanceMap').and.callFake(
        async () => new Map(Object.entries(options.bestFitPatristicDistances || {}))
      ),
      getActiveNodePairDistance: (source: string, target: string) => {
        if (source === target) return 0;
        const key = [source, target].sort().join('|');
        return options.pairDistances?.[key] ?? null;
      },
      tn93PercentageDisplayEnabled: () => widgets['default-distance-metric'] === 'tn93'
        && widgets['tn93-distance-display-format'] === 'percentage',
      getNodeFillStyle: () => ({ color: '#1f77b4', alpha: 1 }),
    } as any;
    const container = {
      width: 800,
      height: 500,
      on: () => undefined,
    } as any;
    const store = {
      clusterUpdate$: of(),
      networkUpdated$: of(),
      metricChanged$: of(),
      styleFileApplied$: of(),
      setNetworkRendered: jasmine.createSpy('setNetworkRendered'),
    } as any;
    const changeDetector = { detectChanges: jasmine.createSpy('detectChanges') } as any;
    const visuals: any = {};
    const exportService = {
      setExportOptions: jasmine.createSpy('setExportOptions'),
      requestExport: jasmine.createSpy('requestExport'),
      requestSVGExport: jasmine.createSpy('requestSVGExport'),
    } as any;
    const host = document.createElement('div');
    const exportHost = document.createElement('div');
    exportHost.appendChild(host);
    const component = new EvolutionaryRateComponent(
      container,
      new ElementRef(document.createElement('div')),
      commonService,
      store,
      changeDetector,
      { pushTag: jasmine.createSpy('pushTag') } as any,
      visuals,
      exportService,
    );

    component.plotExportHost = new ElementRef(exportHost);
    component.plotHost = new ElementRef(host);
    (component as any).widgets = widgets;
    (component as any).viewInitialized = true;

    return { component, commonService, widgets, visuals, exportService, exportHost, host };
  }

  it('loads independent default appearance settings and exposes itself to global visuals', () => {
    const { component, visuals } = createComponent();

    component.loadSettings();

    expect(component.selectedTableVisibility).toBe('Show');
    expect(component.selectedTreeRootMethod).toBe('as-provided');
    expect(component.selectedNodeLabelVariable).toBe('None');
    expect(component.selectedNodeRadius).toBe(20);
    expect(component.selectedNodeBorderWidth).toBe(2);
    expect(visuals.evolutionaryRate).toBe(component);
  });

  it('persists table and node appearance settings under the evolutionary-rate prefix', () => {
    const { component, widgets } = createComponent();
    component.loadSettings();

    component.onTableVisibilityChange('Hide');
    component.onTreeRootMethodChange('best-fit');
    component.onNodeLabelVariableChange('_id');
    component.onNodeRadiusVariableChange('SNPs');
    component.onNodeBorderWidthChange(3.5);

    expect(component.tableVisible).toBeFalse();
    expect(widgets['evolutionary-rate-table-visible']).toBe('Hide');
    expect(widgets['evolutionary-rate-root-method']).toBe('best-fit');
    expect(widgets['evolutionary-rate-node-label-variable']).toBe('_id');
    expect(widgets['evolutionary-rate-node-radius-variable']).toBe('SNPs');
    expect(widgets['evolutionary-rate-node-border-width']).toBe(3.5);
    expect(widgets['node-label-variable']).toBeUndefined();
  });

  it('plots canonical active-metric link distances and reports invalid visible rows as excluded', async () => {
    const { component, host } = createComponent({
      nodes: [
        { _id: 'a', collectionDate: '2020-01-01', SNPs: 100 },
        { _id: 'b', collectionDate: '2021-01-01', SNPs: 100 },
        { _id: 'c', collectionDate: '2020-02-30', SNPs: 100 },
        { _id: 'd', collectionDate: '2022-01-01', SNPs: 100 },
      ],
      pairDistances: { 'a|b': 2 },
      widgets: { 'evolutionary-rate-date-field': 'collectionDate' },
    });
    component.loadSettings();

    await (component as any).refreshPlot();

    expect(component.includedCount).toBe(2);
    expect(component.excludedCount).toBe(2);
    expect(component.excludedDataPoints.map(point => point.id)).toEqual(['c', 'd']);
    expect(component.excludedDataPoints[0].reason).toBe('Missing or invalid collectionDate value.');
    expect(component.excludedDataPoints[1].reason).toContain('No stored SNPs distance from a');
    component.openExcludedDataPoints();
    expect(component.showExcludedDataPointsDialog).toBeTrue();
    expect(component.analysis.slope).toBeCloseTo(2, 10);
    expect(component.distanceSourceLabel).toContain('SNPs distance from earliest dated sample (a)');
    const renderedPoints = Array.from(host.querySelectorAll('[data-testid="evolutionary-rate-point"]'));
    const regressionLine = host.querySelector('[data-testid="evolutionary-rate-regression-line"]') as SVGLineElement;
    expect(renderedPoints.length).toBe(2);
    expect(regressionLine).not.toBeNull();
    const plotChildren = Array.from(regressionLine.parentElement!.children);
    expect(plotChildren.indexOf(regressionLine)).toBeGreaterThan(
      Math.max(...renderedPoints.map(point => plotChildren.indexOf(point)))
    );
    expect(regressionLine.style.pointerEvents).toBe('none');
    const plotWidth = Number(host.querySelector('clipPath rect')?.getAttribute('width'));
    expect(Number(regressionLine.getAttribute('x1'))).toBeCloseTo(0, 10);
    expect(Number(regressionLine.getAttribute('x2'))).toBeCloseTo(plotWidth, 10);
  });

  it('recalculates statistics from selected nodes while retaining and highlighting all plotted points', async () => {
    const nodes = [
      { _id: 'a', collectionDate: '2020-01-01', selected: false },
      { _id: 'b', collectionDate: '2021-01-01', selected: true },
      { _id: 'c', collectionDate: '2022-01-01', selected: true },
    ];
    const { component, host } = createComponent({
      nodes,
      pairDistances: {
        'a|b': 2,
        'a|c': 6,
      },
      widgets: { 'evolutionary-rate-date-field': 'collectionDate' },
    });
    component.loadSettings();

    await (component as any).refreshPlot();

    expect(component.selectionActive).toBeTrue();
    expect(component.selectedNodeCount).toBe(2);
    expect(component.analysis.points.map(point => point.id)).toEqual(['b', 'c']);
    expect(component.analysis.slope).toBeCloseTo(4, 10);
    expect(component.includedCount).toBe(2);
    expect(component.excludedCount).toBe(0);

    const renderedPoints = Array.from(
      host.querySelectorAll('[data-testid="evolutionary-rate-point"]')
    );
    expect(renderedPoints.length).toBe(3);
    expect(
      renderedPoints
        .filter(point => point.getAttribute('data-selected') === 'true')
        .map(point => point.getAttribute('data-node-id'))
    ).toEqual(['b', 'c']);
    const selectedMarkerUri = renderedPoints[1].getAttribute('href') || '';
    expect(decodeURIComponent(selectedMarkerUri)).toContain('stroke="#ff8300"');
    expect(decodeURIComponent(selectedMarkerUri)).toContain('stroke-width="100"');

    nodes.forEach(node => node.selected = false);
    await (component as any).refreshPlot();

    expect(component.selectionActive).toBeFalse();
    expect(component.analysis.points.map(point => point.id)).toEqual(['a', 'b', 'c']);
    expect(component.analysis.slope).toBeCloseTo(3, 10);
    expect(
      Array.from(host.querySelectorAll('[data-selected="true"]')).length
    ).toBe(0);
  });

  it('selects plotted nodes with 2D-style single and additive interactions', async () => {
    const nodes = [
      { _id: 'a', collectionDate: '2020-01-01', selected: false },
      { _id: 'b', collectionDate: '2021-01-01', selected: false },
      { _id: 'c', collectionDate: '2022-01-01', selected: false },
    ];
    const { component, commonService, host } = createComponent({
      nodes,
      pairDistances: {
        'a|b': 2,
        'a|c': 6,
      },
      widgets: { 'evolutionary-rate-date-field': 'collectionDate' },
    });
    component.loadSettings();
    await (component as any).refreshPlot();

    const selectedEvents: string[] = [];
    $(document).on('node-selected.evolutionary-rate-test', () => selectedEvents.push('selected'));
    try {
      const markers = Array.from(
        host.querySelectorAll('[data-testid="evolutionary-rate-point"]')
      ) as SVGImageElement[];
      markers[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(nodes.map(node => node.selected)).toEqual([false, true, false]);
      expect(commonService.session.data.nodeFilteredValues.map(node => node.selected))
        .toEqual([false, true, false]);

      markers[2].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      expect(nodes.map(node => node.selected)).toEqual([false, true, true]);
      expect(selectedEvents.length).toBe(2);
    } finally {
      $(document).off('node-selected.evolutionary-rate-test');
    }
  });

  it('does not fall back to unrelated numeric node fields when pairwise distances are unavailable', async () => {
    const { component } = createComponent({
      nodeFields: ['_id', 'collectionDate', 'SNPs'],
      nodes: [
        { _id: 'a', collectionDate: '2020-01-01', SNPs: 1 },
        { _id: 'b', collectionDate: '2021-01-01', SNPs: 2 },
      ],
      widgets: { 'evolutionary-rate-date-field': 'collectionDate' },
    });
    component.loadSettings();

    await (component as any).refreshPlot();

    expect(component.analysis.points.map(point => point.id)).toEqual(['a']);
    expect(component.regressionMessage).toContain('stored SNPs distance from a');
  });

  it('uses phylogenetic root-to-tip patristic distances instead of the global metric links', async () => {
    const { component, host } = createComponent({
      phylogenetic: true,
      nodes: [
        { _id: 'a', collectionDate: '2020-01-01' },
        { _id: 'b', collectionDate: '2021-01-01' },
        { _id: 'c', collectionDate: '2022-01-01' },
      ],
      pairDistances: { 'a|b': 99, 'a|c': 99 },
      patristicDistances: { a: 0.1, b: 0.2, c: 0.3 },
      widgets: {
        'default-distance-metric': 'tn93',
        'tn93-distance-display-format': 'percentage',
        'evolutionary-rate-date-field': 'collectionDate',
      },
    });
    component.loadSettings();

    await (component as any).refreshPlot();

    expect(component.distanceSourceKind).toBe('patristic');
    expect(component.distanceSourceLabel).toBe('Patristic root-to-tip distance');
    expect(component.analysis.points.map(point => point.distance)).toEqual([0.1, 0.2, 0.3]);
    expect(host.querySelector('[data-testid="evolutionary-rate-y-axis-title"]')?.textContent).toBe('Patristic Distance');
    expect(component.formatSlope()).toBe('0.1');
  });

  it('uses the dated regression tips to locate a best-fit root only when requested', async () => {
    const { component, commonService } = createComponent({
      phylogenetic: true,
      nodes: [
        { _id: 'a', collectionDate: '2020-01-01' },
        { _id: 'b', collectionDate: '2021-01-01' },
        { _id: 'c', collectionDate: '2022-01-01' },
      ],
      patristicDistances: { a: 1, b: 2, c: 4 },
      bestFitPatristicDistances: { a: 0.5, b: 2.5, c: 4.5 },
      widgets: {
        'evolutionary-rate-date-field': 'collectionDate',
        'evolutionary-rate-root-method': 'best-fit',
      },
    });
    component.loadSettings();

    await (component as any).refreshPlot();

    expect(component.distanceSourceLabel).toBe('Best-fit patristic root-to-tip distance');
    expect(component.analysis.points.map(point => point.distance)).toEqual([0.5, 2.5, 4.5]);
    expect(commonService.getPatristicRootDistanceMap).not.toHaveBeenCalled();
    expect(commonService.getPatristicBestFitRootDistanceMap).toHaveBeenCalledTimes(1);
    const datedTips = commonService.getPatristicBestFitRootDistanceMap.calls.mostRecent().args[0];
    expect(datedTips.map((tip: any) => tip.id)).toEqual(['a', 'b', 'c']);
    expect(datedTips.map((tip: any) => tip.decimalYear)).toEqual([2020, 2021, 2022]);
  });

  it('changes the Y-axis label and canonical distances with the selected metric', async () => {
    const pairDistances = { 'a|b': 2 };
    const { component, widgets, host } = createComponent({
      nodes: [
        { _id: 'a', collectionDate: '2020-01-01' },
        { _id: 'b', collectionDate: '2021-01-01' },
      ],
      pairDistances,
      widgets: { 'evolutionary-rate-date-field': 'collectionDate' },
    });
    component.loadSettings();

    await (component as any).refreshPlot();
    expect(host.querySelector('[data-testid="evolutionary-rate-y-axis-title"]')?.textContent).toBe('Genetic Distance (SNPs)');
    expect(component.analysis.points.map(point => point.distance)).toEqual([0, 2]);

    widgets['default-distance-metric'] = 'tn93';
    pairDistances['a|b'] = 0.02;
    await (component as any).refreshPlot();

    expect(host.querySelector('[data-testid="evolutionary-rate-y-axis-title"]')?.textContent).toBe('Genetic Distance (TN93)');
    expect(component.analysis.points.map(point => point.distance)).toEqual([0, 0.02]);
  });

  it('exports the statistics CSV and routes configurable raster and SVG plots through the shared export service', async () => {
    const { component, exportService, exportHost, host } = createComponent({
      nodes: [
        { _id: 'a', collectionDate: '2020-01-01' },
        { _id: 'b', collectionDate: '2021-01-01' },
      ],
      pairDistances: { 'a|b': 2 },
      widgets: { 'evolutionary-rate-date-field': 'collectionDate' },
    });
    component.loadSettings();
    await (component as any).refreshPlot();

    const captured: Array<{ content: Blob | string; filename: string }> = [];
    (window as any).__mtTestSaveAs = (content: Blob | string, filename: string) => {
      captured.push({ content, filename });
    };
    try {
      component.statisticsExportFilename = 'rate-table';
      component.plotExportFilename = 'rate-plot.svg';
      component.openExport();
      component.downloadStatisticsTable();

      component.plotExportFileType = 'png';
      component.plotExportScale = 1.5;
      component.plotExportQuality = 0.8;
      component.updateCalculatedPlotExportResolution();
      component.downloadRegressionPlot();

      const renderedSvg = host.querySelector('svg') as SVGSVGElement;
      const expectedWidth = Math.round(Number(renderedSvg.getAttribute('width')) * 1.5);
      const expectedHeight = Math.round(Number(renderedSvg.getAttribute('height')) * 1.5);
      expect(component.calculatedPlotExportResolution).toBe(`${expectedWidth} x ${expectedHeight}`);
      expect(exportService.setExportOptions).toHaveBeenCalledWith({
        filename: 'rate-plot',
        filetype: 'png',
        scale: 1.5,
        quality: 0.8,
      });
      expect(exportService.requestExport).toHaveBeenCalledWith([exportHost], true, false, true);

      component.plotExportFileType = 'svg';
      component.downloadRegressionPlot();
    } finally {
      delete (window as any).__mtTestSaveAs;
    }

    expect(component.showExportDialog).toBeTrue();
    expect(captured.map(item => item.filename)).toEqual(['rate-table.csv']);
    expect(captured[0].content instanceof Blob).toBeTrue();
    const statisticsBytes = new Uint8Array(await (captured[0].content as Blob).arrayBuffer());
    expect(Array.from(statisticsBytes.slice(0, 3))).toEqual([0xEF, 0xBB, 0xBF]);
    const statisticsCsv = new TextDecoder('utf-8').decode(statisticsBytes);
    const statisticsRows = statisticsCsv.split('\r\n');
    expect(statisticsRows).toContain('Date range,2020-01-01 – 2021-01-01 (1.00 years)');
    expect(statisticsRows).toContain('Slope (rate),2');
    expect(statisticsRows).toContain('Residual Mean Squared,0');
    expect(exportService.requestSVGExport).toHaveBeenCalled();
    const svgExport = exportService.requestSVGExport.calls.mostRecent().args;
    expect(svgExport[1]).toContain('data-testid="evolutionary-rate-plot"');
    expect(svgExport[1]).toContain('data-testid="evolutionary-rate-export-statistics"');
    expect(svgExport[1]).toContain('Residual Mean Squared');
    expect(svgExport.slice(2)).toEqual([true, false, true]);

    component.selectedTableVisibility = 'Hide';
    component.downloadRegressionPlot();
    const svgExportWithoutTable = exportService.requestSVGExport.calls.mostRecent().args;
    expect(svgExportWithoutTable[1]).not.toContain('data-testid="evolutionary-rate-export-statistics"');
  });
});
