import { Injectable } from '@angular/core';
import { saveAs } from 'file-saver';
import { CommonService } from './common.service';
import { investigationSoftware } from './investigation-session.service';
import { InvestigationFigure, InvestigationFigureEvidence, investigationCopy, investigationNodeId, investigationEdgeId, investigationChecksum, investigationFigureChecksum } from './investigation-state';

export interface InvestigationImageExport {
  record(content: Blob | string, filename: string): Promise<void>;
  save(content: Blob | string, filename: string): Promise<void>;
  cancel(): void;
}

/** Retain the exact downloaded image, without retaining renderers or regenerating historical figures. */
@Injectable({ providedIn: 'root' })
export class InvestigationFigureService {
  private pending = new Map<any, Set<Promise<void>>>();
  constructor(private common: CommonService) {}

  begin(view: string, options: Record<string, any> = {}): InvestigationImageExport {
    const session = this.common.session;
    const workspace = this.common.investigationSessions.workspace(session);
    const data = investigationCopy(session.data);
    // Keep only records referenced by an exported figure; never copy the existing image archive into itself.
    const evidence: InvestigationFigureEvidence = investigationCopy({ version: 1, data, files: session.files || [],
      cohorts: workspace.cohorts, selectedCohortIds: workspace.selectedCohortIds, edgeLayers: workspace.edgeLayers,
      scopes: workspace.scopes, calculations: workspace.calculations });
    const context: InvestigationFigure['context'] = {
      inputChecksum: '', settings: investigationCopy(session.style.widgets), filters: investigationCopy(session.state || {}),
      viewStates: this.captureViewStates(view, workspace.viewStates || {}),
      nodeIds: data.nodes.map(investigationNodeId), edgeIds: data.links.map(investigationEdgeId),
      visibleNodeIds: data.nodes.filter(node => node.visible !== false).map(investigationNodeId),
      visibleEdgeIds: data.links.filter(link => link.visible !== false).map(investigationEdgeId),
      selectedCohortIds: [...workspace.selectedCohortIds], enabledLayerIds: workspace.edgeLayers.filter(layer => layer.enabled).map(layer => layer.id),
      calculationIds: Object.values(workspace.calculations).filter(Boolean).map(run => run.id), options: investigationCopy(options),
    };
    const exportedAt = new Date().toISOString(), software = investigationSoftware();
    let finish: () => void;
    const done = new Promise<void>(resolve => finish = resolve);
    const pending = this.pending.get(session) || new Set<Promise<void>>();
    this.pending.set(session, pending); pending.add(done);
    let settled = false;
    const cancel = () => { if (!settled) { settled = true; pending.delete(done); if (!pending.size) this.pending.delete(session); finish(); } };
    const record = async (content: Blob | string, filename: string) => {
      if (settled) return;
      try {
        const blob = typeof content === 'string' ? await this.blobFromDataUrl(content) : content;
        const mimeType = blob.type.split(';')[0] as InvestigationFigure['mimeType'];
        if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(mimeType)) throw new Error('The exported image format cannot be included in the report.');
        const dataUrl = await this.dataUrl(new Blob([blob], { type: mimeType }));
        const image = new Image(); image.src = dataUrl; await image.decode();
        if (!image.naturalWidth || !image.naturalHeight) throw new Error('The exported image has no visible dimensions.');
        context.inputChecksum = await investigationChecksum(data);
        const evidenceId = await investigationChecksum(evidence);
        const sha256 = await investigationFigureChecksum(new Uint8Array(await blob.arrayBuffer()));
        // A late image from a replaced investigation must never attach to the newly opened one.
        if (this.common.session !== session) return;
        const figure: InvestigationFigure = { id: crypto.randomUUID(), view, filename, mimeType, dataUrl, sha256, exportedAt, software, evidenceId,
          width: image.naturalWidth, height: image.naturalHeight, context };
        workspace.figureEvidence = { ...(workspace.figureEvidence || {}), [evidenceId]: evidence };
        workspace.figures = [...(workspace.figures || []), figure];
        this.common.investigationCalculations.notifyChanged(session, 'presentation');
      } finally { cancel(); }
    };
    return { record, cancel, save: async (content, filename) => {
      if (settled) return;
      try {
        const blob = typeof content === 'string' ? await this.blobFromDataUrl(content) : content;
        await record(blob, filename);
        const hook = (window as any).__mtTestSaveAs;
        if (typeof hook === 'function') hook(blob, filename);
        else saveAs(blob, filename);
      } finally { cancel(); }
    } };
  }

  async flush(session: any): Promise<void> {
    await Promise.all([...(this.pending.get(session) || [])]);
  }
  private captureViewStates(view: string, saved: InvestigationFigure['context']['viewStates']): InvestigationFigure['context']['viewStates'] {
    const states = investigationCopy(saved), visuals = this.common.visuals;
    if (!visuals) return states;
    if (view === '2D Network' || view === 'Dashboard') {
      const network = visuals.twoD?.captureInvestigationState?.();
      if (network) states['2D Network'] = investigationCopy({ ...network.viewState, camera: network.camera, positions: network.nodes });
    }
    for (const [name, target] of [['Map', visuals.gisMap], ['Phylogenetic Tree', visuals.phylogenetic], ['Heatmap', visuals.heatmap],
      ['Alignment View', visuals.alignment], ['Table', visuals.tableComp], ['Network Statistics', visuals.networkStatistics]] as const) {
      if (view !== name && view !== 'Dashboard') continue;
      const state = target?.captureInvestigationViewState?.();
      if (state !== undefined) states[name] = investigationCopy(state);
    }
    return states;
  }
  private async blobFromDataUrl(value: string): Promise<Blob> {
    if (!/^data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('The exported image is not a supported embedded image.');
    const [header, body] = value.split(',');
    return new Blob([Uint8Array.from(atob(body), character => character.charCodeAt(0))], { type: header.slice(5, -7) });
  }
  private dataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
  }
}
