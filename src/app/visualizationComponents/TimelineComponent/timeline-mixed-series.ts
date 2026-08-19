import moment from 'moment';

export type EpiMixedSeriesMark = 'bar' | 'solid-line' | 'dashed-line';
export type EpiMixedValueMode = 'count' | 'sum';

export interface EpiMixedSeriesConfig {
  id: string;
  dateField: string;
  valueMode: EpiMixedValueMode;
  valueField: string;
  mark: EpiMixedSeriesMark;
  color: string;
  label: string;
}

export interface EpiMixedFigureText {
  title: string;
  subtitle: string;
  xAxisLabel: string;
  leftAxisLabel: string;
  rightAxisLabel: string;
  footnote: string;
}

export interface EpiMixedAnnotationConfig {
  id: string;
  date: string;
  text: string;
  labelXRatio: number;
  labelYRatio: number;
}

export interface EpiMixedConfig {
  version: 1;
  series: EpiMixedSeriesConfig[];
  figureText: EpiMixedFigureText;
  annotations: EpiMixedAnnotationConfig[];
}

export interface EpiMixedBinInterval {
  x0: Date;
  x1: Date;
}

export interface EpiMixedBinDatum extends EpiMixedBinInterval {
  value: number;
  cumulativeValue: number;
}

export interface EpiMixedAggregationResult {
  bins: EpiMixedBinDatum[];
  includedRecords: number;
}

export interface EpiMixedBarGeometry {
  x: number;
  width: number;
}

const DEFAULT_MARKS: EpiMixedSeriesMark[] = ['bar', 'solid-line', 'dashed-line'];
const DEFAULT_COLORS = ['#8EB8DC', '#005EB8', '#4D77A5'];

function clampRatio(value: unknown, fallback: number): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(1, Math.max(0, numericValue));
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function toFiniteMixedValue(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return null;
  }

  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function parseMixedDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  }

  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }

  if (typeof value === 'number') {
    const parsedNumber = moment(value);
    return parsedNumber.isValid() ? parsedNumber.toDate() : null;
  }

  const parsed = moment(String(value).trim(), [
    moment.ISO_8601,
    'M/D/YYYY',
    'M/D/YYYY H:mm',
    'M/D/YYYY h:mm A',
    'YYYY/M/D',
    'MMM D, YYYY',
    'MMMM D, YYYY'
  ], true);
  return parsed.isValid() ? parsed.toDate() : null;
}

export function createDefaultMixedConfig(
  dateFields: unknown[] = [],
  colors: unknown[] = []
): EpiMixedConfig {
  const series = DEFAULT_MARKS.map((mark, index) => ({
    id: `mixed-series-${index + 1}`,
    dateField: asString(dateFields[index], 'None'),
    valueMode: 'count' as EpiMixedValueMode,
    valueField: 'None',
    mark,
    color: asString(colors[index], DEFAULT_COLORS[index]),
    label: ''
  }));

  return {
    version: 1,
    series,
    figureText: {
      title: '',
      subtitle: '',
      xAxisLabel: '',
      leftAxisLabel: '',
      rightAxisLabel: '',
      footnote: ''
    },
    annotations: []
  };
}

export function normalizeMixedConfig(
  rawConfig: any,
  dateFields: unknown[] = [],
  colors: unknown[] = []
): EpiMixedConfig {
  const defaults = createDefaultMixedConfig(dateFields, colors);
  if (!rawConfig || typeof rawConfig !== 'object') {
    return defaults;
  }

  const rawSeries = Array.isArray(rawConfig.series) ? rawConfig.series : [];
  const series = defaults.series.map((defaultSeries, index) => {
    const candidate = rawSeries[index] || {};
    const mark = DEFAULT_MARKS.includes(candidate.mark) ? candidate.mark : defaultSeries.mark;
    const valueMode: EpiMixedValueMode = candidate.valueMode === 'sum' ? 'sum' : 'count';

    return {
      id: asString(candidate.id, defaultSeries.id),
      dateField: asString(candidate.dateField, defaultSeries.dateField),
      valueMode,
      valueField: asString(candidate.valueField, 'None'),
      mark,
      color: asString(candidate.color, defaultSeries.color),
      label: asString(candidate.label)
    };
  });

  const rawFigureText = rawConfig.figureText || {};
  const figureText: EpiMixedFigureText = {
    title: asString(rawFigureText.title),
    subtitle: asString(rawFigureText.subtitle),
    xAxisLabel: asString(rawFigureText.xAxisLabel),
    leftAxisLabel: asString(rawFigureText.leftAxisLabel),
    rightAxisLabel: asString(rawFigureText.rightAxisLabel),
    footnote: asString(rawFigureText.footnote)
  };

  const annotations = (Array.isArray(rawConfig.annotations) ? rawConfig.annotations : [])
    .map((annotation, index): EpiMixedAnnotationConfig => ({
      id: asString(annotation?.id, `mixed-annotation-${index + 1}`),
      date: asString(annotation?.date),
      text: asString(annotation?.text),
      labelXRatio: clampRatio(annotation?.labelXRatio, 0.18 + index * 0.24),
      labelYRatio: clampRatio(annotation?.labelYRatio, 0.32 + (index % 2) * 0.24)
    }));

  return {
    version: 1,
    series,
    figureText,
    annotations
  };
}

export function getNumericMixedFields(
  records: any[],
  fields: string[]
): string[] {
  return fields.filter(field => records.some(record => toFiniteMixedValue(record?.[field]) !== null));
}

export function getMixedDateExtent(
  records: any[],
  series: EpiMixedSeriesConfig[]
): [Date, Date] | null {
  const timestamps: number[] = [];
  const activeDateFields = series
    .map(item => item.dateField)
    .filter(field => field && field !== 'None');

  records.forEach(record => {
    activeDateFields.forEach(field => {
      const date = parseMixedDate(record?.[field]);
      if (date) {
        timestamps.push(date.getTime());
      }
    });
  });

  if (timestamps.length === 0) {
    return null;
  }

  return [new Date(Math.min(...timestamps)), new Date(Math.max(...timestamps))];
}

export function aggregateMixedSeries(
  records: any[],
  config: EpiMixedSeriesConfig,
  intervals: EpiMixedBinInterval[]
): EpiMixedAggregationResult {
  const values = intervals.map(() => 0);
  let includedRecords = 0;

  records.forEach(record => {
    const date = parseMixedDate(record?.[config.dateField]);
    if (!date) {
      return;
    }

    const timestamp = date.getTime();
    const binIndex = intervals.findIndex((interval, index) => (
      timestamp >= interval.x0.getTime()
      && (timestamp < interval.x1.getTime()
        || (index === intervals.length - 1 && timestamp === interval.x1.getTime()))
    ));
    if (binIndex < 0) {
      return;
    }

    const contribution = config.valueMode === 'sum'
      ? toFiniteMixedValue(record?.[config.valueField])
      : 1;
    if (contribution === null) {
      return;
    }

    values[binIndex] += contribution;
    includedRecords += 1;
  });

  let cumulativeValue = 0;
  const bins = intervals.map((interval, index) => {
    cumulativeValue += values[index];
    return {
      x0: new Date(interval.x0.getTime()),
      x1: new Date(interval.x1.getTime()),
      value: values[index],
      cumulativeValue
    };
  });

  return { bins, includedRecords };
}

export function getZeroInclusiveDomain(values: number[]): [number, number] {
  const finiteValues = values.filter(value => Number.isFinite(value));
  if (finiteValues.length === 0) {
    return [0, 1];
  }

  const minimum = Math.min(0, ...finiteValues);
  const maximum = Math.max(0, ...finiteValues);
  if (minimum === maximum) {
    return minimum === 0 ? [0, 1] : [Math.min(0, minimum), Math.max(1, maximum)];
  }

  return [minimum, maximum];
}

export function getGroupedBarGeometry(
  binStart: number,
  binEnd: number,
  seriesIndex: number,
  seriesCount: number,
  requestedGap = 2
): EpiMixedBarGeometry {
  const safeSeriesCount = Math.max(1, Math.floor(seriesCount));
  const binWidth = Math.max(0, binEnd - binStart);
  const bandWidth = binWidth / safeSeriesCount;
  const gap = Math.min(Math.max(0, requestedGap), bandWidth * 0.35);

  return {
    x: binStart + Math.max(0, seriesIndex) * bandWidth + gap / 2,
    width: Math.max(0, bandWidth - gap)
  };
}
