import { ChangeDetectionStrategy, Component, EventEmitter, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonService } from './contactTraceCommonServices/common.service';
import {
  INVESTIGATION_OPERATIONS, InvestigationOperation, InvestigationCohort, InvestigationLayer,
  InvestigationAnnotation, CalculationScope, investigationScope, investigationNodeId,
  investigationAnnotationResolved,
} from './contactTraceCommonServices/investigation-state';

@Component({
  selector: 'app-investigation-panel', standalone: false,
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './investigation-panel.component.html',
  styles: [`:host{display:block;color:var(--text-color,#23364b)}.investigation-save{padding:16px;border:1px solid #ccd5df;border-radius:6px;margin-bottom:16px}.investigation-save p{margin-bottom:12px}summary{cursor:pointer;font-weight:600;padding:12px 0}details details{border-top:1px solid #ccd5df}section{padding:0 0 12px}label{font-weight:500}.row-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}.entry{padding:10px 0;border-top:1px solid #e1e5eb}.name{flex:1;min-width:160px}.muted{font-size:.875rem;color:#55657a}.note{white-space:pre-wrap}.scope-row{display:grid;grid-template-columns:1fr 130px 1.4fr auto;gap:10px;align-items:center;padding:8px 0}select,input,textarea{max-width:100%}textarea{width:100%;min-height:70px}@media(max-width:600px){.scope-row{grid-template-columns:1fr 1fr}.scope-row small{grid-column:1/-1}}`],
})
export class InvestigationPanelComponent implements OnInit, OnDestroy {
  @Output() saveInvestigation = new EventEmitter<void>();
  @Output() downloadRecord = new EventEmitter<void>();
  readonly operations = INVESTIGATION_OPERATIONS;
  cohortName = '';
  noteText = '';
  noteTargetType: InvestigationAnnotation['target']['type'] = 'investigation';
  noteTargetId = '';
  error = '';
  status = '';
  running: string | null = null;
  previews: Record<string, string> = {};
  readonly cohortNameDrafts = new WeakMap<InvestigationCohort, string>();
  readonly cohortNameErrors = new WeakMap<InvestigationCohort, string>();
  readonly noteDrafts = new WeakMap<InvestigationAnnotation, string>();
  readonly noteErrors = new WeakMap<InvestigationAnnotation, string>();
  private refreshTimer: ReturnType<typeof setInterval>;
  constructor(public readonly common: CommonService) {}
  get workspace() { return this.common.investigationSessions.workspace(this.common.session); }
  ngOnInit(): void {
    this.common.investigationSessions.syncLayers(this.common.session);
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), 2000);
  }
  ngOnDestroy(): void { clearInterval(this.refreshTimer); }
  private refresh(): void {
    this.common.investigationSessions.syncLayers(this.common.session);
    this.common.investigationCalculations.refreshStatus(this.common.session);
    for (const operation of this.operations) {
      try {
        const options = this.operationOptions(operation.id);
        const input = this.common.investigationCalculations.resolve(this.common.session, operation.id, options);
        this.previews[operation.id] = options.sequence ? `${input.nodes.length} eligible sequences`
          : `${input.nodes.length} eligible nodes${operation.id === 'threshold-analysis' ? '' : ` · ${input.links.length} edges`}`;
      } catch (error) { this.previews[operation.id] = (error as Error).message; }
    }
  }
  changed(updateNetwork = false): void {
    this.error = '';
    this.common.investigationCalculations.refreshStatus(this.common.session);
    if (updateNetwork) {
      this.common.session.style.widgets['link-origin-array-order'] = this.workspace.edgeLayers.map(layer => layer.source);
      this.common.invalidateInvestigationInputs();
      this.common.updateNetworkVisuals(false, true);
    }
    this.refresh();
  }
  private selectedNodes(): string[] { return this.common.session.data.nodes.filter(node => node.selected).map(investigationNodeId); }
  createCohort(): void {
    const members = this.selectedNodes();
    if (!this.cohortName.trim() || !members.length) { this.error = 'Name the cohort and select at least one node first.'; return; }
    this.workspace.cohorts.push({ id: crypto.randomUUID(), name: this.cohortName.trim(), nodeIds: members });
    this.cohortName = '';
    this.changed();
  }
  renameCohort(cohort: InvestigationCohort): void {
    const name = (this.cohortNameDrafts.get(cohort) ?? cohort.name).trim();
    if (!name) {
      this.cohortNameErrors.set(cohort, 'Enter a name. The previous cohort name will be saved.');
      return;
    }
    this.cohortNameDrafts.delete(cohort);
    this.cohortNameErrors.delete(cohort);
    if (cohort.name !== name) { cohort.name = name; this.changed(); }
  }
  replaceMembership(cohort: InvestigationCohort): void {
    const ids = this.selectedNodes();
    if (!ids.length) { this.error = 'Select at least one node before replacing cohort membership.'; return; }
    cohort.nodeIds = ids;
    this.changed();
  }
  selectMembers(cohort: InvestigationCohort): void {
    const ids = new Set(cohort.nodeIds);
    for (const node of this.common.session.data.nodes) node.selected = ids.has(investigationNodeId(node));
    $(document).trigger('node-selected');
    window.dispatchEvent(new Event('node-selected'));
    this.status = `Selected ${cohort.nodeIds.length} cohort members.`;
  }
  toggleCohort(id: string, selected: boolean): void {
    this.workspace.selectedCohortIds = selected ? Array.from(new Set([...this.workspace.selectedCohortIds, id])) : this.workspace.selectedCohortIds.filter(value => value !== id);
    this.changed();
  }
  deleteCohort(id: string): void {
    this.workspace.cohorts = this.workspace.cohorts.filter(cohort => cohort.id !== id);
    this.workspace.selectedCohortIds = this.workspace.selectedCohortIds.filter(value => value !== id);
    this.changed();
  }
  moveLayer(layer: InvestigationLayer, offset: number): void {
    const layers = this.workspace.edgeLayers;
    const index = layers.indexOf(layer), target = index + offset;
    if (target < 0 || target >= layers.length) return;
    [layers[index], layers[target]] = [layers[target], layers[index]];
    this.changed(true);
  }
  layerOpacity(layer: InvestigationLayer, value: string): void { layer.opacity = Number(value); this.changed(true); }
  clearLayerStyle(layer: InvestigationLayer): void { delete layer.color; delete layer.opacity; this.changed(true); }
  addNote(): void {
    if (!this.noteText.trim()) { this.error = 'Enter a note before saving.'; return; }
    const time = new Date().toISOString();
    const note: InvestigationAnnotation = { id: crypto.randomUUID(), text: this.noteText.trim(),
      target: { type: this.noteTargetType, ...(this.noteTargetType === 'investigation' ? {} : { id: this.noteTargetId.trim() }) }, createdAt: time, updatedAt: time };
    if (!this.resolved(note)) { this.error = 'Choose an existing target ID for the note.'; return; }
    this.workspace.annotations.push(note);
    this.noteText = '';
    this.changed();
  }
  updateNote(note: InvestigationAnnotation): void {
    const text = (this.noteDrafts.get(note) ?? note.text).trim();
    if (!text) {
      this.noteErrors.set(note, 'Enter text or delete this note. The previous note text will be saved.');
      return;
    }
    this.noteDrafts.delete(note);
    this.noteErrors.delete(note);
    if (note.text !== text) { note.text = text; note.updatedAt = new Date().toISOString(); this.changed(); }
  }
  deleteNote(id: string): void { this.workspace.annotations = this.workspace.annotations.filter(note => note.id !== id); this.changed(); }
  resolved(note: InvestigationAnnotation): boolean { return investigationAnnotationResolved(note, this.common.session, this.workspace); }
  scope(operation: InvestigationOperation): CalculationScope { return investigationScope(this.workspace, operation); }
  private operationOptions(operation: InvestigationOperation) {
    return { sequence: ['alignment', 'ambiguity', 'consensus', 'consensus-distances', 'pairwise-distances', 'bootstrap'].includes(operation),
      sweep: operation === 'threshold-analysis', unpruned: ['tree', 'distance-matrix', 'mst', 'nearest-neighbor'].includes(operation) };
  }
  setScope(operation: InvestigationOperation, scope: CalculationScope): void { this.workspace.scopes[operation] = scope; this.changed(); }
  async run(operation: InvestigationOperation): Promise<void> {
    if (this.running) return;
    this.error = ''; this.status = ''; this.running = operation;
    try {
      this.common.investigationCalculations.resolve(this.common.session, operation, this.operationOptions(operation));
      switch (operation) {
        case 'network-statistics': await this.common.computeInvestigationStatistics(); this.common.visuals.networkStatistics?.onRecallSession(); break;
        case 'threshold-analysis': this.common.recalculateInvestigationThreshold(); break;
        case 'mst': await this.common.computeMST(); break;
        case 'nearest-neighbor': await this.common.computeNN(); break;
        case 'directionality': await this.common.computeDirectionality(); break;
        case 'ambiguity': await this.common.computeAmbiguityCounts(); break;
        case 'consensus': this.common.session.data['consensus'] = await this.common.computeConsensus(); break;
        case 'consensus-distances': await this.common.computeConsensusDistances(); break;
        case 'pairwise-distances': await this.common.computeLinks(this.common.session.data.nodes); break;
        case 'distance-matrix': await this.common.getDM(); break;
        case 'alignment': await this.common.align({ nodes: this.common.session.data.nodes, reference: this.common.session.data.reference, aligner: 'bioseq', match: [1, -1], gap: [-1, -0.5] }); break;
        case 'tree': this.common.session.data.newickString = await this.common.computeTree(); this.common.visuals.phylogenetic?.onLoadNewData(); break;
        case 'patristic':
          if (!['newick', 'auspice'].includes(this.common.session.data.newickSource)) throw new Error('Patristic distances require an imported Newick or Auspice tree.');
          await this.common.ensurePatristicEdgesForThreshold(Number(this.common.session.style.widgets['link-threshold'])); break;
        case 'bootstrap':
          if (!this.common.visuals.phylogenetic) throw new Error('Open the Phylogenetic Tree view before calculating bootstrap support.');
          const previous = this.workspace.calculations.bootstrap?.id;
          await this.common.visuals.phylogenetic.calculateBootstrapSupport({ skipConfirmation: true });
          if (this.workspace.calculations.bootstrap?.id === previous) throw new Error(this.common.visuals.phylogenetic.BootstrapStatusMessage || 'Bootstrap support could not be calculated.');
          break;
      }
      if (['mst', 'nearest-neighbor', 'directionality', 'pairwise-distances', 'patristic'].includes(operation)) this.common.updateNetworkVisuals(false, true);
      this.status = 'Calculation finished. Its inputs and completed output are saved with the investigation.';
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    finally { this.running = null; this.refresh(); }
  }
}
