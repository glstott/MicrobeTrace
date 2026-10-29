import type { ForceGraph3DInstance } from '3d-force-graph';
import {
  finiteThreeDPoint, ThreeDGraphData, ThreeDLink, ThreeDNode, ThreeDPoint,
  ThreeDSettings, ThreeDViewState,
} from './three-d-network.model';

interface OrbitControls {
  target: ThreeDPoint;
  update(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export class ThreeDNetworkRenderer {
  private graph: ForceGraph3DInstance<ThreeDNode, ThreeDLink>;
  private data: ThreeDGraphData = { nodes: [], links: [] };
  private frozen = false;
  private destroyed = false;
  private fitOnSettle = false;
  private restoringPositions = false;
  private positions = new Map<string, ThreeDPoint>();
  private cameraChanged: () => void;
  private contextLost: (event: Event) => void;

  static async create(
    host: HTMLElement,
    onSelect: (id: string | null, event: MouseEvent) => void,
    onStateChange: () => void,
    onContextLost: () => void,
  ): Promise<ThreeDNetworkRenderer> {
    const { default: ForceGraph3D } = await import('3d-force-graph');
    return new ThreeDNetworkRenderer(new ForceGraph3D(host, {
      controlType: 'orbit', rendererConfig: { antialias: true, preserveDrawingBuffer: true },
    }) as ForceGraph3DInstance<ThreeDNode, ThreeDLink>, onSelect, onStateChange, onContextLost);
  }

  private constructor(
    graph: ForceGraph3DInstance<ThreeDNode, ThreeDLink>,
    onSelect: (id: string | null, event: MouseEvent) => void,
    onStateChange: () => void,
    onContextLost: () => void,
  ) {
    this.graph = graph;
    this.graph.enableNodeDrag(false).showNavInfo(false)
      .nodeId('id').nodeOpacity(1).nodeResolution(8)
      .nodeLabel(node => this.label(node.tooltip)).linkLabel(link => this.label(link.tooltip))
      .onNodeClick((node, event) => onSelect(node.id, event))
      .onBackgroundClick(event => onSelect(null, event))
      .warmupTicks(0).cooldownTicks(150).cooldownTime(6000)
      .onEngineStop(() => {
        if (this.destroyed) return;
        if (this.fitOnSettle) {
          this.fitOnSettle = false;
          this.fit();
        }
        onStateChange();
      });
    this.cameraChanged = () => { this.fitOnSettle = false; onStateChange(); };
    this.controls.addEventListener('end', this.cameraChanged);
    this.contextLost = event => { event.preventDefault(); this.setVisible(false); onContextLost(); };
    this.canvas.addEventListener('webglcontextlost', this.contextLost);
    // Cap the backing-buffer cost on high-density displays.
    this.graph.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  }

  private get controls(): OrbitControls { return this.graph.controls() as OrbitControls; }
  get canvas(): HTMLCanvasElement { return this.graph.renderer().domElement; }
  get nodes(): ReadonlyMap<string, ThreeDNode> { return new Map(this.data.nodes.map(node => [node.id, node])); }
  get savedPositions(): ReadonlyMap<string, ThreeDPoint> { return this.positions; }

  private label(text: string): HTMLElement | string {
    if (!text) return '';
    const element = document.createElement('span');
    element.textContent = text;
    element.style.cssText = 'color:#222;background:#fff;border:1px solid #aaa;border-radius:4px;padding:4px;white-space:pre-wrap;';
    return element;
  }

  setData(data: ThreeDGraphData, settings: ThreeDSettings, background: string): void {
    this.capturePositions();
    const topologyChanged = data.nodes.length !== this.data.nodes.length || data.links.length !== this.data.links.length
      || data.nodes.some((node, i) => node.id !== this.data.nodes[i]?.id)
      || data.links.some((link, i) => link.key !== this.data.links[i]?.key);
    if (topologyChanged) {
      const preserveRestoredPositions = this.restoringPositions && data.nodes.every(node => this.positions.has(node.id));
      data.nodes.forEach((node, index) => {
        if (!finiteThreeDPoint(node)) Object.assign(node, this.positions.get(node.id));
        if (this.frozen || preserveRestoredPositions) this.fixNode(node, index);
        else { delete node.fx; delete node.fy; delete node.fz; }
      });
      this.restoringPositions = false;
      this.data = data;
      this.graph.graphData(data);
    } else {
      // Keep the force engine's resolved link objects; only their display properties change.
      data.links.forEach((link, i) => Object.assign(this.data.links[i], { color: link.color, tooltip: link.tooltip }));
    }
    this.graph.nodeColor(node => node.color).nodeVal(node => node.value)
      .nodeRelSize(settings.nodeSize).linkColor(link => link.color)
      .linkWidth(settings.linkWidth).linkOpacity(1 - settings.linkTransparency)
      .backgroundColor(background);
  }

  restore(state: ThreeDViewState | null): void {
    this.positions = new Map(Object.entries(state?.positions ?? {}));
    this.data = { nodes: [], links: [] };
    this.graph.graphData(this.data);
    this.frozen = state?.layoutFrozen === true;
    this.restoringPositions = Boolean(state);
    this.fitOnSettle = !state;
    if (state) this.graph.cameraPosition(state.camera.position, state.camera.target, 0);
  }

  private capturePositions(): void {
    this.data.nodes.forEach(node => {
      const point = finiteThreeDPoint(node);
      if (point) this.positions.set(node.id, point);
    });
  }

  getState(validIds?: ReadonlySet<string>): ThreeDViewState {
    this.capturePositions();
    if (validIds) this.positions.forEach((_, id) => { if (!validIds.has(id)) this.positions.delete(id); });
    return {
      version: 1,
      camera: { position: finiteThreeDPoint(this.graph.cameraPosition())!, target: finiteThreeDPoint(this.controls.target)! },
      positions: Object.fromEntries(this.positions), layoutFrozen: this.frozen,
    };
  }

  resize(width: number, height: number): void {
    if (width > 0 && height > 0) this.graph.width(Math.round(width)).height(Math.round(height));
  }

  fit(): void { if (this.data.nodes.length) this.graph.zoomToFit(0, 35); }
  resetCamera(): void { this.graph.cameraPosition({ x: 0, y: 0, z: 1000 }, { x: 0, y: 0, z: 0 }); this.fit(); }

  zoom(factor: number): void {
    const position = this.graph.cameraPosition();
    const target = this.controls.target;
    this.graph.cameraPosition({
      x: target.x + (position.x - target.x) * factor,
      y: target.y + (position.y - target.y) * factor,
      z: target.z + (position.z - target.z) * factor,
    }, target);
  }

  private fixNode(node: ThreeDNode, index: number): void {
    // New nodes in a frozen view still need a finite initial position.
    const radius = 20 * Math.cbrt(index + 1);
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const point = finiteThreeDPoint(node) ?? { x: radius * Math.cos(angle), y: radius * Math.sin(angle), z: index % 2 ? radius / 2 : -radius / 2 };
    Object.assign(node, point, { fx: point.x, fy: point.y, fz: point.z, vx: 0, vy: 0, vz: 0 });
  }

  setFrozen(frozen: boolean): void {
    this.frozen = frozen;
    this.data.nodes.forEach((node, index) => {
      if (frozen) this.fixNode(node, index);
      else { delete node.fx; delete node.fy; delete node.fz; }
    });
    if (!frozen) this.graph.d3ReheatSimulation();
  }

  recalculate(): void {
    this.positions.clear();
    this.frozen = false;
    this.data.nodes.forEach(node => {
      for (const key of ['x', 'y', 'z', 'fx', 'fy', 'fz', 'vx', 'vy', 'vz']) delete node[key];
    });
    this.fitOnSettle = true;
    this.graph.graphData(this.data).d3ReheatSimulation();
  }

  setVisible(visible: boolean): void {
    if (visible) this.graph.resumeAnimation();
    else this.graph.pauseAnimation();
  }

  snapshot(): HTMLCanvasElement {
    this.graph.renderer().render(this.graph.scene(), this.graph.camera());
    const canvas = document.createElement('canvas');
    canvas.width = this.canvas.width;
    canvas.height = this.canvas.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to prepare the 3D image.');
    context.drawImage(this.canvas, 0, 0);
    return canvas;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const renderer = this.graph.renderer();
    this.controls.removeEventListener('end', this.cameraChanged);
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.graph.onNodeClick(() => {}).onBackgroundClick(() => {}).onEngineStop(() => {});
    this.graph._destructor();
    renderer.forceContextLoss();
    this.graph = null;
    this.cameraChanged = null;
    this.contextLost = null;
    this.data = { nodes: [], links: [] };
    this.positions.clear();
  }
}
