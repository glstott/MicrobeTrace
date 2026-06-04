import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Inject, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { SelectItem } from 'primeng/api';
import { saveAs } from 'file-saver';
import { saveSvgAsPng } from 'save-svg-as-png';
import { GoogleTagManagerService } from 'angular-google-tag-manager';
import { Subject, takeUntil } from 'rxjs';
import * as d3 from 'd3';
import moment from 'moment';

import { BaseComponentDirective } from '@app/base-component.directive';
import { CommonService } from '@app/contactTraceCommonServices/common.service';
import { CommonStoreService } from '@app/contactTraceCommonServices/common-store.services';
import { ExportService } from '@app/contactTraceCommonServices/export.service';
import { MicobeTraceNextPluginEvents } from '@app/helperClasses/interfaces';
import { MicrobeTraceNextVisuals } from '@app/microbe-trace-next-plugin-visuals';
import { ComponentContainer } from 'golden-layout';

interface ChainNode {
  id: string;
  node: any;
  date: Date;
  lane: number;
  x: number;
  y: number;
  componentIndex: number;
}

interface ChainLink {
  id: string;
  sourceId: string;
  targetId: string;
  link: any;
}

interface TreeLink {
  id: string;
  source: ChainNode;
  target: ChainNode;
  link: any;
}

interface ChainLayout {
  nodes: ChainNode[];
  treeLinks: TreeLink[];
  extraLinks: TreeLink[];
  missingDateCount: number;
  selectedLinkCount: number;
  componentCount: number;
}

@Component({
  selector: 'transmission-chain-component',
  templateUrl: './transmission-chain.component.html',
  styleUrls: ['./transmission-chain.component.scss'],
  standalone: false
})
export class TransmissionChainComponent extends BaseComponentDirective implements OnInit, MicobeTraceNextPluginEvents, OnDestroy {
  @Output() DisplayGlobalSettingsDialogEvent = new EventEmitter();

  @ViewChild('chainWrapper', { static: false }) chainWrapper: ElementRef<HTMLElement>;
  @ViewChild('chainScroll', { static: false }) chainScroll: ElementRef<HTMLElement>;
  @ViewChild('chainSvg', { static: false }) chainSvg: ElementRef<SVGSVGElement>;
  @ViewChild('chainTooltip', { static: false }) chainTooltip: ElementRef<HTMLElement>;

  viewActive = true;
  settingsOpen = false;
  exportOpen = false;

  widgets: any;
  visuals: MicrobeTraceNextVisuals;

  FieldList: SelectItem[] = [];
  SelectedDateFieldVariable = 'None';
  availableLinkOrigins: string[] = [];
  selectedOriginSet = new Set<string>();

  nodeRadius = 11;
  laneHeight = 32;
  labelSize = 13;

  ChainExportFileType = 'png';
  ChainExportFileName = '';
  SelectedChainExportScaleVariable = 1;
  CalculatedResolution = '';

  statusMessage = 'Select a date field to render the transmission chain.';
  visibleDateNodeCount = 0;
  missingDateCount = 0;
  selectedLinkCount = 0;
  componentCount = 0;

  private destroy$ = new Subject<void>();
  private isDestroyed = false;
  private readonly clusterPalette = [
    '#fb6a64',
    '#dda20a',
    '#8fbd00',
    '#20c785',
    '#1dbac6',
    '#15a9e6',
    '#b76cf0',
    '#f05cb7',
    '#4e79a7',
    '#59a14f',
    '#edc949',
    '#af7aa1'
  ];

  constructor(
    public commonService: CommonService,
    @Inject(BaseComponentDirective.GoldenLayoutContainerInjectionToken) private container: ComponentContainer,
    elRef: ElementRef,
    private cdref: ChangeDetectorRef,
    private gtmService: GoogleTagManagerService,
    private store: CommonStoreService,
    private exportService: ExportService
  ) {
    super(elRef.nativeElement);

    this.visuals = this.commonService.visuals;
    this.commonService.visuals.transmissionChain = this;
    this.widgets = this.commonService.session.style.widgets;
  }

  ngOnInit(): void {
    this.gtmService.pushTag({
      event: 'page_view',
      page_location: '/transmission-chain',
      page_title: 'Transmission Chain View'
    });

    this.setDefaultsWidgets();
    this.syncSettingsFromSession();

    this.container.on('resize', () => this.goldenLayoutComponentResize());
    this.container.on('hide', () => {
      this.viewActive = false;
      this.cdref.detectChanges();
    });
    this.container.on('show', () => {
      this.viewActive = true;
      setTimeout(() => this.goldenLayoutComponentResize(), 0);
      this.cdref.detectChanges();
    });

    $(document).on('node-selected.transmission-chain', () => {
      if (this.viewActive) {
        this.refresh();
      }
    });

    this.store.clusterUpdate$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.refresh());

    this.store.styleFileApplied$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.applyStyleFileSettings());

    this.store.networkUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe((networkUpdated) => {
        if (networkUpdated && this.viewActive) {
          this.syncSettingsFromSession();
          this.refresh();
        }
      });
  }

  ngAfterViewInit(): void {
    this.refresh();
    this.markTransmissionChainRendered();
  }

  ngOnDestroy(): void {
    this.isDestroyed = true;
    this.destroy$.next();
    this.destroy$.complete();
    $(document).off('node-selected.transmission-chain');

    if (this.commonService.visuals.transmissionChain === this) {
      (this.commonService.visuals as any).transmissionChain = null;
    }
  }

  private setDefaultsWidgets(): void {
    if (this.widgets['transmission-chain-date-field'] === undefined) {
      this.widgets['transmission-chain-date-field'] = this.widgets['timeline-date-field'] || 'None';
    }

    if (this.widgets['transmission-chain-link-origins'] === undefined) {
      this.widgets['transmission-chain-link-origins'] = null;
    }

    if (!Number.isFinite(Number(this.widgets['transmission-chain-node-radius']))) {
      this.widgets['transmission-chain-node-radius'] = 11;
    }

    if (!Number.isFinite(Number(this.widgets['transmission-chain-lane-height']))) {
      this.widgets['transmission-chain-lane-height'] = 32;
    }
  }

  private syncSettingsFromSession(): void {
    this.widgets = this.commonService.session.style.widgets;
    this.setDefaultsWidgets();
    this.nodeRadius = this.clampNumber(this.widgets['transmission-chain-node-radius'], 5, 24, 11);
    this.laneHeight = this.clampNumber(this.widgets['transmission-chain-lane-height'], 22, 70, 32);
    this.updateDateFieldList();
    this.updateLinkOrigins();
  }

  private updateDateFieldList(): void {
    const dateFields = this.getDateCapableFields();

    this.FieldList = [{ label: 'None', value: 'None' }];
    dateFields.forEach((field) => {
      this.FieldList.push({
        label: this.commonService.capitalize(String(field).replace(/_/g, ' ')),
        value: field
      });
    });

    const availableValues = new Set(this.FieldList.map((option) => option.value));
    const configured = this.widgets['transmission-chain-date-field'];
    const timelineConfigured = this.widgets['timeline-date-field'];

    if (configured && configured !== 'None' && availableValues.has(configured)) {
      this.SelectedDateFieldVariable = configured;
    } else if (timelineConfigured && timelineConfigured !== 'None' && availableValues.has(timelineConfigured)) {
      this.SelectedDateFieldVariable = timelineConfigured;
    } else {
      this.SelectedDateFieldVariable = dateFields[0] || 'None';
    }

    this.widgets['transmission-chain-date-field'] = this.SelectedDateFieldVariable;
  }

  private getDateCapableFields(): string[] {
    const nodeFields = this.commonService.session.data?.nodeFields || [];
    const nodes = this.commonService.session.data?.nodeFilteredValues || this.commonService.session.data?.nodes || [];

    return nodeFields.filter((field: string) => {
      if (['seq', 'sequence', '_seq', '_seqint', 'data'].includes(field)) {
        return false;
      }

      return nodes.some((node: any) => this.commonService.hasValidTimelineDateValue(node?.[field]));
    });
  }

  private updateLinkOrigins(): void {
    const previousAllSelected = this.widgets['transmission-chain-link-origins'] == null;
    const previousSelected = Array.isArray(this.widgets['transmission-chain-link-origins'])
      ? new Set<string>(this.widgets['transmission-chain-link-origins'])
      : new Set<string>();

    const origins = new Set<string>();
    (this.commonService.session.data?.links || []).forEach((link: any) => {
      this.getLinkOrigins(link).forEach((origin) => origins.add(origin));
    });

    this.availableLinkOrigins = this.sortOrigins(Array.from(origins));

    if (previousAllSelected) {
      this.selectedOriginSet = new Set(this.availableLinkOrigins);
    } else {
      this.selectedOriginSet = new Set(
        this.availableLinkOrigins.filter((origin) => previousSelected.has(origin))
      );
    }
  }

  private sortOrigins(origins: string[]): string[] {
    const order = Array.isArray(this.widgets['link-origin-array-order'])
      ? this.widgets['link-origin-array-order']
      : [];
    const orderIndex = new Map<string, number>();
    order.forEach((origin: string, index: number) => orderIndex.set(origin, index));

    return origins.sort((left, right) => {
      const leftIndex = orderIndex.has(left) ? orderIndex.get(left) : Number.POSITIVE_INFINITY;
      const rightIndex = orderIndex.has(right) ? orderIndex.get(right) : Number.POSITIVE_INFINITY;

      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }

      return left.localeCompare(right);
    });
  }

  onDateFieldChange(): void {
    this.widgets['transmission-chain-date-field'] = this.SelectedDateFieldVariable;
    this.refresh();
  }

  onNodeRadiusChange(): void {
    this.nodeRadius = this.clampNumber(this.nodeRadius, 5, 24, 11);
    this.widgets['transmission-chain-node-radius'] = this.nodeRadius;
    this.refresh();
  }

  onLaneHeightChange(): void {
    this.laneHeight = this.clampNumber(this.laneHeight, 22, 70, 32);
    this.widgets['transmission-chain-lane-height'] = this.laneHeight;
    this.refresh();
  }

  isLinkOriginSelected(origin: string): boolean {
    return this.selectedOriginSet.has(origin);
  }

  toggleLinkOrigin(origin: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;

    if (checked) {
      this.selectedOriginSet.add(origin);
    } else {
      this.selectedOriginSet.delete(origin);
    }

    this.persistSelectedOrigins();
    this.refresh();
  }

  selectAllLinkOrigins(): void {
    this.selectedOriginSet = new Set(this.availableLinkOrigins);
    this.widgets['transmission-chain-link-origins'] = null;
    this.refresh();
  }

  clearLinkOrigins(): void {
    this.selectedOriginSet = new Set<string>();
    this.widgets['transmission-chain-link-origins'] = [];
    this.refresh();
  }

  private persistSelectedOrigins(): void {
    const allSelected = this.availableLinkOrigins.length > 0
      && this.availableLinkOrigins.every((origin) => this.selectedOriginSet.has(origin));

    this.widgets['transmission-chain-link-origins'] = allSelected
      ? null
      : Array.from(this.selectedOriginSet);
  }

  refresh(): void {
    if (!this.chainSvg?.nativeElement) {
      if (!this.isDestroyed) {
        setTimeout(() => this.refresh(), 0);
      }
      return;
    }

    this.syncSettingsWithoutChoosingNewDate();
    this.renderChain();
  }

  private syncSettingsWithoutChoosingNewDate(): void {
    this.widgets = this.commonService.session.style.widgets;
    this.setDefaultsWidgets();
    this.nodeRadius = this.clampNumber(this.widgets['transmission-chain-node-radius'], 5, 24, 11);
    this.laneHeight = this.clampNumber(this.widgets['transmission-chain-lane-height'], 22, 70, 32);
    this.updateLinkOrigins();
  }

  private renderChain(): void {
    const svgElement = this.chainSvg.nativeElement;
    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();

    const wrapperRect = this.chainWrapper?.nativeElement?.getBoundingClientRect();
    const wrapperWidth = Math.max(720, Math.round(wrapperRect?.width || this.container.width || 900));
    const wrapperHeight = Math.max(420, Math.round((wrapperRect?.height || this.container.height || 650) - 8));

    svg
      .attr('width', wrapperWidth)
      .attr('height', wrapperHeight)
      .attr('viewBox', `0 0 ${wrapperWidth} ${wrapperHeight}`)
      .attr('role', 'img')
      .attr('aria-label', 'Transmission Chain View');

    svg.append('rect')
      .attr('width', wrapperWidth)
      .attr('height', wrapperHeight)
      .attr('fill', '#ffffff');

    if (this.SelectedDateFieldVariable === 'None') {
      this.statusMessage = 'Select a date field to render the transmission chain.';
      this.drawEmptyMessage(svg, wrapperWidth, wrapperHeight, this.statusMessage);
      this.updateSummary({ nodes: [], treeLinks: [], extraLinks: [], missingDateCount: 0, selectedLinkCount: 0, componentCount: 0 });
      return;
    }

    const layout = this.buildLayout();
    this.updateSummary(layout);

    if (layout.nodes.length === 0) {
      this.statusMessage = `No visible nodes have valid ${this.SelectedDateFieldVariable} values.`;
      this.drawEmptyMessage(svg, wrapperWidth, wrapperHeight, this.statusMessage);
      return;
    }

    const margin = {
      top: 24,
      right: wrapperWidth < 840 ? 112 : 168,
      bottom: 88,
      left: 56
    };
    const plotWidth = Math.max(360, wrapperWidth - margin.left - margin.right);
    const layoutHeight = Math.max(
      220,
      d3.max(layout.nodes, (node) => node.y + this.nodeRadius + 12) || 220
    );
    const plotHeight = Math.max(220, Math.min(3000, layoutHeight));
    const svgHeight = Math.max(wrapperHeight, margin.top + plotHeight + margin.bottom);

    svg
      .attr('height', svgHeight)
      .attr('viewBox', `0 0 ${wrapperWidth} ${svgHeight}`);

    svg.select('rect')
      .attr('height', svgHeight);

    const dates = layout.nodes.map((node) => node.date);
    const minDate = d3.min(dates) as Date;
    const maxDate = d3.max(dates) as Date;
    const domain = this.padDateDomain(minDate, maxDate);
    const xScale = d3.scaleTime().domain(domain).range([0, plotWidth]);

    layout.nodes.forEach((node) => {
      node.x = xScale(node.date);
    });

    const plot = svg.append('g')
      .attr('class', 'transmission-chain-plot')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    this.drawLinks(plot, layout.extraLinks, 'transmission-chain-extra-link');
    this.drawLinks(plot, layout.treeLinks, 'transmission-chain-tree-link');
    this.drawNodes(plot, layout.nodes);

    this.drawAxis(svg, xScale, margin, plotWidth, plotHeight, svgHeight);
    this.drawLegend(svg, layout.nodes, wrapperWidth, margin);
  }

  private buildLayout(): ChainLayout {
    const visibleNodes = this.commonService.getVisibleNodesIgnoringTimeline(false) || [];
    const nodes: ChainNode[] = [];

    visibleNodes.forEach((node: any) => {
      const id = this.getNodeId(node);
      const value = node?.[this.SelectedDateFieldVariable];

      if (!id || !this.commonService.hasValidTimelineDateValue(value)) {
        return;
      }

      nodes.push({
        id,
        node,
        date: moment(value).toDate(),
        lane: 0,
        x: 0,
        y: 0,
        componentIndex: 0
      });
    });

    nodes.sort((left, right) => {
      const dateCompare = left.date.getTime() - right.date.getTime();
      return dateCompare || left.id.localeCompare(right.id);
    });

    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const links = this.getFilteredLinks(nodesById);
    const adjacency = new Map<string, Array<{ neighborId: string; link: ChainLink }>>();

    nodes.forEach((node) => adjacency.set(node.id, []));
    links.forEach((link) => {
      adjacency.get(link.sourceId)?.push({ neighborId: link.targetId, link });
      adjacency.get(link.targetId)?.push({ neighborId: link.sourceId, link });
    });

    adjacency.forEach((entries) => {
      entries.sort((left, right) => {
        const leftNode = nodesById.get(left.neighborId);
        const rightNode = nodesById.get(right.neighborId);
        const dateCompare = (leftNode?.date.getTime() || 0) - (rightNode?.date.getTime() || 0);
        return dateCompare || left.neighborId.localeCompare(right.neighborId);
      });
    });

    const componentNodeGroups: ChainNode[][] = [];
    const singletonNodes: ChainNode[] = [];
    const visited = new Set<string>();

    nodes.forEach((node) => {
      if (visited.has(node.id)) {
        return;
      }

      const neighbors = adjacency.get(node.id) || [];
      if (neighbors.length === 0) {
        visited.add(node.id);
        singletonNodes.push(node);
        return;
      }

      const queue = [node.id];
      const groupIds: string[] = [];
      visited.add(node.id);

      while (queue.length > 0) {
        const currentId = queue.shift();
        groupIds.push(currentId);

        (adjacency.get(currentId) || []).forEach((entry) => {
          if (!visited.has(entry.neighborId)) {
            visited.add(entry.neighborId);
            queue.push(entry.neighborId);
          }
        });
      }

      componentNodeGroups.push(groupIds.map((id) => nodesById.get(id)).filter(Boolean));
    });

    componentNodeGroups.sort((left, right) => {
      const leftDate = d3.min(left, (node) => node.date.getTime()) || 0;
      const rightDate = d3.min(right, (node) => node.date.getTime()) || 0;
      return leftDate - rightDate || right.length - left.length;
    });

    const treeLinks: TreeLink[] = [];
    const treeLinkIds = new Set<string>();
    let laneOffset = 0;

    componentNodeGroups.forEach((group, componentIndex) => {
      const componentLayout = this.layoutConnectedComponent(group, adjacency, nodesById);
      const laneCount = Math.max(1, componentLayout.laneCount);

      group.forEach((node) => {
        node.componentIndex = componentIndex;
        node.y = (laneOffset + node.lane) * this.laneHeight + this.nodeRadius + 12;
      });

      componentLayout.treeLinks.forEach((link) => {
        treeLinks.push(link);
        treeLinkIds.add(link.id);
      });

      laneOffset += laneCount + 1.25;
    });

    if (singletonNodes.length > 0) {
      const singletonComponentIndex = componentNodeGroups.length;
      singletonNodes.forEach((node) => {
        node.componentIndex = singletonComponentIndex;
        node.lane = 0;
        node.y = (laneOffset + 0.2) * this.laneHeight + this.nodeRadius + 12;
      });
      laneOffset += 1.5;
    }

    const extraLinks = links
      .filter((link) => !treeLinkIds.has(link.id))
      .map((link) => this.toTreeLink(link, nodesById))
      .filter(Boolean);

    return {
      nodes,
      treeLinks,
      extraLinks,
      missingDateCount: Math.max(0, visibleNodes.length - nodes.length),
      selectedLinkCount: links.length,
      componentCount: componentNodeGroups.length + singletonNodes.length
    };
  }

  private layoutConnectedComponent(
    group: ChainNode[],
    adjacency: Map<string, Array<{ neighborId: string; link: ChainLink }>>,
    nodesById: Map<string, ChainNode>
  ): { treeLinks: TreeLink[]; laneCount: number } {
    group.sort((left, right) => {
      const dateCompare = left.date.getTime() - right.date.getTime();
      return dateCompare || left.id.localeCompare(right.id);
    });

    const groupIds = new Set(group.map((node) => node.id));
    const root = group[0];
    const discovered = new Set<string>([root.id]);
    const queue = [root.id];
    const childrenById = new Map<string, string[]>();
    const parentEdgeByChild = new Map<string, ChainLink>();

    group.forEach((node) => childrenById.set(node.id, []));

    while (queue.length > 0) {
      const currentId = queue.shift();
      const neighbors = (adjacency.get(currentId) || [])
        .filter((entry) => groupIds.has(entry.neighborId));

      neighbors.forEach((entry) => {
        if (discovered.has(entry.neighborId)) {
          return;
        }

        discovered.add(entry.neighborId);
        queue.push(entry.neighborId);
        childrenById.get(currentId).push(entry.neighborId);
        parentEdgeByChild.set(entry.neighborId, entry.link);
      });
    }

    const assignLane = (nodeId: string, nextLane: { value: number }): number => {
      const children = (childrenById.get(nodeId) || []).sort((leftId, rightId) => {
        const left = nodesById.get(leftId);
        const right = nodesById.get(rightId);
        const dateCompare = (left?.date.getTime() || 0) - (right?.date.getTime() || 0);
        return dateCompare || leftId.localeCompare(rightId);
      });

      const node = nodesById.get(nodeId);
      if (!node) {
        return nextLane.value;
      }

      if (children.length === 0) {
        node.lane = nextLane.value;
        nextLane.value += 1;
        return node.lane;
      }

      const childLanes = children.map((childId) => assignLane(childId, nextLane));
      node.lane = d3.mean(childLanes) || childLanes[0] || 0;
      return node.lane;
    };

    const nextLane = { value: 0 };
    assignLane(root.id, nextLane);

    group.forEach((node) => {
      if (!Number.isFinite(node.lane)) {
        node.lane = nextLane.value;
        nextLane.value += 1;
      }
    });

    const treeLinks: TreeLink[] = [];
    parentEdgeByChild.forEach((link, childId) => {
      const parentId = link.sourceId === childId ? link.targetId : link.sourceId;
      const source = nodesById.get(parentId);
      const target = nodesById.get(childId);

      if (source && target) {
        treeLinks.push({ id: link.id, source, target, link: link.link });
      }
    });

    return {
      treeLinks,
      laneCount: Math.max(1, nextLane.value)
    };
  }

  private getFilteredLinks(nodesById: Map<string, ChainNode>): ChainLink[] {
    return (this.commonService.getVisibleLinksIgnoringTimeline(true) || [])
      .map((link: any, index: number) => {
        const sourceId = this.getEndpointId(link.source);
        const targetId = this.getEndpointId(link.target);

        return {
          id: this.getLinkId(link, index),
          sourceId,
          targetId,
          link
        };
      })
      .filter((link: ChainLink) => {
        if (!nodesById.has(link.sourceId) || !nodesById.has(link.targetId)) {
          return false;
        }

        return this.getLinkOrigins(link.link).some((origin) => this.selectedOriginSet.has(origin));
      });
  }

  private toTreeLink(link: ChainLink, nodesById: Map<string, ChainNode>): TreeLink | null {
    const source = nodesById.get(link.sourceId);
    const target = nodesById.get(link.targetId);

    if (!source || !target) {
      return null;
    }

    return { id: link.id, source, target, link: link.link };
  }

  private drawLinks(group: d3.Selection<SVGGElement, unknown, null, undefined>, links: TreeLink[], className: string): void {
    group.selectAll(`path.${className}`)
      .data(links)
      .enter()
      .append('path')
      .attr('class', className)
      .attr('d', (link) => this.getOrthogonalPath(link.source, link.target))
      .on('mousemove', (event: MouseEvent, link) => this.showTooltip(event, this.getLinkTooltip(link.link)))
      .on('mouseout', () => this.hideTooltip());
  }

  private drawNodes(group: d3.Selection<SVGGElement, unknown, null, undefined>, nodes: ChainNode[]): void {
    const nodeGroups = group.selectAll('g.transmission-chain-node')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'transmission-chain-node')
      .attr('transform', (node) => `translate(${node.x},${node.y})`)
      .on('click', (event: MouseEvent, node) => {
        event.stopPropagation();
        this.toggleNodeSelection(node);
      })
      .on('mousemove', (event: MouseEvent, node) => this.showTooltip(event, this.getNodeTooltip(node)))
      .on('mouseout', () => this.hideTooltip());

    nodeGroups.append('circle')
      .attr('r', this.nodeRadius)
      .attr('fill', (node) => this.getNodeColor(node).color)
      .attr('fill-opacity', (node) => this.getNodeColor(node).alpha)
      .attr('stroke', (node) => node.node?.selected ? this.widgets['selected-color'] || '#ff8300' : '#000000')
      .attr('stroke-width', (node) => node.node?.selected ? 4 : 2);
  }

  private drawAxis(
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
    xScale: d3.ScaleTime<number, number>,
    margin: { top: number; right: number; bottom: number; left: number },
    plotWidth: number,
    plotHeight: number,
    svgHeight: number
  ): void {
    const axisY = margin.top + plotHeight + 16;
    const domain = xScale.domain();
    const spanDays = Math.max(1, d3.timeDay.count(domain[0], domain[1]));
    const tickCount = Math.max(2, Math.min(10, Math.floor(plotWidth / 95)));
    const formatter = spanDays <= 120
      ? d3.timeFormat('%b %d')
      : spanDays <= 730
        ? d3.timeFormat('%b %Y')
        : d3.timeFormat('%Y');

    svg.append('rect')
      .attr('class', 'transmission-chain-axis-band')
      .attr('x', margin.left)
      .attr('y', axisY - 6)
      .attr('width', plotWidth)
      .attr('height', 11);

    const axis = d3.axisBottom<Date>(xScale)
      .ticks(tickCount)
      .tickSize(0)
      .tickPadding(12)
      .tickFormat((date: Date) => formatter(date));

    const axisGroup = svg.append('g')
      .attr('class', 'transmission-chain-axis')
      .attr('transform', `translate(${margin.left},${axisY})`)
      .call(axis);

    axisGroup.select('.domain').remove();
    axisGroup.selectAll('text')
      .attr('font-size', this.labelSize)
      .attr('transform', 'rotate(-45)')
      .attr('text-anchor', 'end')
      .attr('dx', '-0.45em')
      .attr('dy', '0.45em');

    svg.append('text')
      .attr('class', 'transmission-chain-axis-label')
      .attr('x', margin.left + plotWidth / 2)
      .attr('y', Math.min(svgHeight - 10, axisY + 70))
      .attr('text-anchor', 'middle')
      .attr('font-size', this.labelSize + 3)
      .text(this.commonService.capitalize(String(this.SelectedDateFieldVariable).replace(/_/g, ' ')));
  }

  private drawLegend(
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
    nodes: ChainNode[],
    svgWidth: number,
    margin: { top: number; right: number; bottom: number; left: number }
  ): void {
    const colorItems = this.getLegendItems(nodes);
    if (colorItems.length === 0) {
      return;
    }

    const legendX = svgWidth - margin.right + 22;
    const legend = svg.append('g')
      .attr('class', 'transmission-chain-legend')
      .attr('transform', `translate(${legendX},${margin.top + 6})`);

    const colorVariable = this.widgets['node-color-variable'];
    const title = colorVariable && colorVariable !== 'None'
      ? this.commonService.capitalize(String(colorVariable).replace(/_/g, ' '))
      : 'Cluster';

    legend.append('text')
      .attr('class', 'transmission-chain-legend-title')
      .attr('x', 0)
      .attr('y', 0)
      .text(title);

    colorItems.slice(0, 16).forEach((item, index) => {
      const y = 25 + index * 25;
      legend.append('circle')
        .attr('cx', 8)
        .attr('cy', y)
        .attr('r', 8)
        .attr('fill', item.color)
        .attr('fill-opacity', item.alpha)
        .attr('stroke', '#000000')
        .attr('stroke-width', 1.5);

      legend.append('text')
        .attr('x', 23)
        .attr('y', y + 4)
        .attr('class', 'transmission-chain-legend-label')
        .text(item.label);
    });

    if (colorItems.length > 16) {
      legend.append('text')
        .attr('x', 0)
        .attr('y', 25 + 16 * 25)
        .attr('class', 'transmission-chain-legend-label')
        .text(`+${colorItems.length - 16} more`);
    }
  }

  private getLegendItems(nodes: ChainNode[]): Array<{ label: string; color: string; alpha: number }> {
    const itemsByLabel = new Map<string, { label: string; color: string; alpha: number }>();

    nodes.forEach((node) => {
      const label = this.getNodeColorLabel(node);
      if (!itemsByLabel.has(label)) {
        const color = this.getNodeColor(node);
        itemsByLabel.set(label, { label, color: color.color, alpha: color.alpha });
      }
    });

    return Array.from(itemsByLabel.values());
  }

  private getNodeColor(node: ChainNode): { color: string; alpha: number } {
    const colorVariable = this.widgets['node-color-variable'];

    if (colorVariable && colorVariable !== 'None') {
      return this.commonService.getNodeFillStyle(node.node);
    }

    const index = this.getClusterColorIndex(node);
    return {
      color: this.clusterPalette[index % this.clusterPalette.length],
      alpha: this.clampNumber(1 - Number(this.widgets['node-opacity'] ?? 0), 0, 1, 1)
    };
  }

  private getNodeColorLabel(node: ChainNode): string {
    const colorVariable = this.widgets['node-color-variable'];

    if (colorVariable && colorVariable !== 'None') {
      const value = node.node?.[colorVariable];
      return value == null || value === '' ? '(Empty)' : String(value);
    }

    const clusterValue = this.getClusterValue(node);
    if (typeof clusterValue === 'number' && Number.isFinite(clusterValue)) {
      return `cl_${clusterValue + 1}`;
    }

    if (/^cl_/i.test(String(clusterValue))) {
      return String(clusterValue);
    }

    return `cl_${String(clusterValue)}`;
  }

  private getClusterColorIndex(node: ChainNode): number {
    const value = this.getClusterValue(node);
    const numeric = Number(value);

    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.floor(numeric));
    }

    return Math.abs(this.hashString(String(value))) % this.clusterPalette.length;
  }

  private getClusterValue(node: ChainNode): any {
    return node.node?.cluster ?? node.node?.group ?? node.componentIndex;
  }

  private getOrthogonalPath(source: ChainNode, target: ChainNode): string {
    return `M${source.x},${source.y}V${target.y}H${target.x}`;
  }

  private padDateDomain(minDate: Date, maxDate: Date): [Date, Date] {
    if (!minDate || !maxDate) {
      const now = new Date();
      return [d3.timeDay.offset(now, -1), d3.timeDay.offset(now, 1)];
    }

    if (minDate.getTime() === maxDate.getTime()) {
      return [d3.timeDay.offset(minDate, -1), d3.timeDay.offset(maxDate, 1)];
    }

    const span = maxDate.getTime() - minDate.getTime();
    const padding = Math.max(span * 0.04, 24 * 60 * 60 * 1000);
    return [new Date(minDate.getTime() - padding), new Date(maxDate.getTime() + padding)];
  }

  private updateSummary(layout: ChainLayout): void {
    this.visibleDateNodeCount = layout.nodes.length;
    this.missingDateCount = layout.missingDateCount;
    this.selectedLinkCount = layout.selectedLinkCount;
    this.componentCount = layout.componentCount;

    if (this.SelectedDateFieldVariable === 'None') {
      this.statusMessage = 'Select a date field to render the transmission chain.';
      return;
    }

    this.statusMessage = `${layout.nodes.length.toLocaleString()} dated nodes, ${layout.selectedLinkCount.toLocaleString()} selected links`;
  }

  private drawEmptyMessage(
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
    width: number,
    height: number,
    message: string
  ): void {
    svg.append('text')
      .attr('class', 'transmission-chain-empty')
      .attr('x', width / 2)
      .attr('y', height / 2)
      .attr('text-anchor', 'middle')
      .text(message);
  }

  private showTooltip(event: MouseEvent, html: string): void {
    if (!this.chainTooltip?.nativeElement || !this.chainWrapper?.nativeElement) {
      return;
    }

    const rect = this.chainWrapper.nativeElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const tooltip = this.chainTooltip.nativeElement;
    tooltip.innerHTML = html;
    tooltip.style.left = `${x + 16}px`;
    tooltip.style.top = `${y + 14}px`;
    tooltip.style.opacity = '1';
    tooltip.style.zIndex = '1000';
  }

  private hideTooltip(): void {
    if (!this.chainTooltip?.nativeElement) {
      return;
    }

    this.chainTooltip.nativeElement.style.opacity = '0';
    this.chainTooltip.nativeElement.style.zIndex = '-1';
  }

  private getNodeTooltip(node: ChainNode): string {
    const label = this.escapeHtml(node.node?.label ?? node.id);
    const dateValue = moment(node.date).format('MMM D, YYYY');
    const colorVariable = this.widgets['node-color-variable'];
    const colorRow = colorVariable && colorVariable !== 'None'
      ? `<tr><th>${this.escapeHtml(this.commonService.capitalize(String(colorVariable)))}</th><td>${this.escapeHtml(node.node?.[colorVariable] ?? '(Empty)')}</td></tr>`
      : `<tr><th>Cluster</th><td>${this.escapeHtml(this.getNodeColorLabel(node))}</td></tr>`;

    return `
      <table>
        <tbody>
          <tr><th>ID</th><td>${label}</td></tr>
          <tr><th>${this.escapeHtml(this.commonService.capitalize(String(this.SelectedDateFieldVariable)))}</th><td>${this.escapeHtml(dateValue)}</td></tr>
          ${colorRow}
        </tbody>
      </table>
    `;
  }

  private getLinkTooltip(link: any): string {
    const origins = this.getLinkOrigins(link).join(', ');
    const distance = link?.distance == null
      ? ''
      : `<tr><th>Distance</th><td>${this.escapeHtml(this.commonService.formatDisplayedDistanceValue(Number(link.distance), this.widgets['link-sort-variable']))}</td></tr>`;

    return `
      <table>
        <tbody>
          <tr><th>Source</th><td>${this.escapeHtml(this.getEndpointId(link?.source))}</td></tr>
          <tr><th>Target</th><td>${this.escapeHtml(this.getEndpointId(link?.target))}</td></tr>
          <tr><th>Origin</th><td>${this.escapeHtml(origins)}</td></tr>
          ${distance}
        </tbody>
      </table>
    `;
  }

  private toggleNodeSelection(node: ChainNode): void {
    const selected = !node.node?.selected;
    const updateNodeSelection = (candidate: any) => {
      if (this.getNodeId(candidate) === node.id) {
        candidate.selected = selected;
      }
    };

    (this.commonService.session.data.nodes || []).forEach(updateNodeSelection);
    (this.commonService.session.data.nodeFilteredValues || []).forEach(updateNodeSelection);

    $(document).trigger('node-selected');
    window.dispatchEvent(new CustomEvent('node-selected'));
  }

  private getNodeId(node: any): string {
    return String(node?._id ?? node?.id ?? node?.index ?? '');
  }

  private getEndpointId(endpoint: any): string {
    if (endpoint && typeof endpoint === 'object') {
      return String(endpoint._id ?? endpoint.id ?? '');
    }

    return String(endpoint ?? '');
  }

  private getLinkId(link: any, index: number): string {
    return String(link?.id ?? link?.index ?? `${this.getEndpointId(link?.source)}-${this.getEndpointId(link?.target)}-${index}`);
  }

  private getLinkOrigins(link: any): string[] {
    if (Array.isArray(link?.origin)) {
      const origins = link.origin
        .map((origin: any) => String(origin ?? '').trim())
        .filter((origin: string) => origin.length > 0);

      return origins.length > 0 ? origins : ['(Unknown)'];
    }

    if (link?.origin != null && String(link.origin).trim().length > 0) {
      return [String(link.origin).trim()];
    }

    return ['(Unknown)'];
  }

  private clampNumber(value: any, min: number, max: number, fallback: number): number {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, numberValue));
  }

  private hashString(value: string): number {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = ((hash << 5) - hash) + value.charCodeAt(index);
      hash |= 0;
    }

    return hash;
  }

  private escapeHtml(value: any): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private markTransmissionChainRendered(): void {
    if (!this.viewActive) {
      return;
    }

    setTimeout(() => {
      this.store.setNetworkRendered(true);
    }, 0);
  }

  showGlobalSettings(): void {
    this.DisplayGlobalSettingsDialogEvent.emit('Styling');
  }

  openSettings(): void {
    this.settingsOpen = true;
  }

  openCenter(): void {
    if (this.chainScroll?.nativeElement) {
      this.chainScroll.nativeElement.scrollLeft = 0;
      this.chainScroll.nativeElement.scrollTop = 0;
    }
  }

  fit(): void {
    this.openCenter();
  }

  openExport(): void {
    this.setCalculatedResolution();
    this.exportOpen = true;
  }

  setCalculatedResolution(): void {
    const [width, height] = this.getImageDimensions();
    this.CalculatedResolution = `${Math.round(width * this.SelectedChainExportScaleVariable)} x ${Math.round(height * this.SelectedChainExportScaleVariable)}px`;
  }

  updateCalculatedResolution(): void {
    this.setCalculatedResolution();
    this.cdref.detectChanges();
  }

  private getImageDimensions(): [number, number] {
    const svg = this.chainSvg?.nativeElement;
    if (!svg) {
      return [0, 0];
    }

    return [
      Number(svg.getAttribute('width')) || svg.clientWidth || 0,
      Number(svg.getAttribute('height')) || svg.clientHeight || 0
    ];
  }

  exportVisualization(): void {
    const filename = this.ChainExportFileName || 'transmission-chain';

    if (this.ChainExportFileType === 'svg') {
      const content = this.exportService.unparseSVG(this.chainSvg.nativeElement as unknown as HTMLElement);
      const blob = new Blob([content], { type: 'image/svg+xml;charset=utf-8' });
      saveAs(blob, `${filename}.svg`);
    } else {
      saveSvgAsPng(this.chainSvg.nativeElement, `${filename}.${this.ChainExportFileType}`, {
        scale: this.SelectedChainExportScaleVariable,
        backgroundColor: '#ffffff',
        encoderType: `image/${this.ChainExportFileType}`
      });
    }

    this.exportOpen = false;
  }

  goldenLayoutComponentResize(): void {
    this.refresh();
    if (this.exportOpen) {
      this.setCalculatedResolution();
    }
  }

  updateNodeColors(): void {
    this.refresh();
  }

  updateVisualization(): void {
    this.refresh();
  }

  applyStyleFileSettings(): void {
    this.syncSettingsFromSession();
    this.refresh();
  }

  updateLinkColor(): void {
    this.refresh();
  }

  refreshDistanceDisplayFormat(): void {
    this.refresh();
  }

  loadSettings(): void {
    this.syncSettingsFromSession();
    this.refresh();
  }

  openRefreshScreen(): void {}

  onRecallSession(): void {
    this.syncSettingsFromSession();
    this.refresh();
  }

  onLoadNewData(): void {
    this.syncSettingsFromSession();

    if (!this.chainSvg?.nativeElement) {
      setTimeout(() => {
        if (!this.isDestroyed) {
          this.onLoadNewData();
        }
      }, 0);
      return;
    }

    this.refresh();
    this.markTransmissionChainRendered();
    this.cdref.detectChanges();
  }

  onFilterDataChange(): void {
    this.refresh();
  }
}

export namespace TransmissionChainComponent {
  export const componentTypeName = 'Transmission Chain';
}
