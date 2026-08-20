import {
  EpiMixedBinInterval,
  aggregateMixedSeries,
  createDefaultMixedConfig,
  getClosestMixedHoverPoint,
  getClosestMixedHoverPoints,
  getGroupedBarGeometry,
  getMixedDateExtent,
  getNumericMixedFields,
  getZeroInclusiveDomain,
  groupMixedHoverPoints,
  normalizeMixedConfig
} from './timeline-mixed-series';

describe('timeline mixed-series helpers', () => {
  const intervals: EpiMixedBinInterval[] = [
    { x0: new Date(2025, 0, 1), x1: new Date(2025, 0, 2) },
    { x0: new Date(2025, 0, 2), x1: new Date(2025, 0, 3) }
  ];

  it('initializes three mixed series from legacy date fields and colors', () => {
    const config = createDefaultMixedConfig(
      ['onset', 'dose_2025', 'dose_2024'],
      ['#111111', '#222222', '#333333']
    );

    expect(config.version).toBe(1);
    expect(config.series.map(series => series.dateField)).toEqual(['onset', 'dose_2025', 'dose_2024']);
    expect(config.series.map(series => series.mark)).toEqual(['bar', 'solid-line', 'dashed-line']);
    expect(config.series.every(series => series.valueMode === 'count')).toBeTrue();
    expect(config.series.map(series => series.color)).toEqual(['#111111', '#222222', '#333333']);
  });

  it('normalizes malformed saved configuration without changing valid choices', () => {
    const config = normalizeMixedConfig({
      series: [
        { dateField: 'onset', valueMode: 'sum', valueField: 'doses', mark: 'solid-line', color: '#123456', label: 'Doses' }
      ],
      figureText: { title: 'Outbreak figure' },
      annotations: [{ id: 'a', date: '2025-01-02', text: 'Milestone', labelXRatio: 4, labelYRatio: -2 }]
    });

    expect(config.series).toHaveSize(3);
    expect(config.series[0].valueMode).toBe('sum');
    expect(config.series[0].mark).toBe('solid-line');
    expect(config.figureText.title).toBe('Outbreak figure');
    expect(config.annotations[0].labelXRatio).toBe(1);
    expect(config.annotations[0].labelYRatio).toBe(0);
  });

  it('counts dated records per bin and calculates a running total', () => {
    const config = createDefaultMixedConfig(['onset']).series[0];
    const result = aggregateMixedSeries([
      { onset: '2025-01-01' },
      { onset: '2025-01-01T12:00:00' },
      { onset: '2025-01-02' },
      { onset: 'not-a-date' }
    ], config, intervals);

    expect(result.includedRecords).toBe(3);
    expect(result.bins.map(bin => bin.value)).toEqual([2, 1]);
    expect(result.bins.map(bin => bin.cumulativeValue)).toEqual([2, 3]);
  });

  it('sums finite values while retaining zero and negative values', () => {
    const config = {
      ...createDefaultMixedConfig(['date']).series[0],
      valueMode: 'sum' as const,
      valueField: 'amount'
    };
    const result = aggregateMixedSeries([
      { date: '2025-01-01', amount: '4.5' },
      { date: '2025-01-01', amount: 0 },
      { date: '2025-01-02', amount: -2 },
      { date: '2025-01-02', amount: 'missing' },
      { date: 'bad', amount: 10 }
    ], config, intervals);

    expect(result.includedRecords).toBe(3);
    expect(result.bins.map(bin => bin.value)).toEqual([4.5, -2]);
    expect(result.bins.map(bin => bin.cumulativeValue)).toEqual([4.5, 2.5]);
  });

  it('finds numeric fields and the shared date extent', () => {
    const records = [
      { dateA: '2025-03-10', dateB: '2025-03-01', amount: '2', category: 'A' },
      { dateA: '2025-03-12', dateB: null, amount: null, category: 'B' }
    ];
    const series = createDefaultMixedConfig(['dateA', 'dateB']).series;

    expect(getNumericMixedFields(records, ['amount', 'category'])).toEqual(['amount']);
    expect(getMixedDateExtent(records, series)).toEqual([new Date(2025, 2, 1), new Date(2025, 2, 12)]);
  });

  it('retains a single-date extent so the renderer can expand it to one bin', () => {
    const records = [
      { onset: '2025-04-15' },
      { onset: '2025-04-15T18:30:00' }
    ];
    const series = createDefaultMixedConfig(['onset']).series;

    expect(getMixedDateExtent(records, series)).toEqual([new Date(2025, 3, 15), new Date(2025, 3, 15, 18, 30)]);
  });

  it('creates zero-inclusive domains for positive, negative, and empty data', () => {
    expect(getZeroInclusiveDomain([5, 10])).toEqual([0, 10]);
    expect(getZeroInclusiveDomain([-5, -2])).toEqual([-5, 0]);
    expect(getZeroInclusiveDomain([-5, 8])).toEqual([-5, 8]);
    expect(getZeroInclusiveDomain([])).toEqual([0, 1]);
  });

  it('allocates grouped bars side by side within a bin', () => {
    const first = getGroupedBarGeometry(10, 70, 0, 3, 3);
    const second = getGroupedBarGeometry(10, 70, 1, 3, 3);
    const third = getGroupedBarGeometry(10, 70, 2, 3, 3);

    expect(first.width).toBe(17);
    expect(second.x).toBe(31.5);
    expect(third.x + third.width).toBeLessThanOrEqual(70);
  });

  it('selects the series point with the smallest two-dimensional pointer distance', () => {
    const points = [
      { seriesId: 'bar', binIndex: 0, x: 45, y: 90 },
      { seriesId: 'solid-line', binIndex: 0, x: 52, y: 22 },
      { seriesId: 'dashed-line', binIndex: 0, x: 65, y: 35 }
    ];

    expect(getClosestMixedHoverPoint(50, 20, points)?.seriesId).toBe('solid-line');
    expect(getClosestMixedHoverPoint(46, 86, points)?.seriesId).toBe('bar');
  });

  it('uses rendered stacking order when points are exactly tied', () => {
    const closest = getClosestMixedHoverPoint(20, 20, [
      { seriesId: 'bar', binIndex: 0, x: 20, y: 20 },
      { seriesId: 'line', binIndex: 0, x: 20, y: 20 }
    ]);

    expect(closest?.seriesId).toBe('line');
  });

  it('returns every overlapping point at the closest rendered coordinate', () => {
    const closest = getClosestMixedHoverPoints(20, 20, [
      { seriesId: 'bar', binIndex: 0, x: 20, y: 20 },
      { seriesId: 'solid-line', binIndex: 0, x: 20, y: 20 },
      { seriesId: 'dashed-line', binIndex: 0, x: 40, y: 40 }
    ]);

    expect(closest.map(point => point.seriesId)).toEqual(['bar', 'solid-line']);
  });

  it('pre-groups visually overlapping points while preserving their render order', () => {
    const groups = groupMixedHoverPoints([
      { seriesId: 'bar', binIndex: 0, x: 20, y: 20 },
      { seriesId: 'solid-line', binIndex: 0, x: 20.25, y: 19.75 },
      { seriesId: 'dashed-line', binIndex: 0, x: 40, y: 40 }
    ]);

    expect(groups).toHaveSize(2);
    expect(groups[0].points.map(point => point.seriesId)).toEqual(['bar', 'solid-line']);
    expect(groups[0].x).toBeCloseTo(20.125);
    expect(groups[0].y).toBeCloseTo(19.875);
  });

  it('does not combine equally distant points when their rendered coordinates do not overlap', () => {
    const closest = getClosestMixedHoverPoints(20, 20, [
      { seriesId: 'left', binIndex: 0, x: 15, y: 20 },
      { seriesId: 'right', binIndex: 0, x: 25, y: 20 }
    ]);

    expect(closest.map(point => point.seriesId)).toEqual(['right']);
  });

  it('ignores invalid hover coordinates and returns no point when none can be compared', () => {
    expect(getClosestMixedHoverPoint(Number.NaN, 10, [])).toBeNull();
    expect(getClosestMixedHoverPoint(10, 10, [
      { seriesId: 'invalid', binIndex: 0, x: Number.NaN, y: 5 }
    ])).toBeNull();
    expect(getClosestMixedHoverPoints(Number.NaN, 10, [])).toEqual([]);
  });

  it('does not select a hover group beyond the interaction radius', () => {
    const points = [{ seriesId: 'line', binIndex: 0, x: 50, y: 50 }];

    expect(getClosestMixedHoverPoints(10, 10, points, 32)).toEqual([]);
    expect(getClosestMixedHoverPoints(30, 30, points, 32)).toEqual(points);
  });
});
