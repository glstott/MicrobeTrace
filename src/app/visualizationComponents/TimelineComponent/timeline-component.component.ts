import { Component, ElementRef, EventEmitter, ChangeDetectorRef, Inject, OnInit, Output, ViewChild, OnDestroy } from '@angular/core';
import { CommonService } from '../../contactTraceCommonServices/common.service';
import { BaseComponentDirective } from '@app/base-component.directive';
import { MicobeTraceNextPluginEvents } from '@app/helperClasses/interfaces';
import { ComponentContainer } from 'golden-layout';
import * as d3 from 'd3';
import moment from 'moment';
import { MicrobeTraceNextVisuals } from '@app/microbe-trace-next-plugin-visuals';

import { saveAs } from 'file-saver';
import { saveSvgAsPng } from 'save-svg-as-png';
import { SelectItem } from 'primeng/api';
import { GoogleTagManagerService } from 'angular-google-tag-manager';
import { ExportService } from '@app/contactTraceCommonServices/export.service';
import { Subject, takeUntil } from 'rxjs';
import { CommonStoreService } from '@app/contactTraceCommonServices/common-store.services';
import {
  EpiMixedAnnotationConfig,
  EpiMixedBinDatum,
  EpiMixedBinInterval,
  EpiMixedConfig,
  EpiMixedHoverGroup,
  EpiMixedHoverPoint,
  EpiMixedSeriesConfig,
  aggregateMixedSeries,
  getGroupedBarGeometry,
  getMixedDateExtent,
  getNumericMixedFields,
  getZeroInclusiveDomain,
  groupMixedHoverPoints,
  normalizeMixedConfig,
  parseMixedDate,
  toFiniteMixedValue
} from './timeline-mixed-series';

interface EpiMixedRenderedSeries {
  config: EpiMixedSeriesConfig;
  label: string;
  bins: EpiMixedBinDatum[];
}

@Component({
    selector: 'app-timeline-component',
    templateUrl: './timeline-component.component.html',
    styleUrls: ['./timeline-component.component.scss'],
    standalone: false
})
export class TimelineComponent extends BaseComponentDirective implements OnInit, MicobeTraceNextPluginEvents, OnDestroy {

  @Output() DisplayGlobalSettingsDialogEvent = new EventEmitter();
  private destroy$ = new Subject<void>();
  private isDestroyed = false;
  @ViewChild('epiCurve') epiCurveElement: ElementRef;
  @ViewChild('epiCurveSVG') epiCurveSVGElement: ElementRef;
  @ViewChild('mixedTooltip') mixedTooltipElement: ElementRef;
  viewActive: boolean = true;

  widgets: object;
  private visuals: MicrobeTraceNextVisuals;

  FieldList: SelectItem[] = [];
  FieldListStack: SelectItem[] = [];
  NumericFieldList: SelectItem[] = [];
  SelectedDateFieldVariable;
  SelectedDateFieldVariable2;
  SelectedDateFieldVariable3;
  binSizes = ['Day', 'Week', 'Month', 'Quarter', 'Year']
  tickInterval;
  labelSize = 12;
  legendLabelSize = 15;

  readonly mixedGraphType = 'Mixed: Bars + Lines';
  private readonly mixedHoverRadius = 32;
  graphTypes = ['Single Date Field', 'Multi: Side by Side', 'Multi: Overlay', this.mixedGraphType]
  selectedGraphType = 'Single Date Field';
  mixedConfig: EpiMixedConfig;
  mixedSeriesErrors: string[] = ['', '', ''];
  mixedAnnotationErrors: { [id: string]: string } = {};
  mixedDomainStartInput = '';
  mixedDomainEndInput = '';
  readonly mixedMarkOptions: SelectItem[] = [
    { label: 'Bars', value: 'bar' },
    { label: 'Solid line', value: 'solid-line' },
    { label: 'Dashed line', value: 'dashed-line' }
  ];
  readonly mixedValueModeOptions: SelectItem[] = [
    { label: 'Count records', value: 'count' },
    { label: 'Sum a field', value: 'sum' }
  ];
  legendPositionOptions = ['Hide', 'Left', 'Right', 'Bottom']
  stackOrderOptions = ['Largest at Bottom', 'Smallest at Bottom', 'Custom']
  customStackOrderItems = [];

  ShowEpiSettingsPane: boolean = false;
  ShowEpiExportPane: boolean = false;
  EpiExportFileName: string = "";
  EpiExportFileType: string = "png";
  SelectedNetworkExportScaleVariable: any = 1;
  SelectedNetworkExportQualityVariable: any = 0.92;
  CalculatedResolution: string;

  private localColorMap: any = (x) => undefined;

  private svg;
  private margin = { top: 5, left: 45, right: 20, bottom: 50 };
  private width; // Default width, adjust as necessary
  private height; // Default height, adjust as necessary
  private middle;
  private x;
  private y;
  private histogram;
  private brush;
  private brushG;
  private selection;
  private timer;
  private tick = 0;
  private isPlaying = false;

  private vnodes = []; // Replace with your actual data
  private timeDomainStart;
  private timeDomainEnd;
  private mixedAnnotationSequence = 0;

  private markEpiCurveRendered(): void {
    if (!this.viewActive) return;

    // Epi Curve can be the first rendered view on launch, so it must release
    // the shared processing modal without depending on the 2D render path.
    setTimeout(() => {
      this.store.setNetworkRendered(true);
    });
  }

  constructor(
    private commonService: CommonService,
    @Inject(BaseComponentDirective.GoldenLayoutContainerInjectionToken) private container: ComponentContainer,
    elRef: ElementRef,
    private cdref: ChangeDetectorRef,
    private gtmService: GoogleTagManagerService,
    private store: CommonStoreService,
    private exportService: ExportService) {

      super(elRef.nativeElement);
      this.visuals = commonService.visuals;
      this.commonService.visuals.epiCurve = this;
      this.widgets = this.commonService.session.style.widgets;

      this.setDefaultsWidgets();

  }

  private updateFieldLists(): void {
    this.FieldList = [];
    this.FieldListStack = [];
    this.FieldList.push({ label: "None", value: "None" });
    this.FieldListStack.push({ label: "None", value: 'None'}, { label: "Node Color", value: "Node Color"});

    const nodeFields = this.commonService.session.data['nodeFields'] || [];
    nodeFields.forEach((d) => {
        if (d != 'seq' && d != 'sequence') {
            this.FieldList.push(
                {
                    label: this.commonService.capitalize(d.replace("_", "")),
                    value: d
                });
            this.FieldListStack.push(
                {
                    label: this.commonService.capitalize(d.replace("_", "")),
                    value: d
                });
        }
    });

    const records = this.commonService.session.data.nodes || [];
    this.NumericFieldList = [
      { label: 'None', value: 'None' },
      ...getNumericMixedFields(records, nodeFields)
        .filter(field => field != 'seq' && field != 'sequence')
        .map(field => ({
          label: this.commonService.capitalize(field.replace(/_/g, ' ')),
          value: field
        }))
    ];
  }

  ngOnInit() {

    this.gtmService.pushTag({
            event: "page_view",
            page_location: "/timeline",
            page_title: "Timeline View"
        });
    // populate this.twoD.FieldList with [None, ...nodeFields]
    this.updateFieldLists();

    this.tickInterval = 1;
    this.updateSettingsRows();    

    this.store.clusterUpdate$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      if (this.selectedGraphType == "Single Date Field" && (this.widgets['epiCurve-stackColorBy'] == 'cluster' || (this.widgets['epiCurve-stackColorBy'] == 'Node Color' && this.widgets['node-color-variable'] == 'cluster'))) {
        this.refresh();
      }
    })
 }
  
  ngOnDestroy(): void {
    this.isDestroyed = true;
    this.destroy$.next();
    this.destroy$.complete();
  }

  setDefaultsWidgets() {
    // graphType
    if (this.widgets['epiCurve-graphType'] == undefined) {
      this.widgets['epiCurve-graphType'] = 'Single Date Field';
    }
    this.selectedGraphType = this.widgets['epiCurve-graphType'];

    // date fields
    if (this.widgets['epiCurve-date-fields'] == undefined) {
      if (this.widgets['epi-timeline-date-field'] != undefined) {
        this.widgets['epiCurve-date-fields'] = [this.widgets['epi-timeline-date-field'], 'None', 'None']
      } else {
        this.widgets['epiCurve-date-fields'] = ['None', 'None', 'None']
      }
    } else if (this.widgets['epiCurve-date-fields'].length < 3) {
      while (this.widgets['epiCurve-date-fields']< 3) {
        this.widgets['epiCurve-date-fields'].push('None')
      }
    }
    this.SelectedDateFieldVariable = this.widgets['epiCurve-date-fields'][0];
    this.SelectedDateFieldVariable2 = this.widgets['epiCurve-date-fields'][1];
    this.SelectedDateFieldVariable3 = this.widgets['epiCurve-date-fields'][2];

    // colors
    if (this.widgets['epiCurve-colors'] == undefined) {
      this.widgets['epiCurve-colors'] = ['#C6D8EB','#B79ECC', '#F3BF79'];
    }

    // stackColorBy field
    if (this.widgets['epiCurve-stackColorBy'] == undefined) {
      this.widgets['epiCurve-stackColorBy'] = 'None';
    }

    // stack order
    if (this.widgets['epiCurve-stackOrder'] == undefined) {
      this.widgets['epiCurve-stackOrder'] = 'Largest at Bottom';
    }
    if (this.widgets['epiCurve-customStackOrder'] == undefined) {
      this.widgets['epiCurve-customStackOrder'] = [];
    }
    if (this.widgets['epiCurve-stackGroupColors'] == undefined) {
      this.widgets['epiCurve-stackGroupColors'] = {};
    }
    if (this.widgets['epiCurve-stackGroupTransparencies'] == undefined) {
      this.widgets['epiCurve-stackGroupTransparencies'] = {};
    }

    // binSize
    if (this.widgets['epiCurve-binSize'] == undefined) {
      this.widgets['epiCurve-binSize'] = 'Month'
    }

    //
    if (this.widgets['epiCurve-cumulative'] == undefined) {
      this.widgets['epiCurve-cumulative'] = false;
    }

    // legendPosition
    if (this.widgets['epiCurve-legendPosition'] == undefined) {
      this.widgets['epiCurve-legendPosition'] = 'Left';
    }

    this.widgets['epiCurve-mixedConfig'] = normalizeMixedConfig(
      this.widgets['epiCurve-mixedConfig'],
      this.widgets['epiCurve-date-fields'],
      this.widgets['epiCurve-colors']
    );
    this.mixedConfig = this.widgets['epiCurve-mixedConfig'];
 }

 ngAfterViewInit() {

  // this.initializeD3Chart();
  this.setupEventListeners();
  this.refresh();
  this.markEpiCurveRendered();
 }
  
/**
 * Clears previous histogram/epi curve and creates a new one; calls refreshMulti if needed
 */
public refresh(): void {
  if (this.isMixedGraphType()) {
    this.refreshMixed();
    return;
  }

  if (this.selectedGraphType=='Multi: Overlay' || this.selectedGraphType=='Multi: Side by Side') {
    this.refreshMulti();
    return;
  }

  $('#epiCurveSVG').empty()

  if (this.SelectedDateFieldVariable == 'None') {
    return;
  }

  this.updateSizes();
  if (this.height < 0) {
    return;
  }

  const field = this.SelectedDateFieldVariable;
  let times = this.getTimes([field]);

  // updates this.timeDomainStart and this.timeDomainInterval and returns the bin interval
  let binInterval = this.calculateBinInterval(times);
  if (binInterval == 0) {
    return;
  }

  this.x = d3.scaleTime().domain([this.timeDomainStart, this.timeDomainEnd]).rangeRound([0, this.width]);
  this.y = d3.scaleLinear().range([this.height, 0]);

  //@ts-ignore
  this.histogram = d3.histogram().value(d => d[field as string]).domain(this.x.domain()).thresholds(binInterval);

  this.svg = d3.select(this.epiCurveSVGElement.nativeElement)
    .attr("width", this.width + this.margin.left + this.margin.right)
    .attr("height", this.height + this.margin.top + this.margin.bottom)
    //.attr("transform", `translate(0, ${this.margin.top})`);
    

  const epiCurve = this.svg.append("g")
    .classed("epiCurve-epi-curve", true)
    .attr("transform", `translate(${this.margin.left}, ${this.margin.top})`);

  let bins = this.histogram(this.vnodes);
  
  let colorVariable = this.commonService.session.style.widgets['node-color-variable'];
  let nodeColorKeys;
  if (colorVariable != 'None' && this.widgets['epiCurve-stackColorBy'] == 'Node Color') {
    nodeColorKeys = this.commonService.session.style.nodeColorsTableKeys[colorVariable].map(value => value=='null' ? null: value);
    this.localColorMap = this.commonService.temp.style.nodeColorMap;
  } else if (this.widgets['epiCurve-stackColorBy'] != 'None') {
    nodeColorKeys = this.updateLocalColorMap();
  }
  if (nodeColorKeys) {
    nodeColorKeys = this.getOrderedStackKeys(nodeColorKeys, this.widgets['epiCurve-stackColorBy'] == 'Node Color' ? colorVariable : this.widgets['epiCurve-stackColorBy']);
  }

  let maxCount = 0;
  [maxCount, bins] = this.updateBins(bins, this.widgets['epiCurve-stackColorBy'] == 'Node Color' ? colorVariable : this.widgets['epiCurve-stackColorBy'], nodeColorKeys);
  

  this.y.domain([0, maxCount]).nice()//d3.max(bins, d => d.length)]);

  if ((colorVariable != 'None' && this.widgets['epiCurve-stackColorBy'] == 'Node Color') || (this.widgets['epiCurve-stackColorBy'] != 'None' && this.widgets['epiCurve-stackColorBy'] != 'Node Color')) {
    let nodeColors = [];
    let nodeOpacities = [];

    nodeColorKeys.forEach((value, ind) =>{
      const fill = this.getStackFill(value);
      const opacity = this.getStackOpacity(value);
      const rects = epiCurve.selectAll(`rect${ind}`)
      .data(bins)
      .enter()
      .append("rect")
      .attr("transform", d => `translate(${this.x(d.x0)}, ${this.y(d.height[ind])})`)
      .attr("width", d => this.x(d.x1) - this.x(d.x0))
      .attr("height", d => this.height - this.y(d.length2[ind]))
      .attr("fill", fill)
      .attr("opacity", opacity)
      .attr("stroke", "black" );

      rects.append("title")
        .text(d => this.getSingleBinTooltip(d, field, value, this.getSegmentCount(d, ind)))

      nodeColors.push(fill);
      nodeOpacities.push(opacity);
    })
    this.generateLegend(epiCurve, nodeColors, nodeColorKeys, nodeOpacities)
  } else {
    let color = this.widgets['epiCurve-stackColorBy'] == 'None' ? this.widgets['epiCurve-colors'][0] : this.widgets["node-color"];
    const rects = epiCurve.selectAll("rect")
      .data(bins)
      .enter()
      .append("rect")
      .attr("transform", d => `translate(${this.x(d.x0)}, ${this.y(d.length)})`)
      .attr("width", d => this.x(d.x1) - this.x(d.x0))
      .attr("height", d => this.height - this.y(d.length))
      .attr("fill", color)
      .attr("stroke", "black");

    rects.append("title")
      .text(d => this.getSingleBinTooltip(d, field));

    this.generateLegend(epiCurve, [color] ,[this.SelectedDateFieldVariable])
  }

  this.updateAxes();
} 

/**
 * Updated version of refresh that works for multiple date fields to generate the epi curve graph
 * Calls refresh() instead if needed
 */
private refreshMulti(): void {
  if (this.selectedGraphType=='Single Date Field') {
    this.refresh();
    return;
  }

  $('#epiCurveSVG').empty()

  if (this.SelectedDateFieldVariable == 'None' && this.SelectedDateFieldVariable2 == 'None' && this.SelectedDateFieldVariable3 == 'None') {
    return;
  }

  this.updateSizes();
  if (this.height < 0) {
    return;
  }

  let fields = [];
  let colors = [];
  [this.SelectedDateFieldVariable, this.SelectedDateFieldVariable2, this.SelectedDateFieldVariable3].forEach((dateField, ind) => {
    if (dateField != 'None') {
      fields.push(dateField);
      colors.push(this.widgets["epiCurve-colors"][ind])
    }
  })

  if (fields.length == 0) {
    return;
  }
  // current implementation of times is only used to calculate min and max time of all data given when setting up x axis and bins; there isn't a current need to link times by datapoint with times
  let times = this.getTimes(fields);

  // updates this.timeDomainStart and this.timeDomainInterval and returns the bin interval
  let binInterval = this.calculateBinInterval(times);
  if (binInterval == 0) {
    return;
  }

  this.x = d3.scaleTime().domain([this.timeDomainStart, this.timeDomainEnd]).rangeRound([0, this.width]);
  this.y = d3.scaleLinear().range([this.height, 0]);

  //@ts-ignore
  this.histogram = d3.histogram().domain(this.x.domain()).thresholds(binInterval);

  this.svg = d3.select(this.epiCurveSVGElement.nativeElement)
    .attr("width", this.width + this.margin.left + this.margin.right)
    .attr("height", this.height + this.margin.top + this.margin.bottom);
    

  const epiCurve = this.svg.append("g")
    .classed("epiCurve-epi-curve", true)
    .attr("transform", `translate(${this.margin.left}, ${this.margin.top})`);

  let maxCount = 0;
  let bins = [];
  fields.forEach((field) => {
    if (field != 'None') {
      let currentCount = 0;
      let currentbin = this.histogram(this.vnodes.map((d) => d[field]).filter(value => value != null));
      [currentCount, currentbin] = this.updateBins(currentbin);
      bins.push(currentbin)
      if (currentCount > maxCount) maxCount = currentCount;
    }
  })

  this.y.domain([0, maxCount]).nice();

  if (this.selectedGraphType == 'Multi: Overlay') {
    fields.forEach((_, ind) => {
        const rects = epiCurve.selectAll(`rect${ind}`)
        .data(bins[ind])
        .enter()
        .append("rect")
        .attr("transform", d => `translate(${this.x(d.x0)}, ${this.y(d.length)})`)
        .attr("width", d => this.x(d.x1) - this.x(d.x0))
        .attr("height", d => this.height - this.y(d.length))
        .attr("fill", colors[ind])
        .attr("opacity", 0.6);

        rects.append("title")
          .text((_, binIndex) => this.getMultiBinTooltip(fields, bins, binIndex));
    })

  } else {
    let numberOfBins = fields.length;
    let width;
    let xOffset = [];
    if (numberOfBins == 1) {
      width = (d) => this.x(d.x1)- this.x(d.x0);
      xOffset = [
        function(d, c) {return c.x(d.x0)}
      ]
    } else if (numberOfBins == 2) {
      width = (d) => (this.x(d.x1)- this.x(d.x0))/2
      xOffset = [
        function(d, c) {return c.x(d.x0)},
        function(d, c) {return c.x(d.x0)+(c.x(d.x1) - c.x(d.x0))/2}
      ]
    } else {
      width = (d) => (this.x(d.x1)- this.x(d.x0))/3;
      xOffset = [
        function(d, c) { return c.x(d.x0)},
        function(d, c) { return c.x(d.x0)+(c.x(d.x1) - c.x(d.x0))/3},
        function(d, c) { return c.x(d.x0)+2*(c.x(d.x1) - c.x(d.x0))/3}
      ]
    }
    
    let that = this;

    fields.forEach((_, ind) => {
        const rects = epiCurve.selectAll(`rect${ind}`)
        .data(bins[ind])
        .enter()
        .append("rect")
        .attr("transform", d => `translate(${xOffset[ind](d, that)}, ${this.y(d.length)})`)
        .attr("width", width)
        .attr("height", d => this.height - this.y(d.length))
        .attr("fill", colors[ind])
        .attr("stroke", "black" );

        rects.append("title")
          .text((_, binIndex) => this.getMultiBinTooltip(fields, bins, binIndex));
    });
  }

  this.updateAxes();
  this.generateLegend(epiCurve, colors, fields)
} 

isMixedGraphType(): boolean {
  return this.selectedGraphType === this.mixedGraphType;
}

private refreshMixed(): void {
  d3.select(this.epiCurveSVGElement.nativeElement).selectAll('*').remove();
  this.hideMixedTooltip();
  this.updateMixedSizes();

  this.svg = d3.select(this.epiCurveSVGElement.nativeElement)
    .attr('width', Math.max(0, this.width + this.margin.left + this.margin.right))
    .attr('height', Math.max(0, this.height + this.margin.top + this.margin.bottom));

  this.svg.append('rect')
    .attr('class', 'epi-mixed-background')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('fill', '#ffffff');

  this.renderMixedFigureText();

  if (this.width < 160 || this.height < 100) {
    this.renderMixedEmptyState('Increase the Epi Curve panel size to display this chart.');
    return;
  }

  const records = this.commonService.session.data.nodes || [];
  this.mixedSeriesErrors = this.mixedConfig.series.map(series => this.validateMixedSeries(series, records));
  const validSeries = this.mixedConfig.series.filter((series, index) => (
    series.dateField !== 'None' && !this.mixedSeriesErrors[index]
  ));

  if (validSeries.length === 0) {
    this.mixedDomainStartInput = '';
    this.mixedDomainEndInput = '';
    this.mixedAnnotationErrors = {};
    this.renderMixedEmptyState('Choose at least one valid date series in Settings.');
    return;
  }

  const extent = getMixedDateExtent(records, validSeries);
  if (!extent) {
    this.renderMixedEmptyState('No valid dates were found for the configured series.');
    return;
  }

  const intervals = this.createMixedIntervals(extent);
  if (intervals.length === 0) {
    this.renderMixedEmptyState('The selected date range could not be binned.');
    return;
  }

  this.timeDomainStart = intervals[0].x0;
  this.timeDomainEnd = intervals[intervals.length - 1].x1;
  this.mixedDomainStartInput = moment(this.timeDomainStart).format('YYYY-MM-DD');
  this.mixedDomainEndInput = moment(this.timeDomainEnd).format('YYYY-MM-DD');
  this.x = d3.scaleTime()
    .domain([this.timeDomainStart, this.timeDomainEnd])
    .range([0, this.width]);

  const renderedSeries: EpiMixedRenderedSeries[] = validSeries.map(config => ({
    config,
    label: this.getMixedSeriesLabel(config),
    bins: aggregateMixedSeries(records, config, intervals).bins
  }));

  const lineSeries = renderedSeries.filter(series => series.config.mark !== 'bar');
  const barSeries = renderedSeries.filter(series => series.config.mark === 'bar');
  const leftValues = lineSeries.flatMap(series => series.bins.map(bin => bin.cumulativeValue));
  const rightValues = barSeries.flatMap(series => series.bins.map(bin => bin.value));
  const leftScale = lineSeries.length > 0
    ? d3.scaleLinear().domain(getZeroInclusiveDomain(leftValues)).nice().range([this.height, 0])
    : null;
  const rightScale = barSeries.length > 0
    ? d3.scaleLinear().domain(getZeroInclusiveDomain(rightValues)).nice().range([this.height, 0])
    : null;
  this.y = leftScale || rightScale;

  const plot: any = this.svg.append('g')
    .classed('epiCurve-epi-curve epi-mixed-plot', true)
    .attr('transform', `translate(${this.margin.left}, ${this.margin.top})`);

  this.renderMixedAxes(plot, leftScale, rightScale, lineSeries.length > 0, barSeries.length > 0);
  this.renderMixedBars(plot, barSeries, rightScale);
  this.renderMixedLines(plot, lineSeries, leftScale);
  this.renderMixedLegend(plot, renderedSeries);
  this.renderMixedTooltipTargets(plot, renderedSeries, leftScale, rightScale);
  this.renderMixedAnnotations(plot);
}

private validateMixedSeries(series: EpiMixedSeriesConfig, records: any[]): string {
  if (!series || series.dateField === 'None') {
    return '';
  }

  const nodeFields = this.commonService.session.data.nodeFields || [];
  if (!nodeFields.includes(series.dateField)) {
    return 'The selected date field is not available in this dataset.';
  }

  const hasValidDate = records.some(record => parseMixedDate(record?.[series.dateField]) !== null);
  if (!hasValidDate) {
    return 'No valid dates were found in this field.';
  }

  if (series.valueMode === 'sum') {
    if (!series.valueField || series.valueField === 'None') {
      return 'Choose a numeric field to sum.';
    }
    if (!nodeFields.includes(series.valueField)) {
      return 'The selected value field is not available in this dataset.';
    }

    const hasValidPair = records.some(record => (
      parseMixedDate(record?.[series.dateField]) !== null
      && toFiniteMixedValue(record?.[series.valueField]) !== null
    ));
    if (!hasValidPair) {
      return 'No records contain both a valid date and numeric value.';
    }
  }

  return '';
}

private createMixedIntervals(extent: [Date, Date]): EpiMixedBinInterval[] {
  const minimum = extent[0];
  const maximum = extent[1];
  let start: Date;
  let end: Date;
  let starts: Date[];

  if (this.widgets['epiCurve-binSize'] === 'Day') {
    start = d3.timeDay.floor(minimum);
    end = d3.timeDay.ceil(maximum);
    if (end.getTime() <= maximum.getTime()) end = d3.timeDay.offset(end, 1);
    starts = d3.timeDay.range(start, end);
  } else if (this.widgets['epiCurve-binSize'] === 'Week') {
    start = d3.timeMonday.floor(minimum);
    end = d3.timeMonday.ceil(maximum);
    if (end.getTime() <= maximum.getTime()) end = d3.timeMonday.offset(end, 1);
    starts = d3.timeMonday.range(start, end);
  } else if (this.widgets['epiCurve-binSize'] === 'Quarter') {
    start = new Date(minimum.getFullYear(), Math.floor(minimum.getMonth() / 3) * 3, 1);
    end = new Date(maximum.getFullYear(), Math.floor(maximum.getMonth() / 3) * 3 + 3, 1);
    starts = d3.timeMonth.range(start, end, 3);
  } else if (this.widgets['epiCurve-binSize'] === 'Year') {
    start = d3.timeYear.floor(minimum);
    end = d3.timeYear.ceil(maximum);
    if (end.getTime() <= maximum.getTime()) end = d3.timeYear.offset(end, 1);
    starts = d3.timeYear.range(start, end);
  } else {
    start = d3.timeMonth.floor(minimum);
    end = d3.timeMonth.ceil(maximum);
    if (end.getTime() <= maximum.getTime()) end = d3.timeMonth.offset(end, 1);
    starts = d3.timeMonth.range(start, end);
  }

  if (starts.length === 0) {
    starts = [start];
  }

  return starts.map((x0, index) => ({
    x0,
    x1: starts[index + 1] || end
  }));
}

private updateMixedSizes(): void {
  const wrapper = $(this.epiCurveElement.nativeElement).parent();
  const figureText = this.mixedConfig.figureText;
  const titleHeight = figureText.title.trim() ? 34 : 0;
  const subtitleHeight = figureText.subtitle.trim() ? 24 : 0;
  const footnoteHeight = figureText.footnote.trim() ? 30 : 0;
  const bottomLegendHeight = this.widgets['epiCurve-legendPosition'] === 'Bottom' ? 42 : 0;

  this.margin.top = 16 + titleHeight + subtitleHeight;
  this.margin.left = Math.max(70, Math.round(this.labelSize * 4.8));
  this.margin.right = Math.max(70, Math.round(this.labelSize * 4.8));
  this.margin.bottom = 58 + footnoteHeight + bottomLegendHeight;
  $('#epiCurve').height(wrapper.height() - 50);
  this.width = wrapper.width() - this.margin.left - this.margin.right;
  this.height = wrapper.height() - this.margin.top - this.margin.bottom - 50;
  this.middle = this.height / 2;
}

private renderMixedFigureText(): void {
  const figureText = this.mixedConfig.figureText;
  let y = 22;

  if (figureText.title.trim()) {
    const title = this.svg.append('text')
      .attr('class', 'epi-mixed-title')
      .attr('x', 18)
      .attr('y', y)
      .attr('font-size', 18)
      .attr('font-weight', 700);
    const lines = this.appendWrappedSvgText(title, figureText.title, Math.max(120, this.width + this.margin.left + this.margin.right - 36), 21);
    y += Math.max(1, lines) * 21 + 4;
  }

  if (figureText.subtitle.trim()) {
    const subtitle = this.svg.append('text')
      .attr('class', 'epi-mixed-subtitle')
      .attr('x', 18)
      .attr('y', y)
      .attr('font-size', 13)
      .attr('font-weight', 500);
    this.appendWrappedSvgText(subtitle, figureText.subtitle, Math.max(120, this.width + this.margin.left + this.margin.right - 36), 17);
  }

  if (figureText.footnote.trim()) {
    const footnote = this.svg.append('text')
      .attr('class', 'epi-mixed-footnote')
      .attr('x', 18)
      .attr('y', this.margin.top + this.height + this.margin.bottom - 10)
      .attr('font-size', 12)
      .attr('font-weight', 500);
    this.appendWrappedSvgText(footnote, figureText.footnote, Math.max(120, this.width + this.margin.left + this.margin.right - 36), 15);
  }
}

private renderMixedEmptyState(message: string): void {
  this.svg.append('text')
    .attr('class', 'epi-mixed-empty-state')
    .attr('x', Math.max(0, (this.width + this.margin.left + this.margin.right) / 2))
    .attr('y', Math.max(44, this.margin.top + Math.max(0, this.height) / 2))
    .attr('text-anchor', 'middle')
    .attr('font-size', 14)
    .attr('fill', '#5f6772')
    .text(message);
}

private renderMixedAxes(
  plot: any,
  leftScale: any,
  rightScale: any,
  showLeftAxis: boolean,
  showRightAxis: boolean
): void {
  plot.append('line')
    .attr('class', 'epi-mixed-plot-top')
    .attr('x1', 0)
    .attr('x2', this.width)
    .attr('y1', 0)
    .attr('y2', 0)
    .attr('stroke', '#212529')
    .attr('stroke-width', 1);

  plot.append('g')
    .attr('class', 'axis axis--x epi-mixed-axis-x')
    .attr('transform', `translate(0, ${this.height})`)
    .call(this.configureMixedXAxis())
    .attr('font-size', this.labelSize);

  if (showLeftAxis) {
    plot.append('g')
      .attr('class', 'axis axis--y epi-mixed-axis-left')
      .call(d3.axisLeft(leftScale).ticks(8).tickFormat((value: number) => this.formatMixedNumber(value)))
      .attr('font-size', this.labelSize);
  }

  if (showRightAxis) {
    plot.append('g')
      .attr('class', 'axis axis--y epi-mixed-axis-right')
      .attr('transform', `translate(${this.width}, 0)`)
      .call(d3.axisRight(rightScale).ticks(8).tickFormat((value: number) => this.formatMixedNumber(value)))
      .attr('font-size', this.labelSize);
  }

  const xLabel = this.mixedConfig.figureText.xAxisLabel.trim()
    || `Date (${this.widgets['epiCurve-binSize'] === 'Day' ? 'Daily' : `${this.widgets['epiCurve-binSize']}ly`} bins)`;
  this.svg.append('text')
    .attr('class', 'x label epi-mixed-axis-label')
    .attr('text-anchor', 'middle')
    .attr('font-size', this.labelSize)
    .attr('x', this.margin.left + this.width / 2)
    .attr('y', this.margin.top + this.height + 44)
    .text(xLabel);

  if (showLeftAxis) {
    this.svg.append('text')
      .attr('class', 'y label epi-mixed-axis-label epi-mixed-axis-label-left')
      .attr('text-anchor', 'middle')
      .attr('font-size', this.labelSize)
      .attr('transform', `translate(18, ${this.margin.top + this.height / 2}) rotate(-90)`)
      .text(this.mixedConfig.figureText.leftAxisLabel.trim() || 'Cumulative total');
  }

  if (showRightAxis) {
    this.svg.append('text')
      .attr('class', 'y label epi-mixed-axis-label epi-mixed-axis-label-right')
      .attr('text-anchor', 'middle')
      .attr('font-size', this.labelSize)
      .attr('transform', `translate(${this.margin.left + this.width + this.margin.right - 16}, ${this.margin.top + this.height / 2}) rotate(90)`)
      .text(this.mixedConfig.figureText.rightAxisLabel.trim() || 'Value per bin');
  }
}

private configureMixedXAxis(): any {
  const numberOfDays = d3.timeDay.count(this.timeDomainStart, this.timeDomainEnd);
  const minimumSpacing = Math.max(64, this.labelSize * 4.8);
  const maximumTickCount = Math.max(2, Math.floor(this.width / minimumSpacing));
  const binSize = this.widgets['epiCurve-binSize'];

  if (binSize === 'Year') {
    const numberOfYears = Math.max(1, d3.timeYear.count(this.timeDomainStart, this.timeDomainEnd));
    const step = Math.max(this.tickInterval, Math.ceil(numberOfYears / maximumTickCount));
    const ticks = d3.timeYear.range(d3.timeYear.floor(this.timeDomainStart), this.timeDomainEnd, step);
    return d3.axisBottom(this.x).tickValues(ticks).tickFormat(d3.timeFormat('%Y'));
  }

  if (binSize === 'Quarter' || binSize === 'Month') {
    const numberOfMonths = Math.max(1, d3.timeMonth.count(this.timeDomainStart, this.timeDomainEnd));
    const minimumStep = binSize === 'Quarter' ? 3 * Math.max(1, this.tickInterval) : Math.max(1, this.tickInterval);
    const rawStep = Math.max(minimumStep, Math.ceil(numberOfMonths / maximumTickCount));
    const step = binSize === 'Quarter' ? Math.ceil(rawStep / 3) * 3 : rawStep;
    const ticks = d3.timeMonth.range(d3.timeMonth.floor(this.timeDomainStart), this.timeDomainEnd, step);
    return d3.axisBottom(this.x).tickValues(ticks).tickFormat(d3.timeFormat('%b %Y'));
  }

  if (numberOfDays <= 120) {
    const minimumStep = binSize === 'Day' ? Math.max(1, this.tickInterval * 7) : Math.max(1, this.tickInterval * 14);
    const requestedStep = Math.max(minimumStep, Math.ceil(numberOfDays / maximumTickCount));
    const daySteps = [1, 2, 3, 7, 14, 21, 28, 35, 42, 56, 84];
    const step = daySteps.find(candidate => candidate >= requestedStep) || requestedStep;
    const ticks = d3.timeDay.range(d3.timeDay.floor(this.timeDomainStart), this.timeDomainEnd, step);
    return d3.axisBottom(this.x).tickValues(ticks).tickFormat(d3.timeFormat('%b %d'));
  }

  if (numberOfDays <= 730) {
    const numberOfMonths = Math.max(1, d3.timeMonth.count(this.timeDomainStart, this.timeDomainEnd));
    const step = Math.max(this.tickInterval, Math.ceil(numberOfMonths / maximumTickCount));
    const ticks = d3.timeMonth.range(d3.timeMonth.floor(this.timeDomainStart), this.timeDomainEnd, step);
    return d3.axisBottom(this.x).tickValues(ticks).tickFormat(d3.timeFormat('%b %Y'));
  }

  const numberOfYears = Math.max(1, d3.timeYear.count(this.timeDomainStart, this.timeDomainEnd));
  const step = Math.max(this.tickInterval, Math.ceil(numberOfYears / maximumTickCount));
  const ticks = d3.timeYear.range(d3.timeYear.floor(this.timeDomainStart), this.timeDomainEnd, step);
  return d3.axisBottom(this.x).tickValues(ticks).tickFormat(d3.timeFormat('%Y'));
}

private renderMixedBars(plot: any, barSeries: EpiMixedRenderedSeries[], scale: any): void {
  if (!scale || barSeries.length === 0) {
    return;
  }

  const zeroY = scale(0);
  barSeries.forEach((series, seriesIndex) => {
    plot.selectAll(`rect.epi-mixed-bar-${seriesIndex}`)
      .data(series.bins)
      .enter()
      .append('rect')
      .attr('class', `epi-mixed-bar epi-mixed-bar-${seriesIndex}`)
      .attr('data-series-id', series.config.id)
      .attr('x', bin => getGroupedBarGeometry(
        this.x(bin.x0),
        this.x(bin.x1),
        seriesIndex,
        barSeries.length
      ).x)
      .attr('width', bin => getGroupedBarGeometry(
        this.x(bin.x0),
        this.x(bin.x1),
        seriesIndex,
        barSeries.length
      ).width)
      .attr('y', bin => Math.min(scale(bin.value), zeroY))
      .attr('height', bin => Math.abs(scale(bin.value) - zeroY))
      .attr('fill', series.config.color)
      .attr('stroke', '#1f2a35')
      .attr('stroke-width', 1);
  });
}

private renderMixedLines(plot: any, lineSeries: EpiMixedRenderedSeries[], scale: any): void {
  if (!scale || lineSeries.length === 0) {
    return;
  }

  lineSeries.forEach(series => {
    const points = [
      { date: this.timeDomainStart, value: 0 },
      ...series.bins.map(bin => ({ date: bin.x1, value: bin.cumulativeValue }))
    ];
    const line = d3.line<any>()
      .x(point => this.x(point.date))
      .y(point => scale(point.value))
      .curve(d3.curveLinear);

    plot.append('path')
      .datum(points)
      .attr('class', `epi-mixed-line ${series.config.mark === 'dashed-line' ? 'epi-mixed-line-dashed' : 'epi-mixed-line-solid'}`)
      .attr('data-series-id', series.config.id)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', series.config.color)
      .attr('stroke-width', 3.5)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round')
      .attr('stroke-dasharray', series.config.mark === 'dashed-line' ? '10,7' : null);
  });
}

private renderMixedLegend(plot: any, series: EpiMixedRenderedSeries[]): void {
  if (this.widgets['epiCurve-legendPosition'] === 'Hide') {
    return;
  }

  const fontSize = Math.max(10, Number(this.legendLabelSize || 15));
  const rowHeight = Math.max(22, fontSize + 9);
  const estimatedWidth = Math.min(300, Math.max(170, ...series.map(item => item.label.length * fontSize * 0.55 + 55)));
  const isBottom = this.widgets['epiCurve-legendPosition'] === 'Bottom';
  const x = this.widgets['epiCurve-legendPosition'] === 'Right'
    ? Math.max(8, this.width - estimatedWidth)
    : 12;
  const baseY = isBottom ? this.height + 76 : 14;

  series.forEach((item, index) => {
    const legendItem = plot.append('g')
      .attr('class', 'epi-mixed-legend-item')
      .attr('data-series-id', item.config.id)
      .attr('transform', isBottom
        ? `translate(${12 + index * Math.max(180, this.width / Math.max(1, series.length))}, ${baseY})`
        : `translate(${x}, ${baseY + index * rowHeight})`);

    if (item.config.mark === 'bar') {
      legendItem.append('rect')
        .attr('x', 0)
        .attr('y', -9)
        .attr('width', 18)
        .attr('height', 14)
        .attr('fill', item.config.color)
        .attr('stroke', '#1f2a35');
    } else {
      legendItem.append('line')
        .attr('x1', 0)
        .attr('x2', 26)
        .attr('y1', -2)
        .attr('y2', -2)
        .attr('stroke', item.config.color)
        .attr('stroke-width', 3.5)
        .attr('stroke-dasharray', item.config.mark === 'dashed-line' ? '10,7' : null);
    }

    legendItem.append('text')
      .attr('x', 34)
      .attr('y', 0)
      .attr('font-size', fontSize)
      .attr('alignment-baseline', 'middle')
      .text(item.label);
  });
}

private renderMixedTooltipTargets(
  plot: any,
  series: EpiMixedRenderedSeries[],
  leftScale: any,
  rightScale: any
): void {
  const hoverPoints = this.getMixedHoverPoints(series, leftScale, rightScale);
  const hoverGroups = groupMixedHoverPoints(hoverPoints);
  const hoverTree = (d3 as any).quadtree()
    .x((group: EpiMixedHoverGroup) => group.x)
    .y((group: EpiMixedHoverGroup) => group.y)
    .addAll(hoverGroups);
  const seriesById = new Map(series.map(item => [item.config.id, item]));
  const hoverMarker = plot.append('circle')
    .attr('class', 'epi-mixed-hover-marker')
    .attr('r', 5)
    .attr('fill', '#ffffff')
    .attr('stroke-width', 3)
    .attr('aria-hidden', 'true')
    .attr('pointer-events', 'none')
    .style('display', 'none');

  plot.append('rect')
    .attr('class', 'epi-mixed-tooltip-target')
    .attr('x', 0)
    .attr('width', this.width)
    .attr('y', 0)
    .attr('height', this.height)
    .attr('fill', 'transparent')
    .attr('pointer-events', 'all')
    .on('mousemove', () => {
      const [pointerX, pointerY] = d3.mouse(plot.node());
      const closestGroup = hoverTree.find(
        pointerX,
        pointerY,
        this.mixedHoverRadius
      ) as EpiMixedHoverGroup | undefined;
      if (!closestGroup) {
        this.hideMixedTooltip();
        hoverMarker.style('display', 'none');
        return;
      }

      const closestSeriesPoints = closestGroup.points.flatMap(point => {
        const matchedSeries = seriesById.get(point.seriesId);
        return matchedSeries ? [{ point, series: matchedSeries }] : [];
      });
      if (closestSeriesPoints.length === 0) {
        return;
      }

      const isOverlap = closestSeriesPoints.length > 1;
      const topPoint = closestSeriesPoints[closestSeriesPoints.length - 1];

      hoverMarker
        .attr('cx', closestGroup.x)
        .attr('cy', closestGroup.y)
        .attr('r', isOverlap ? 7 : 5)
        .attr('stroke', isOverlap ? '#1f2a35' : topPoint.series.config.color)
        .attr('data-series-count', closestSeriesPoints.length)
        .style('display', null);
      this.showMixedTooltip(closestSeriesPoints);
    })
    .on('mouseleave', () => {
      hoverMarker.style('display', 'none');
      this.hideMixedTooltip();
    });
}

private getMixedHoverPoints(
  series: EpiMixedRenderedSeries[],
  leftScale: any,
  rightScale: any
): EpiMixedHoverPoint[] {
  const barSeries = series.filter(item => item.config.mark === 'bar');

  return series.flatMap(item => {
    if (item.config.mark === 'bar') {
      if (!rightScale) {
        return [];
      }

      const seriesIndex = barSeries.findIndex(bar => bar.config.id === item.config.id);
      return item.bins.map((bin, binIndex) => {
        const geometry = getGroupedBarGeometry(
          this.x(bin.x0),
          this.x(bin.x1),
          seriesIndex,
          barSeries.length
        );
        return {
          seriesId: item.config.id,
          binIndex,
          x: geometry.x + geometry.width / 2,
          y: rightScale(bin.value)
        };
      });
    }

    if (!leftScale) {
      return [];
    }

    return item.bins.map((bin, binIndex) => ({
      seriesId: item.config.id,
      binIndex,
      x: this.x(bin.x1),
      y: leftScale(bin.cumulativeValue)
    }));
  });
}

private renderMixedAnnotations(plot: any): void {
  this.mixedAnnotationErrors = {};
  const defs = this.svg.append('defs');
  defs.append('marker')
    .attr('id', 'epi-mixed-arrowhead')
    .attr('viewBox', '0 0 10 10')
    .attr('refX', 8)
    .attr('refY', 5)
    .attr('markerWidth', 7)
    .attr('markerHeight', 7)
    .attr('orient', 'auto-start-reverse')
    .append('path')
    .attr('d', 'M 0 0 L 10 5 L 0 10 z')
    .attr('fill', '#111111');

  this.mixedConfig.annotations.forEach(annotation => {
    const date = parseMixedDate(annotation.date);
    if (!date) {
      this.mixedAnnotationErrors[annotation.id] = 'Enter a valid date.';
      return;
    }
    if (!annotation.text.trim()) {
      this.mixedAnnotationErrors[annotation.id] = 'Enter callout text.';
      return;
    }
    if (date < this.timeDomainStart || date > this.timeDomainEnd) {
      this.mixedAnnotationErrors[annotation.id] = 'This date is outside the plotted range.';
      return;
    }

    const anchorX = this.x(date);
    let labelX = annotation.labelXRatio * this.width;
    let labelY = annotation.labelYRatio * this.height;
    const line = plot.append('line')
      .attr('class', 'epi-mixed-callout-arrow')
      .attr('data-annotation-id', annotation.id)
      .attr('x1', labelX)
      .attr('y1', labelY + 6)
      .attr('x2', anchorX)
      .attr('y2', this.height - 3)
      .attr('stroke', '#111111')
      .attr('stroke-width', 1.5)
      .attr('marker-end', 'url(#epi-mixed-arrowhead)');

    const labelGroup = plot.append('g')
      .attr('class', 'epi-mixed-callout')
      .attr('data-annotation-id', annotation.id)
      .attr('transform', `translate(${labelX}, ${labelY})`)
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', `Move annotation for ${moment(date).format('MMM D, YYYY')}`);

    const labelText = labelGroup.append('text')
      .attr('class', 'epi-mixed-callout-text')
      .attr('font-size', Math.max(11, this.labelSize))
      .attr('font-weight', 600)
      .attr('x', 0)
      .attr('y', 0);
    this.appendWrappedSvgText(
      labelText,
      `${moment(date).format('MMM D, YYYY')}: ${annotation.text}`,
      Math.min(220, Math.max(120, this.width * 0.28)),
      Math.max(14, this.labelSize + 3)
    );

    const textNode = labelText.node() as SVGTextElement;
    const textBounds = textNode.getBBox();
    labelGroup.insert('rect', 'text')
      .attr('class', 'epi-mixed-callout-background')
      .attr('x', textBounds.x - 6)
      .attr('y', textBounds.y - 4)
      .attr('width', textBounds.width + 12)
      .attr('height', textBounds.height + 8)
      .attr('rx', 2)
      .attr('fill', '#ffffff')
      .attr('fill-opacity', 0.9);

    const updatePosition = (nextX: number, nextY: number) => {
      labelX = Math.min(this.width, Math.max(0, nextX));
      labelY = Math.min(this.height - 18, Math.max(18, nextY));
      annotation.labelXRatio = this.width > 0 ? labelX / this.width : 0;
      annotation.labelYRatio = this.height > 0 ? labelY / this.height : 0;
      labelGroup.attr('transform', `translate(${labelX}, ${labelY})`);
      line.attr('x1', labelX).attr('y1', labelY + 6);
    };

    const dragBehavior = (d3 as any).drag()
      .on('start', () => this.hideMixedTooltip())
      .on('drag', () => {
        const dragEvent = (d3 as any).event;
        updatePosition(dragEvent.x, dragEvent.y);
      });
    labelGroup.call(dragBehavior);

    labelGroup.on('keydown', () => {
      const keyboardEvent = (d3 as any).event as KeyboardEvent;
      const direction = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1]
      }[keyboardEvent.key];
      if (!direction) {
        return;
      }

      keyboardEvent.preventDefault();
      const step = keyboardEvent.shiftKey ? 10 : 2;
      updatePosition(labelX + direction[0] * step, labelY + direction[1] * step);
    });
  });
}

private appendWrappedSvgText(selection: any, value: string, maxWidth: number, lineHeight: number): number {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return 0;
  }

  const x = Number(selection.attr('x') || 0);
  const y = Number(selection.attr('y') || 0);
  let line: string[] = [];
  let lineNumber = 0;
  let tspan = selection.append('tspan').attr('x', x).attr('y', y);

  words.forEach(word => {
    line.push(word);
    tspan.text(line.join(' '));
    const node = tspan.node() as SVGTextContentElement;
    if (line.length > 1 && node.getComputedTextLength() > maxWidth) {
      line.pop();
      tspan.text(line.join(' '));
      line = [word];
      lineNumber += 1;
      tspan = selection.append('tspan')
        .attr('x', x)
        .attr('y', y)
        .attr('dy', lineNumber * lineHeight)
        .text(word);
    }
  });

  return lineNumber + 1;
}

private showMixedTooltip(
  hoveredPoints: Array<{ point: EpiMixedHoverPoint; series: EpiMixedRenderedSeries }>
): void {
  if (!this.mixedTooltipElement?.nativeElement) {
    return;
  }

  const entries = hoveredPoints.flatMap(({ point, series }) => {
    const bin = series.bins[point.binIndex];
    if (!bin) {
      return [];
    }

    const value = series.config.mark === 'bar' ? bin.value : bin.cumulativeValue;
    const valueType = series.config.mark === 'bar' ? 'interval' : 'cumulative';
    return [{
      dateRange: this.getMixedBinDateRange(bin),
      valueLine: `${series.label}: ${this.formatMixedNumber(value)} (${valueType})`,
      color: series.config.color
    }];
  });
  if (entries.length === 0) {
    return;
  }

  const dateRanges = Array.from(new Set(entries.map(entry => entry.dateRange)));
  const tooltip = this.mixedTooltipElement.nativeElement as HTMLElement;
  const event = (d3 as any).event as MouseEvent;
  const hostRect = this.epiCurveElement.nativeElement.getBoundingClientRect();
  const left = Math.min(
    Math.max(8, event.clientX - hostRect.left + 14),
    Math.max(8, hostRect.width - 250)
  );
  const top = Math.min(
    Math.max(8, event.clientY - hostRect.top + 14),
    Math.max(8, hostRect.height - 110)
  );
  while (tooltip.firstChild) {
    tooltip.removeChild(tooltip.firstChild);
  }

  if (dateRanges.length === 1) {
    const dateLabel = document.createElement('div');
    dateLabel.className = 'epi-mixed-tooltip-date';
    dateLabel.textContent = dateRanges[0];
    tooltip.appendChild(dateLabel);
  }

  entries.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'epi-mixed-tooltip-row';

    const swatch = document.createElement('span');
    swatch.className = 'epi-mixed-tooltip-swatch';
    swatch.style.backgroundColor = entry.color;
    swatch.setAttribute('aria-hidden', 'true');

    const valueLabel = document.createElement('span');
    valueLabel.textContent = dateRanges.length === 1
      ? entry.valueLine
      : `${entry.dateRange}: ${entry.valueLine}`;

    row.appendChild(swatch);
    row.appendChild(valueLabel);
    tooltip.appendChild(row);
  });
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.style.display = 'block';
}

private hideMixedTooltip(): void {
  if (this.mixedTooltipElement?.nativeElement) {
    this.mixedTooltipElement.nativeElement.style.display = 'none';
  }
}

private getMixedBinDateRange(bin: EpiMixedBinDatum): string {
  const start = moment(bin.x0);
  if (this.widgets['epiCurve-binSize'] === 'Day') {
    return start.format('MMM D, YYYY');
  }

  const end = moment(bin.x1).subtract(1, 'day');
  return `${start.format('MMM D, YYYY')} – ${end.format('MMM D, YYYY')}`;
}

private getMixedSeriesLabel(series: EpiMixedSeriesConfig): string {
  if (series.label.trim()) {
    return series.label.trim();
  }

  return this.commonService.capitalize(series.dateField.replace(/_/g, ' '));
}

private formatMixedNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }

  return value.toLocaleString(undefined, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2
  });
}

/**
 * Return an array of unique options for nodes[this.widgets['epiCurve-stackColorBy']] and then also used that information to update localColorMap function
 */
updateLocalColorMap() {
  let nodeColorTableKeys = [];
  this.commonService.session.data.nodes.forEach((node) => {
    if (!node.visible) return;
    if (!nodeColorTableKeys.some(value => value == node[this.widgets['epiCurve-stackColorBy']])) {
      nodeColorTableKeys.push(node[this.widgets['epiCurve-stackColorBy']])
    }
  })
  this.localColorMap = d3.scaleOrdinal(this.commonService.thirtyColorPalette).domain(nodeColorTableKeys);

  return nodeColorTableKeys;
}

private getOrderedStackKeys(keys, colorVariable) {
  const order = this.widgets['epiCurve-stackOrder'];
  let orderedKeys;
  if (order == 'Custom') {
    orderedKeys = this.getCustomOrderedStackKeys(keys, colorVariable);
  } else {
    orderedKeys = this.getDefaultOrderedStackKeys(keys, colorVariable, order == 'Smallest at Bottom');
  }

  this.setStackOrderItemsFromInternalOrder(orderedKeys);
  return orderedKeys;
}

private getDefaultOrderedStackKeys(keys, colorVariable, smallestAtBottom = false) {
  const counts = new Map();

  keys.forEach((key) => counts.set(key, 0));
  this.vnodes.forEach((node) => {
    if (!this.hasValidStackDate(node)) return;

    const key = keys.find((value) => value == node[colorVariable]);
    if (key === undefined) return;

    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return [...keys]
    .map((key, index) => ({ key, index, count: counts.get(key) || 0 }))
    .sort((a, b) => {
      const countDiff = smallestAtBottom
        ? a.count - b.count
        : b.count - a.count;

      return countDiff || a.index - b.index;
    })
    .map((entry) => entry.key);
}

private getCustomOrderedStackKeys(keys, colorVariable, reset = false) {
  this.ensureCustomStackOrder(keys, colorVariable, reset);

  const customOrder = this.widgets['epiCurve-customStackOrder'];
  const orderedKeys = customOrder
    .map((savedKey) => keys.find((key) => key == savedKey))
    .filter((key, index, values) => key !== undefined && values.findIndex((value) => value == key) == index);
  const missingKeys = keys.filter((key) => !orderedKeys.some((orderedKey) => orderedKey == key));

  return [...orderedKeys, ...missingKeys];
}

private ensureCustomStackOrder(keys, colorVariable, reset = false) {
  const defaultOrder = this.getDefaultOrderedStackKeys(keys, colorVariable);
  const currentOrder = Array.isArray(this.widgets['epiCurve-customStackOrder'])
    ? this.widgets['epiCurve-customStackOrder']
    : [];
  const orderedKeys = reset
    ? []
    : currentOrder
      .map((savedKey) => defaultOrder.find((key) => key == savedKey))
      .filter((key, index, values) => key !== undefined && values.findIndex((value) => value == key) == index);
  const missingKeys = defaultOrder.filter((key) => !orderedKeys.some((orderedKey) => orderedKey == key));
  const nextOrder = reset || orderedKeys.length == 0
    ? defaultOrder
    : [...orderedKeys, ...missingKeys];

  this.widgets['epiCurve-customStackOrder'] = nextOrder;
}

private setStackOrderItemsFromInternalOrder(internalOrder) {
  this.customStackOrderItems = [...internalOrder].reverse().map((key) => ({
    label: this.getTooltipLabel(key),
    value: key,
    color: this.widgets['epiCurve-stackColorBy'] == 'Node Color' ? this.localColorMap(key) : this.getStackGroupColor(key),
    transparency: this.getStackGroupTransparency(key),
  }));
}

private initializeCustomStackOrder(reset = false) {
  const colorVariable = this.getCurrentStackColorVariable();
  if (colorVariable == 'None') {
    this.customStackOrderItems = [];
    this.widgets['epiCurve-customStackOrder'] = [];
    return;
  }

  const keys = this.getCurrentStackKeys(colorVariable);
  this.vnodes = JSON.parse(JSON.stringify(this.commonService.session.data.nodes));
  const orderedKeys = this.getCustomOrderedStackKeys(keys, colorVariable, reset);
  this.setStackOrderItemsFromInternalOrder(orderedKeys);
}

private getStackStyleKey(value): string {
  return value == null ? 'null' : `${typeof value}:${String(value)}`;
}

private getStackGroupColor(value): string {
  const colors = this.widgets['epiCurve-stackGroupColors'] || {};
  const key = this.getStackStyleKey(value);
  if (!colors[key]) {
    colors[key] = this.localColorMap(value) || this.commonService.thirtyColorPalette[0] || '#999999';
    this.widgets['epiCurve-stackGroupColors'] = colors;
  }

  return colors[key];
}

private getStackGroupTransparency(value): number {
  const transparencies = this.widgets['epiCurve-stackGroupTransparencies'] || {};
  const transparency = Number(transparencies[this.getStackStyleKey(value)]);
  if (!Number.isFinite(transparency)) {
    return 0;
  }

  return this.clampStackAlpha(transparency);
}

private setStackGroupColor(value, color): void {
  const colors = this.widgets['epiCurve-stackGroupColors'] || {};
  colors[this.getStackStyleKey(value)] = color;
  this.widgets['epiCurve-stackGroupColors'] = colors;
}

private setStackGroupTransparency(value, transparency): void {
  const transparencies = this.widgets['epiCurve-stackGroupTransparencies'] || {};
  const numericTransparency = Number(transparency);
  transparencies[this.getStackStyleKey(value)] = Number.isFinite(numericTransparency)
    ? this.clampStackAlpha(numericTransparency)
    : 0;
  this.widgets['epiCurve-stackGroupTransparencies'] = transparencies;
}

private getStackFill(value): string {
  if (this.widgets['epiCurve-stackColorBy'] == 'Node Color') {
    return this.localColorMap(value);
  }

  return this.getStackGroupColor(value);
}

private getStackOpacity(value): number {
  if (this.widgets['epiCurve-stackColorBy'] == 'Node Color') {
    return 1;
  }

  return this.clampStackAlpha(1 - this.getStackGroupTransparency(value));
}

private clampStackAlpha(value): number {
  return Number(Math.min(1, Math.max(0, Number(value))).toFixed(4));
}

private getCurrentStackColorVariable() {
  const colorVariable = this.commonService.session.style.widgets['node-color-variable'];
  if (this.widgets['epiCurve-stackColorBy'] == 'Node Color') {
    return colorVariable != 'None' ? colorVariable : 'None';
  }

  return this.widgets['epiCurve-stackColorBy'];
}

private getCurrentStackKeys(colorVariable) {
  if (colorVariable == 'None') {
    return [];
  }

  if (this.widgets['epiCurve-stackColorBy'] == 'Node Color') {
    const nodeColorKeys = this.commonService.session.style.nodeColorsTableKeys[colorVariable] || [];
    return nodeColorKeys.map(value => value=='null' ? null: value);
  }

  let keys = [];
  this.commonService.session.data.nodes.forEach((node) => {
    if (!node.visible) return;
    if (!keys.some(value => value == node[colorVariable])) {
      keys.push(node[colorVariable])
    }
  })

  return keys;
}

private hasValidStackDate(node) {
  const value = node?.[this.SelectedDateFieldVariable];
  if (value == null || String(value).trim() == '') {
    return false;
  }

  return moment(value).isValid();
}

updateSizes() {
  this.updateBottomMargin();
  const wrapper = $(this.epiCurveElement.nativeElement).parent();
  $('#epiCurve').height(wrapper.height() - 50);
  this.width = wrapper.width() - this.margin.left - this.margin.right;
  // height represents the height of y axis
  this.height = wrapper.height() - this.margin.top - this.margin.bottom - 50;
  this.middle = this.height / 2;
}

private updateBottomMargin() {
  const baseBottomMargin = this.widgets['epiCurve-legendPosition'] == 'Bottom' ? 100 : 50;
  const labelSizePadding = Math.max(0, this.labelSize - 12) * 2;
  const legendSizePadding = this.widgets['epiCurve-legendPosition'] == 'Bottom' ? Math.max(0, this.legendLabelSize - 15) * 2 : 0;
  this.margin.bottom = baseBottomMargin + labelSizePadding + legendSizePadding;
  this.margin.top = Math.max(8, Math.round(this.labelSize * 0.75));
  this.margin.left = Math.max(45, Math.round(this.labelSize * 3.2));
  this.margin.right = Math.max(20, Math.round(this.labelSize * 2))+10;
}

getTimes(fields) {
  let times = [];
  this.vnodes = JSON.parse(JSON.stringify(this.commonService.session.data.nodes));
  this.vnodes.forEach(d => {
    fields.forEach(field => {
      const time = moment(d[field as string]); // Cast 'field' as string
      if (time.isValid()) {
        d[field as string] = time.toDate();
        times.push(d[field as string]); // Cast 'field' as string
      } else {
        d[field as string] = null; // Cast 'field' as string
      }
    })
  });

  if (times.length < 2) {
    times = [new Date(2000, 1, 1), new Date()];
  }
  return times;
}

private getBinDateRange(bin): string {
  if (!bin || !bin.x0 || !bin.x1) {
    return "Date range: Unknown";
  }

  const start = moment(bin.x0);
  let end = moment(bin.x1).subtract(1, "day");

  if (!start.isValid() || !end.isValid()) {
    return "Date range: Unknown";
  }

  if (end.isBefore(start)) {
    end = moment(bin.x1);
  }
  if (this.widgets['epiCurve-binSize'] == 'Day') { 
    return `Date: ${start.format("MMM D, YYYY")}`
  } else {
    return `Date range: ${start.format("MMM D, YYYY")} - ${end.format("MMM D, YYYY")}`;
  }
}

private getCount(count): number {
  return Number.isFinite(count) ? count : 0;
}

private getBinCount(bin): number {
  if (!bin) {
    return 0;
  }

  if (this.widgets['epiCurve-cumulative']) {
    return this.getCount(bin.cumulativeCount != null ? bin.cumulativeCount : bin.length);
  }

  return this.getCount(bin.binCount != null ? bin.binCount : bin.length);
}

private getSegmentCount(bin, segmentIndex): number {
  if (!bin) {
    return 0;
  }

  if (this.widgets['epiCurve-cumulative']) {
    return this.getCount(bin.cumulativeSegmentCounts?.[segmentIndex]);
  }

  return this.getCount(bin.segmentCounts?.[segmentIndex]);
}

private getTooltipLabel(value): string {
  if (value == null) {
    return "(Empty)";
  }

  return this.commonService.capitalize(value.toString().replace(/_/g, " "));
}

private getSingleBinTooltip(bin, field, segmentLabel = undefined, segmentCount = undefined): string {
  const fieldLabel = this.getTooltipLabel(field);
  const lines = [
    this.getBinDateRange(bin)
  ];

  if (segmentLabel !== undefined) {
    lines.push(`${this.getTooltipLabel(segmentLabel)}: ${this.getCount(segmentCount)}`);
    lines.push(`${fieldLabel} total: ${this.getBinCount(bin)}`);
  } else {
    lines.push(`${fieldLabel}: ${this.getBinCount(bin)}`);
  }

  return lines.join("\n");
}

private getMultiBinTooltip(fields, bins, binIndex): string {
  const firstAvailableBin = bins.find(fieldBins => fieldBins?.[binIndex])?.[binIndex];
  const lines = [
    this.getBinDateRange(firstAvailableBin)
  ];

  fields.forEach((field, fieldIndex) => {
    lines.push(`${this.getTooltipLabel(field)}: ${this.getBinCount(bins[fieldIndex]?.[binIndex])}`);
  });

  return lines.join("\n");
}
onLabelSizeChange() {
  this.refresh();
}

updateAxes() {
  const xAxis = this.configureXAxisSettings();
  const yDomainMax = Math.max(0, Math.ceil(this.y.domain()[1] as number));
  const yTickStep = Math.max(1, Math.ceil(yDomainMax / 10));
  const yTickValues = d3.range(0, yDomainMax + 1, yTickStep);
  if (yTickValues[yTickValues.length - 1] !== yDomainMax) {
    yTickValues.push(yDomainMax);
  }
  const yAxis = d3.axisLeft(this.y)
    .tickValues(yTickValues)
    .tickFormat((d: number) => `${Math.round(d)}`);

  const xLabelY = this.height + this.margin.top + Math.max(40, Math.round(this.labelSize * 2.3));
  const yTickOffset = -Math.max(9, Math.round(this.labelSize * 0.9));

  const xAxisGroup = this.svg.append("g")
    .attr("class", "axis axis--x")
    .attr("transform", `translate(${this.margin.left}, ${this.height + this.margin.top})`)
    .call(xAxis)
    .attr("text-anchor", "middle")
    .attr("font-size", this.labelSize);
  xAxisGroup.selectAll("text").attr("text-anchor", "middle");

  this.svg.append("g")
    .attr("class", "axis axis--y")
    .attr("transform", `translate(${this.margin.left}, ${this.margin.top})`)
    .call(yAxis)
    .attr("font-size", this.labelSize)
    .selectAll("text")
    .attr("text-anchor", "end")
    .attr("x", yTickOffset);

  this.svg.append("text")
    .attr("class", "x label")
    .attr("text-anchor", "middle")
    .attr("font-size", this.labelSize)
    .attr("x", this.margin.left + this.width / 2)
    .attr("y", xLabelY)
    .text(`Date (${this.widgets['epiCurve-binSize']=='Day'? 'Dai': this.widgets['epiCurve-binSize']}ly Bins)`);

  this.svg.append("text")
    .attr("class", "y label")
    .attr("text-anchor", "middle")
    .attr("font-size", this.labelSize)
    .attr("y", Math.max(14, Math.round(this.labelSize * 0.95)))
    .attr("x", -(this.margin.top + this.height / 2))
    .attr("transform", "rotate(-90)")
    .text("Number of Cases");

  /*this.brush = d3.brushX()
    .extent([[0, 0], [this.width, this.height]])
    .on("start brush", () => {
      this.selection = d3.brushSelection(this.brushG.node());
      if (!this.selection) return;
      if (this.selection[0] > 0) {
        this.selection[0] = 0;
        this.brushG.call(this.brush.move, this.selection);
      }
    })
    .on("end", function () {
      this.selection = d3.brushSelection(this.brushG.node());
      if (!this.selection) return;
      if (this.selection[0] > 0) {
        this.selection[0] = 0;
        this.brushG.call(this.brush.move, this.selection);
        this.propagate();
      }
    });

    this.brushG = this.svg
    .append("g")
    .attr("class", "brush")
    .attr("transform", "translate(" + this.margin.left + ",0)")
    .call(this.brush);
    */

}

generateLegend(epiCurve, colors, fieldNames, opacities = []) {
  const legendFontSize = Math.max(6, Number(this.legendLabelSize || 15));
  const legendFontSizePx = `${legendFontSize}px`;
  const markerRadius = Math.max(4, Math.round(legendFontSize * 0.35));
  const markerTextGap = Math.max(8, Math.round(legendFontSize * 0.65));
  const legendRowHeight = Math.max(22, Math.round(legendFontSize * 1.9));
  const legendCharWidth = Math.max(5.5, legendFontSize * 0.55);
  const legendItemGap = Math.max(24, Math.round(legendFontSize * 1.8));

  let xOffset = 50; // default for left position
  if (this.widgets['epiCurve-legendPosition'] == 'Hide') {
    return;
  } else if (this.widgets['epiCurve-legendPosition'] == 'Bottom') {
    let prevLength = 0;
    let rowCount = 0;
    let y = this.height + this.margin.bottom - (Math.max(legendRowHeight, Math.round(this.labelSize * 1.5)) + 14);
    if (this.selectedGraphType=='Single Date Field' && this.widgets['epiCurve-stackColorBy'] == 'Node Color' && this.commonService.session.style.widgets['node-color-variable'] != 'None') {
      let field = this.commonService.capitalize(this.commonService.session.style.widgets['node-color-variable']);
      epiCurve.append("text").attr("x", 70).attr("y", y).text(field + ': ').style("font-size", legendFontSizePx).attr("alignment-baseline","middle")
      prevLength += field.length + 3;
    } else if (this.selectedGraphType=='Single Date Field' && this.widgets['epiCurve-stackColorBy'] != 'Node Color' && this.widgets['epiCurve-stackColorBy'] != 'None') {
      epiCurve.append("text").attr("x", 70).attr("y", y).text(this.widgets['epiCurve-stackColorBy'] + ': ').style("font-size", legendFontSizePx).attr("alignment-baseline","middle")
      prevLength += this.widgets['epiCurve-stackColorBy'].length + 3;
    }
    fieldNames.forEach((name, i) => {
      // this first section calculates the location for each item/name in the legend
      let nLength = name==null ? 7: name.toString().length
      let baseX = 70 + legendItemGap * rowCount + prevLength * legendCharWidth;
      if (baseX + markerRadius * 2 + markerTextGap + nLength * legendCharWidth > this.width - 70) {
        rowCount = 0;
        y -= legendRowHeight;
        prevLength = 0;
        baseX = 70;
      }

      epiCurve.append("circle").attr("cx", baseX).attr("cy", y).attr("r", markerRadius).style("fill", colors[i]).style("opacity", opacities[i] ?? 1)
      epiCurve.append("text").attr("x", baseX + markerRadius + markerTextGap).attr("y", y).text(this.commonService.capitalize(name==null? '(Empty)': name.toString())).style("font-size", legendFontSizePx).attr("alignment-baseline","middle")

      prevLength += nLength;
      rowCount += 1;
    })
    return;
  } else if (this.widgets['epiCurve-legendPosition'] == 'Right') {
    xOffset = this.width - Math.max(120, Math.round(legendFontSize * 8));
  }
  let count = 0;
  if (this.selectedGraphType=='Single Date Field' && this.widgets['epiCurve-stackColorBy'] == 'Node Color' && this.commonService.session.style.widgets['node-color-variable'] != 'None') {
    let field = this.commonService.capitalize(this.commonService.session.style.widgets['node-color-variable']);
    epiCurve.append("text").attr("x", xOffset).attr("y", legendRowHeight).text(field + ': ').style("font-size", legendFontSizePx).attr("alignment-baseline","middle")
    count += 1;
  } else if (this.selectedGraphType=='Single Date Field' && this.widgets['epiCurve-stackColorBy'] != 'Node Color' && this.widgets['epiCurve-stackColorBy'] != 'None') {
    epiCurve.append("text").attr("x", xOffset).attr("y", legendRowHeight).text(this.widgets['epiCurve-stackColorBy'] + ': ').style("font-size", legendFontSizePx).attr("alignment-baseline","middle")
    count += 1;
  }
  fieldNames.forEach((name, i) => {
    epiCurve.append("circle").attr("cx", xOffset).attr("cy", legendRowHeight * (count + 1)).attr("r", markerRadius).style("fill", colors[i]).style("opacity", opacities[i] ?? 1)
    epiCurve.append("text").attr("x", xOffset + markerRadius + markerTextGap).attr("y", legendRowHeight * (count + 1)).text(this.commonService.capitalize(name==null? '(Empty)': name.toString())).style("font-size", legendFontSizePx).attr("alignment-baseline","middle")
    count += 1;
  })
}

private setupEventListeners(): void {

  $('#timeline-play').click(() => {
    if (this.isPlaying) {
      $('#timeline-play').html('<span class="oi oi-media-play"></span>');
      this.stopTimeline();
    } else {
      $('#timeline-play').html('<span class="oi oi-media-pause"></span>');
      this.startTimeline();
    }
  });

  $('#timeline-speed').on('change', () => {
    this.setTimer();
  });

  this.container.on('resize', () => { this.goldenLayoutComponentResize() })
  this.container.on('hide', () => { 
    this.viewActive = false; 
    this.cdref.detectChanges();
  })
  this.container.on('show', () => { 
    this.viewActive = true; 
    this.cdref.detectChanges();
  })
}

/**
 * Updates this.timeDomainStart and this.timeDomainEnd based on dates and this.widgets['epiCurve-binSize'];
 * 
 * @param times array of date objects
 * @returns return a d3 time range such as d3.timeMonth.range()
 */
calculateBinInterval(times) {
  let minTime = Math.min(...times);
  let maxTime = Math.max(...times);

  if (this.widgets['epiCurve-binSize'] == 'Day') {
    //@ts-ignore
    this.timeDomainStart = d3.timeMonth(minTime);
    //@ts-ignore
    this.timeDomainEnd = d3.timeMonth.ceil(maxTime);
    return d3.timeDay.range(this.timeDomainStart, this.timeDomainEnd);
  } else if (this.widgets['epiCurve-binSize'] == 'Week') {
    this.timeDomainStart = d3.timeMonday.floor(new Date(minTime));
    this.timeDomainEnd = d3.timeMonday.ceil(new Date(maxTime));
    if (this.timeDomainEnd.getTime() <= maxTime) {
      this.timeDomainEnd = d3.timeMonday.offset(this.timeDomainEnd, 1);
    }
    return d3.timeMonday.range(this.timeDomainStart, this.timeDomainEnd);
  } else if (this.widgets['epiCurve-binSize'] == 'Month') {
    //@ts-ignore
    this.timeDomainStart = d3.timeMonth(minTime);
    //@ts-ignore
    this.timeDomainEnd = d3.timeMonth.ceil(maxTime);
    return d3.timeMonth.range(this.timeDomainStart, this.timeDomainEnd);
  } else if (this.widgets['epiCurve-binSize'] == 'Quarter') {
    //@ts-ignore
    this.timeDomainStart = d3.timeMonth(minTime, 3);
    //@ts-ignore
    this.timeDomainEnd = d3.timeMonth.ceil(maxTime, 3);
    // for quarter we may need to update earliest month so that quarters are consistant (always start on Jan, April, July, or October)
    if ([1, 2].includes(this.timeDomainStart.getMonth())){
      this.timeDomainStart.setMonth(0);
    } else if ([4,5].includes(this.timeDomainStart.getMonth())) {
      this.timeDomainStart.setMonth(3);
    } else if ([7,8].includes(this.timeDomainStart.getMonth())) {
      this.timeDomainStart.setMonth(6);
    } else if ([10,11].includes(this.timeDomainStart.getMonth())) {
      this.timeDomainStart.setMonth(9);
    }
    return d3.timeMonth.range(this.timeDomainStart, this.timeDomainEnd, 3);
  } else if (this.widgets['epiCurve-binSize'] == 'Year') {
    //@ts-ignore
    this.timeDomainStart = d3.timeYear(minTime);
    //@ts-ignore
    this.timeDomainEnd = d3.timeYear.ceil(maxTime);
    return d3.timeYear.range(this.timeDomainStart, this.timeDomainEnd);
  } else {
    alert("Invalid bin size selected");
    return 0;
  }

}

/**
 * @returns updated bins with new attributes. bin.length2 is array of height of each group (ie. 'M', 'F') needed for that bin interval, bin.height represents the offset of that group.
 * 
 * Also returns maxCount which is used for setting y axis max value
 */
updateBins(bins, colorVariable='None', nodeColorKeys=undefined) {
  let maxCount = 0;
  bins.forEach(bin => {
    bin.binCount = bin.length;
  });
  // cumulative with multiple colors per column
  if (this.widgets['epiCurve-stackColorBy'] != 'None' && this.widgets['epiCurve-cumulative'] && colorVariable != 'None') { //useNodeColors
    //heights represents the size of each rect, offset represent the offset of each rect
    let heights = new Array(nodeColorKeys.length).fill(0);
    let offsets = new Array(nodeColorKeys.length).fill(0);
    bins.forEach(bin => {
      bin.length2 = [];
      bin.height = [];
      bin.segmentCounts = [];
      bin.cumulativeSegmentCounts = [];
      nodeColorKeys.forEach((value, ind) => {
        let currentCount = bin.filter((obj)=> obj[colorVariable]==value).length
        bin.segmentCounts.push(currentCount);
        heights[ind] += currentCount;
        bin.cumulativeSegmentCounts.push(heights[ind]);
        bin.length2.push(heights[ind]);
        offsets[ind] = bin.length2.reduce((paritalSum, a)=> paritalSum+a,0);
        bin.height.push(offsets[ind]);
        
      })
      maxCount += bin.length;
      bin.cumulativeCount = maxCount;
    })
    // noncumulative with multiple colors per column
  } else if (this.widgets['epiCurve-stackColorBy'] != 'None' && colorVariable != 'None') {
    bins.forEach(bin => {
      bin.length2 = [];
      bin.height = [];
      bin.segmentCounts = [];
      nodeColorKeys.forEach(value => {
        let currentCount = bin.filter((obj)=> obj[colorVariable]==value).length
        bin.segmentCounts.push(currentCount);
        bin.length2.push(currentCount);
        bin.height.push(bin.length2.reduce((paritalSum, a)=> paritalSum+a,0));
      })
      if (bin.length > maxCount) maxCount = bin.length
    })
  // else if (useNodeColor == False || (useNodeColor && colorVariable=='None')) and using cumulative
  // cumulative with one color 
  } else if (this.widgets['epiCurve-cumulative']) {
    bins.forEach(bin => {
      maxCount += bin.length;
      bin.cumulativeCount = maxCount;
      bin.length = maxCount;
    });
    // noncumulative with one color
  } else {
    bins.forEach(bin => {
      if (bin.length > maxCount) maxCount = bin.length
    })
  }

  return [maxCount, bins]
}

/**
 * 
 * @return xAxis which is used to determine the interval and label for xAxis ticks
 */
configureXAxisSettings() {
  let xAxis;
  let numberOfDays = d3.timeDay.count(this.timeDomainStart, this.timeDomainEnd);
  if (this.widgets['epiCurve-binSize'] == 'Year') {
    xAxis = d3.axisBottom(this.x).ticks(d3.timeYear).tickFormat(d3.timeFormat("%Y"));
  } else if (numberOfDays<366) {
    xAxis = d3.axisBottom(this.x).ticks(d3.timeMonth.every(this.tickInterval)).tickFormat(d3.timeFormat("%b %Y"))
  } else if (this.widgets['epiCurve-binSize'] == 'Quarter') {
    xAxis = d3.axisBottom(this.x)
      .ticks(d3.timeMonth.every(this.tickInterval < 3 ? this.tickInterval * 3 : 12))
      .tickFormat((d: Date) => d <= d3.timeYear(d) ? d.getFullYear().toString() : null);
  } else {
    xAxis = d3.axisBottom(this.x)
      .ticks(d3.timeMonth.every(this.tickInterval))
      .tickFormat((d: Date) => d <= d3.timeYear(d) ? d.getFullYear().toString() : null);
  }
  return xAxis;
}

goldenLayoutComponentResize() {
  this.refresh();
  if (this.ShowEpiExportPane && this.EpiExportFileType!='svg') {
    this.setCalculatedResolution();
  }
}

// Handle the change event of the date field
onDateFieldChange(index: number) {
  if (index == 0) {
    this.widgets["epiCurve-date-fields"][index] = this.SelectedDateFieldVariable;
  } else if (index == 1) {
    this.widgets["epiCurve-date-fields"][index] = this.SelectedDateFieldVariable2;
  } else if (index == 2) {
    this.widgets["epiCurve-date-fields"][index] = this.SelectedDateFieldVariable3;
  }

  this.refresh();
}

onBinSizeChange() {
  if (this.widgets['epiCurve-binSize'] == 'Year') {
    $('#epi-tick-size').slideUp();
  } else {
    if (this.widgets['epiCurve-binSize'] == 'Quarter') {
      this.tickInterval = 1;
    }
    $('#epi-tick-size').slideDown();
  }
  this.refresh();
}

updateSettingsRows() {
  this.ShowEpiSettingsPane = true;
  setTimeout(() => {
    if (this.isMixedGraphType()) {
      $('#useNodeColorRow').slideUp();
      $('.additionalDateField').slideUp();
    } else if (this.selectedGraphType == 'Multi: Overlay' || this.selectedGraphType == 'Multi: Side by Side') {
      $('#useNodeColorRow').slideUp();
      $('.additionalDateField').slideDown();
      //$('#epi-color-select').slideUp();
    } else {
      $('.additionalDateField').slideUp();
      $('#useNodeColorRow').slideDown();
      if (this.widgets['epiCurve-stackColorBy'] == 'None') {
        $('#epi-color-select').slideDown();
      }
    }
    //this.ShowEpiSettingsPane = false;
  }, 0)
}

onGraphTypeChange(refresh=true) {
  this.updateSettingsRows();

  this.widgets['epiCurve-graphType'] = this.selectedGraphType;
  if (refresh) this.refresh();
}

getEpiSettingsDialogStyle(): { [key: string]: string } {
  return this.isMixedGraphType()
    ? { width: '760px', height: '700px' }
    : { width: '500px', height: '490px' };
}

onMixedSeriesValueModeChange(series: EpiMixedSeriesConfig): void {
  if (series.valueMode === 'count') {
    series.valueField = 'None';
  }
  this.onMixedConfigChanged();
}

onMixedConfigChanged(): void {
  this.widgets['epiCurve-mixedConfig'] = this.mixedConfig;
  this.refresh();
}

addMixedAnnotation(): void {
  this.mixedAnnotationSequence += 1;
  const index = this.mixedConfig.annotations.length;
  const annotation: EpiMixedAnnotationConfig = {
    id: `mixed-annotation-${Date.now()}-${this.mixedAnnotationSequence}`,
    date: this.mixedDomainStartInput || moment().format('YYYY-MM-DD'),
    text: '',
    labelXRatio: Math.min(0.86, 0.18 + index * 0.24),
    labelYRatio: Math.min(0.8, 0.32 + (index % 2) * 0.24)
  };
  this.mixedConfig.annotations.push(annotation);
  this.onMixedConfigChanged();
}

removeMixedAnnotation(annotationId: string): void {
  this.mixedConfig.annotations = this.mixedConfig.annotations.filter(annotation => annotation.id !== annotationId);
  this.onMixedConfigChanged();
}

resetMixedAnnotationPosition(annotation: EpiMixedAnnotationConfig): void {
  const index = Math.max(0, this.mixedConfig.annotations.findIndex(item => item.id === annotation.id));
  const date = parseMixedDate(annotation.date);
  if (date && this.x) {
    const anchorRatio = this.x(date) / Math.max(1, this.width);
    annotation.labelXRatio = Math.min(0.86, Math.max(0.14, anchorRatio + (anchorRatio < 0.65 ? 0.16 : -0.16)));
  } else {
    annotation.labelXRatio = Math.min(0.86, 0.18 + index * 0.24);
  }
  annotation.labelYRatio = Math.min(0.8, 0.32 + (index % 2) * 0.24);
  this.onMixedConfigChanged();
}

getMixedSeriesError(index: number): string {
  return this.mixedSeriesErrors[index] || '';
}

getMixedAnnotationError(annotationId: string): string {
  return this.mixedAnnotationErrors[annotationId] || '';
}

onUseNodeColorChange() {
  if (this.widgets['epiCurve-stackColorBy'] == 'None') {
    $('#epi-color-select').slideDown();
    this.customStackOrderItems = [];
  } else {
    $('#epi-color-select').slideUp();
  }
  if (this.widgets['epiCurve-stackOrder'] == 'Custom') {
    this.initializeCustomStackOrder(true);
  }
  this.refresh();
}

onStackOrderChange() {
  if (this.widgets['epiCurve-stackOrder'] == 'Custom') {
    this.initializeCustomStackOrder(true);
  }
  this.refresh();
}

onCustomStackOrderReorder() {
  if (this.widgets['epiCurve-stackOrder'] != 'Custom') {
    this.widgets['epiCurve-stackOrder'] = 'Custom';
  }
  this.widgets['epiCurve-customStackOrder'] = [...this.customStackOrderItems].reverse().map((item) => item.value);
  this.refresh();
}

onStackGroupColorChange(item, color) {
  item.color = color;
  this.setStackGroupColor(item.value, color);
  this.refresh();
}

onStackGroupTransparencyChange(item, transparency) {
  const numericTransparency = Number(transparency);
  item.transparency = Number.isFinite(numericTransparency)
    ? this.clampStackAlpha(numericTransparency)
    : 0;
  this.setStackGroupTransparency(item.value, item.transparency);
  this.refresh();
}

openStackGroupTransparencyPicker(event, item) {
  event.preventDefault();
  event.stopPropagation();

  $("#color-transparency-wrapper").css({
    top: event.clientY + 129,
    left: event.clientX,
    display: "block",
    zIndex: 99999
  });

  $("#color-transparency")
    .off("change")
    .val(this.getStackOpacity(item.value))
    .one("change", sliderEvent => {
      const opacity = Number(sliderEvent.target['value']);
      const transparency = Number.isFinite(opacity) ? this.clampStackAlpha(1 - opacity) : 0;
      this.onStackGroupTransparencyChange(item, transparency);
      $("#color-transparency-wrapper").fadeOut();
      this.cdref.markForCheck();
    });
}

onTickIntevalChange() {
  this.refresh()
}

onNodeColorChanged() {
  this.refresh();
}

onLegendPositionChange() {
  this.refresh();
}

onLegendLabelSizeChange() {
  this.legendLabelSize = Number(this.legendLabelSize);
  this.refresh();
}

openSettings() {
  this.visuals.epiCurve.ShowEpiSettingsPane = !this.visuals.epiCurve.ShowEpiSettingsPane;
}

setCumulative(value: boolean): void {
  this.refresh();
}


/**
 * Sets CalculatedResolution variable to string such as '1250 x 855px'. Only called when export is first opened
 */
setCalculatedResolution() {
  let [width, height] = this.getImageDimensions();
  this.CalculatedResolution = (Math.round(width * this.SelectedNetworkExportScaleVariable) + " x " + Math.round(height * this.SelectedNetworkExportScaleVariable) + "px");
}

  /**
   * Updates CalculatedResolution variable to string such as '1250 x 855px' based on ImageDimensions and SelectedNetworkExportScaleVariable. 
   * This is called anytime SelectedNetworkExportScaleVariable is updated.
   */
  updateCalculatedResolution() {
    let [width, height] = this.getImageDimensions();
    this.CalculatedResolution = (Math.round(width * this.SelectedNetworkExportScaleVariable) + " x " + Math.round(height * this.SelectedNetworkExportScaleVariable) + "px");
    this.cdref.detectChanges();
}

/**
 * @returns an array [width, height] of the svg image
 */
  getImageDimensions() {
    let parent = this.svg.node();
    return [parent.clientWidth, parent.clientHeight] 
  }

private startTimeline(): void {
  this.isPlaying = true;
  this.setTimer();
}

private stopTimeline(): void {
  this.isPlaying = false;
  if (this.timer) {
    this.timer.stop();
  }
}

private setTimer(): void {
  if (this.timer) {
    this.timer.stop();
    d3.timerFlush();
  }
  this.timer = d3.interval(() => {
    const selection = d3.brushSelection(this.brushG.node());
    if (!selection) return this.timer.stop(); // Ignore empty selections
    if (selection[1] >= this.width) {
      this.startTimeline();
      return;
    }
    this.brushG.call(this.brush.move, selection.map(s => s + 1));
    if (++this.tick % 5 == 0) this.propagate();
  }, 110 - parseInt($("#timeline-speed").val() as string));
  if (!this.isPlaying) this.timer.stop();
}

private propagate(): void {
  this.commonService.session.state.timeStart = this.x.invert(this.selection[0]);
  this.commonService.session.state.timeEnd = this.x.invert(this.selection[1]);
  this.commonService.setNodeVisibility(true);
  this.commonService.setLinkVisibility(true);
  this.commonService.tagClusters().then(() => {
    ["node", "link"].forEach((thing: string) => {
      (window as any).trigger(thing + "-visibility");
    });
  });
}

// private initializeD3Chart(): void {
//   this.clearSvg();
//   this.setupDimensions();
//   this.setupScales();
//   this.createSvg();
//   this.populateData();
//   this.drawHistogram();
//   this.setupBrush();
// }

// private clearSvg(): void {
//   d3.select(this.timelineElement.nativeElement).selectAll("*").remove();
// }

// private setupDimensions(): void {
//   const wrapper = this.timelineElement.nativeElement;
//   this.width = wrapper.clientWidth - this.margin.left - this.margin.right;
//   this.height = wrapper.clientHeight - this.margin.top - this.margin.bottom;
// }

// private setupScales(): void {
//   this.x = d3.scaleTime().range([0, this.width]);
//   this.y = d3.scaleLinear().range([this.height, 0]);
// }

// private createSvg(): void {
//   this.svg = d3.select(this.timelineElement.nativeElement)
//     .append("svg")
//     .attr("width", this.width + this.margin.left + this.margin.right)
//     .attr("height", this.height + this.margin.top + this.margin.bottom)
//     .append("g")
//     .attr("transform", `translate(${this.margin.left},${this.margin.top})`);
// }

// private populateData(): void {
//   // Transform your data here
//   this.vnodes.forEach(d => {
//     const time = moment(d.date); // Replace 'date' with your actual date field
//     if (time.isValid()) {
//       d.date = time.toDate();
//     } else {
//       d.date = null;
//     }
//   });

//   this.timeDomainStart = d3.min(this.vnodes, d => d.date);
//   this.timeDomainEnd = d3.max(this.vnodes, d => d.date);
//   this.x.domain([this.timeDomainStart, this.timeDomainEnd]);
// }

// private drawHistogram(): void {
//   // Draw your histogram here
//   this.histogram = d3.histogram()
//     .value(d => d.date) // Replace 'date' with your actual date field
//     .domain(this.x.domain())
//     .thresholds(d3.thresholdScott);

//   const bins = this.histogram(this.vnodes);

//   if (this.cumulative) {
//     let sum = 0;
//     bins.forEach(bin => {
//       sum += bin.length;
//       bin.length = sum;
//     });
//   }

//   this.y.domain([0, d3.max(bins, d => d.length)]);

//   this.svg.selectAll("rect")
//     .data(bins)
//     .enter()
//     .append("rect")
//     .attr("x", d => this.x(d.x0))
//     .attr("y", d => this.y(d.length))
//     .attr("width", d => this.x(d.x1) - this.x(d.x0))
//     .attr("height", d => this.height - this.y(d.length))
//     .attr("fill", "steelblue"); // Change fill as necessary
// }

// private setupBrush(): void {
//   this.brush = d3.brushX()
//     .extent([[0, 0], [this.width, this.height]])
//     .on("end", () => this.onBrushEnd());

//   this.brushG = this.svg.append("g")
//     .attr("class", "brush")
//     .call(this.brush);
// }

// private onBrushEnd(): void {
//   this.selection = d3.brushSelection(this.brushG.node());
//   if (this.selection) {
//     // Handle brush selection change
//   }
// }

// playPauseTimeline(): void {
//   if (this.isPlaying) {
//     this.stopTimeline();
//   } else {
//     this.startTimeline();
//   }
// }

// startTimeline(): void {
//   this.isPlaying = true;
//   this.setTimer();
// }

// stopTimeline(): void {
//   this.isPlaying = false;
//   if (this.timer) {
//     this.timer.stop();
//   }
// }

// setTimer(): void {
//   if (this.timer) {
//     this.timer.stop();
//   }
//   this.timer = d3.interval(() => {
//     // Timer logic for updating the timeline
//     // this.updateTimeline();
//   }, 100); // Adjust interval as needed
// }

updateNodeColors() {
  if(this.selectedGraphType == "Single Date Field" && this.widgets['epiCurve-stackColorBy'] == 'Node Color') {
    this.refresh();
  }
}
updateVisualization() {
  //Not Relevant
}

applyStyleFileSettings() {
  this.widgets = (window as any).context.commonService.session.style.widgets;
  this.setDefaultsWidgets();
  
  this.updateSettingsRows()
  this.onLegendPositionChange()
}

updateLinkColor() {
  //Not Relevant
}

onRecallSession() {
}

openExport() {
  this.setCalculatedResolution();
  this.ShowEpiExportPane = !this.ShowEpiExportPane;
}

exportVisualization() {
  if (this.EpiExportFileType == 'svg') {
      let content = this.exportService.unparseSVG(this.epiCurveSVGElement.nativeElement);
      let blob = new Blob([content], { type: 'image/svg+xml;charset=utf-8' });
      saveAs(blob, this.EpiExportFileName + '.' + this.EpiExportFileType);
  } else {
      saveSvgAsPng(this.epiCurveSVGElement.nativeElement, this.EpiExportFileName + '.' + this.EpiExportFileType, {
          scale: this.SelectedNetworkExportScaleVariable,
          backgroundColor: "#ffffff",
          encoderType: 'image/' + this.EpiExportFileType,
          //encoderOptions: this.SelectedNetworkExportQualityVariable
      });
  }
  this.ShowEpiExportPane = false;
}

openRefreshScreen() {

}

onLoadNewData() {
  this.widgets = this.commonService.session.style.widgets;
  this.setDefaultsWidgets();
  this.updateFieldLists();
  this.updateSettingsRows();

  if (!this.epiCurveElement?.nativeElement || !this.epiCurveSVGElement?.nativeElement) {
    setTimeout(() => {
      if (!this.isDestroyed) {
        this.onLoadNewData();
      }
    }, 0);
    return;
  }

  this.refresh();
  this.markEpiCurveRendered();
  this.cdref.detectChanges();
}
onFilterDataChange() {
  if (!this.epiCurveElement?.nativeElement || !this.epiCurveSVGElement?.nativeElement) {
    return;
  }

  this.refresh();
}


}



export namespace TimelineComponent {
  export const componentTypeName = 'Epi Curve';
}
