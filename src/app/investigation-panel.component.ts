import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DoCheck, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { CommonService } from './contactTraceCommonServices/common.service';
import { InvestigationCancelledError, InvestigationChange } from './contactTraceCommonServices/investigation-calculation.service';
import {
  INVESTIGATION_OPERATIONS, InvestigationOperation, InvestigationCohort, InvestigationLayer,
  InvestigationAnnotation, CalculationScope, investigationScope, investigationNodeId,
  investigationAnnotationResolved, investigationEdgeId, investigationEndpointId,
} from './contactTraceCommonServices/investigation-state';

const CHANGE_PRIORITY: Record<InvestigationChange, number> = { outcome: 0, presentation: 1, selection: 2, inputs: 3 };
type NoteFilter = 'all' | 'linked' | 'unlinked';
interface NoteReview { note: InvestigationAnnotation; linked: boolean; targetLabel: string; searchText: string }

@Component({
  selector: 'app-investigation-panel', standalone: false,
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './investigation-panel.component.html',
  styles: [`:host{display:block;color:var(--text-color,#23364b)}.investigation-save{padding:16px;border:1px solid #ccd5df;border-radius:6px;margin-bottom:16px}.investigation-save p{margin-bottom:12px}summary{cursor:pointer;font-weight:600;padding:12px 0}details details{border-top:1px solid #ccd5df}section{padding:0 0 12px}label{font-weight:500}.row-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}.entry{padding:10px 0;border-top:1px solid #e1e5eb}.name{flex:1;min-width:160px}.muted{font-size:.875rem;color:#55657a}.note{white-space:pre-wrap}.scope-row{display:grid;grid-template-columns:1fr 130px 1.4fr auto;gap:10px;align-items:center;padding:8px 0}select,input,textarea{max-width:100%}textarea{width:100%;min-height:70px}@media(max-width:600px){.scope-row{grid-template-columns:1fr 1fr}.scope-row small{grid-column:1/-1}}`],
})
export class InvestigationPanelComponent implements OnInit, OnDestroy, DoCheck {
  @Output() saveInvestigation = new EventEmitter<void>();
  @Input() saving = false;
  @ViewChild('noteSearchInput') private noteSearchInput?: ElementRef<HTMLInputElement>;
  readonly operations = INVESTIGATION_OPERATIONS;
  cohortName = '';
  noteText = '';
  noteTargetType: InvestigationAnnotation['target']['type'] = 'investigation';
  noteTargetIds: string[] = [];
  noteTargetOptions: Array<{ id: string; label: string }> = [];
  noteSelection = { nodes: 0, edges: 0 };
  noteTargetPickerOpen = false;
  notesOpen = false;
  noteFilter: NoteFilter = 'all';
  noteSearch = '';
  filteredNotes: NoteReview[] = [];
  private noteReview: NoteReview[] = [];
  private noteDraftSession: any;
  error = '';
  status = '';
  running: string | null = null;
  previews: Record<string, string> = {};
  summary = { completed: 0, stale: 0, linkedNotes: 0, unlinkedNotes: 0 };
  staleResults: Array<{ id: string; label: string; reasons: string[] }> = [];
  readonly cohortNameDrafts = new WeakMap<InvestigationCohort, string>();
  readonly cohortNameErrors = new WeakMap<InvestigationCohort, string>();
  readonly noteDrafts = new WeakMap<InvestigationAnnotation, string>();
  readonly noteErrors = new WeakMap<InvestigationAnnotation, string>();
  toolsOpen = false;
  calculationsOpen = false;
  private previewsDirty = true;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChange: InvestigationChange = 'outcome';
  private changesSubscription: Subscription;
  private destroyed = false;
  private runToken = 0;
  private observedSession: any;
  private observedSettings = '';
  private observedTree: string;
  private observedLabels = '';
  private readonly onSelection = () => this.requestRefresh('selection');
  constructor(public readonly common: CommonService, private readonly cdref: ChangeDetectorRef) {}
  get workspace() { return this.common.investigationSessions.workspace(this.common.session); }
  ngOnInit(): void {
    this.changesSubscription = this.common.investigationCalculations.changes$.subscribe(change => {
      if (change.session === this.common.session) this.requestRefresh(change.kind);
    });
    $(document).on('node-selected.investigationPanel', this.onSelection);
    window.addEventListener('node-selected', this.onSelection);
    this.refresh();
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.runToken++;
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.changesSubscription?.unsubscribe();
    $(document).off('node-selected.investigationPanel', this.onSelection);
    window.removeEventListener('node-selected', this.onSelection);
  }
  // Compare small settings only; graph membership and selections arrive through notifications.
  ngDoCheck(): void {
    const session = this.common.session;
    const settings = this.settingsKey();
    if (session !== this.observedSession || settings !== this.observedSettings || session.data.newickString !== this.observedTree) {
      if (session !== this.observedSession) this.resetForSession();
      this.rememberSettings(settings);
      this.requestRefresh('inputs');
    } else if (this.labelsKey() !== this.observedLabels) {
      this.observedLabels = this.labelsKey();
      this.requestRefresh('presentation');
    }
  }
  private settingsKey(): string {
    const widgets = this.common.session.style.widgets;
    const settings = Object.entries(widgets).filter(([key]) => /^(default-distance-metric|link-sort-variable|link-threshold|link-show-nn|filtering-epsilon|ambiguity-.*|align-sw|tree-round|tree-bootstrap-(custom-replicates|stop-when-stable))$/.test(key));
    return JSON.stringify([settings, this.workspace.scopes, this.workspace.selectedCohortIds]);
  }
  private labelsKey(): string {
    const widgets = this.common.session.style.widgets;
    return JSON.stringify([widgets['node-label-variable'], widgets['link-label-variable']]);
  }
  private rememberSettings(settings = this.settingsKey()): void {
    this.observedSession = this.common.session;
    this.observedSettings = settings;
    this.observedTree = this.common.session.data.newickString;
    this.observedLabels = this.labelsKey();
  }
  private resetForSession(): void {
    if (this.syncNoteDraftSession()) {
      this.runToken++;
      this.running = null;
      this.status = ''; this.error = '';
      this.refreshNoteReview();
    }
  }
  private requestRefresh(kind: InvestigationChange): void {
    if (this.destroyed) return;
    if (CHANGE_PRIORITY[kind] > CHANGE_PRIORITY[this.pendingChange]) this.pendingChange = kind;
    if (this.refreshTimer !== null) return;
    this.refreshTimer = setTimeout(() => {
      const change = this.pendingChange;
      this.refreshTimer = null; this.pendingChange = 'outcome';
      this.refresh(change);
    }, 0);
  }
  private refresh(kind: InvestigationChange = 'inputs'): void {
    if (this.destroyed) return;
    if (CHANGE_PRIORITY[this.pendingChange] > CHANGE_PRIORITY[kind]) kind = this.pendingChange;
    const settings = this.settingsKey();
    if (this.observedSession !== this.common.session || settings !== this.observedSettings
      || this.common.session.data.newickString !== this.observedTree) kind = 'inputs';
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = null; this.pendingChange = 'outcome';
    this.resetForSession();
    this.rememberSettings(settings);
    if (kind === 'inputs' || kind === 'selection') {
      this.noteSelection = { nodes: this.selectedNodes().length, edges: this.selectedNoteEdges().length };
      this.common.investigationCalculations.refreshStatus(this.common.session, kind === 'selection' ? ['network-statistics'] : undefined);
    }
    if (kind === 'inputs') {
      this.common.investigationSessions.syncLayers(this.common.session);
      this.previewsDirty = true;
    }
    if (this.noteTargetPickerOpen && kind !== 'outcome') this.refreshNoteTargets();
    const runs = Object.values(this.workspace.calculations).filter(Boolean);
    this.refreshNoteReview();
    const linkedNotes = this.noteReview.filter(entry => entry.linked).length;
    this.summary = {
      completed: runs.filter(run => run.status === 'completed').length,
      stale: runs.filter(run => run.status === 'stale').length,
      linkedNotes,
      unlinkedNotes: this.workspace.annotations.length - linkedNotes,
    };
    this.staleResults = this.operations.flatMap(operation => {
      const run = this.workspace.calculations[operation.id];
      return run?.status === 'stale' ? [{ id: run.id, label: operation.label,
        reasons: run.staleReasons || ['Exact change details were not recorded for this saved result.'] }] : [];
    });
    this.refreshPreviews();
    this.cdref.markForCheck();
  }
  setToolsOpen(open: boolean): void { this.toolsOpen = open; this.refreshPreviews(); }
  setCalculationsOpen(open: boolean): void { this.calculationsOpen = open; this.refreshPreviews(); }
  private refreshPreviews(): void {
    if (!this.toolsOpen || !this.calculationsOpen || !this.previewsDirty) return;
    for (const operation of this.operations) {
      try {
        const options = this.operationOptions(operation.id);
        const input = this.common.investigationCalculations.resolve(this.common.session, operation.id, options);
        this.previews[operation.id] = options.sequence ? `${input.nodes.length} eligible sequences`
          : `${input.nodes.length} eligible nodes${operation.id === 'threshold-analysis' ? '' : ` · ${input.links.length} edges`}`;
      } catch (error) { this.previews[operation.id] = (error as Error).message; }
    }
    this.previewsDirty = false;
    this.cdref.markForCheck();
  }
  changed(updateNetwork = false, affectsInputs = true): void {
    this.error = '';
    this.status = '';
    if (updateNetwork) {
      this.common.session.style.widgets['link-origin-array-order'] = this.workspace.edgeLayers.map(layer => layer.source);
      this.common.invalidateInvestigationInputs();
      this.common.updateNetworkVisuals(false, true);
    }
    this.refresh(affectsInputs ? 'inputs' : 'presentation');
    if (this.noteTargetType !== 'investigation') this.refreshNoteTargets();
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
    if (cohort.name !== name) { cohort.name = name; this.changed(false, false); }
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

  private syncNoteDraftSession(): boolean {
    if (this.noteDraftSession === this.common.session) return false;
    const replaced = !!this.noteDraftSession;
    this.noteDraftSession = this.common.session;
    this.noteTargetType = 'investigation';
    this.noteTargetIds = [];
    this.noteTargetOptions = [];
    this.noteText = '';
    this.noteTargetPickerOpen = false;
    this.noteFilter = 'all';
    this.noteSearch = '';
    return replaced;
  }

  showNotes(filter: NoteFilter): void {
    this.refresh('presentation');
    this.noteFilter = filter;
    this.noteSearch = '';
    this.toolsOpen = true;
    this.notesOpen = true;
    this.filterNotes();
    this.cdref.detectChanges();
    this.noteSearchInput?.nativeElement.focus();
  }

  setNoteFilter(filter: NoteFilter): void { this.noteFilter = filter; this.filterNotes(); }
  setNoteSearch(search: string): void { this.noteSearch = search; this.filterNotes(); }
  clearNoteFilters(): void { this.noteFilter = 'all'; this.noteSearch = ''; this.filterNotes(); }

  private filterNotes(): void {
    const query = this.noteSearch.trim().toLowerCase();
    this.filteredNotes = this.noteReview.filter(entry =>
      (this.noteFilter === 'all' || entry.linked === (this.noteFilter === 'linked')) && (!query || entry.searchText.includes(query)));
  }

  private refreshNoteReview(): void {
    const data = this.common.session.data, widgets = this.common.session.style.widgets;
    const types = new Set(this.workspace.annotations.map(note => note.target.type));
    const nodes = new Map<string, any>(types.has('node') || types.has('edge') ? data.nodes.map(node => [investigationNodeId(node), node]) : []);
    const links = new Map<string, any>(types.has('edge') ? data.links.map(link => [investigationEdgeId(link), link]) : []);
    const cohorts = new Map(this.workspace.cohorts.map(cohort => [cohort.id, cohort]));
    const nodeName = (id: string) => this.targetName(nodes.get(id), widgets['node-label-variable'], id);
    const label = (name: string, id: string) => name === id ? id : `${name} [${id}]`;
    this.noteReview = this.workspace.annotations.map(note => {
      const { type, id } = note.target;
      let targetLabel: string, linked: boolean;
      if (type === 'investigation') { targetLabel = 'Investigation'; linked = true; }
      else if (type === 'node') { targetLabel = `Node · ${label(nodeName(id), id)}`; linked = nodes.has(id); }
      else if (type === 'cohort') { targetLabel = `Cohort · ${label(cohorts.get(id)?.name || id, id)}`; linked = cohorts.has(id); }
      else {
        const link = links.get(id);
        const ends = link ? `${nodeName(investigationEndpointId(link.source))} — ${nodeName(investigationEndpointId(link.target))}` : id;
        const name = link ? this.targetName(link, widgets['link-label-variable'], '') : '';
        targetLabel = `Edge · ${label(name ? `${ends} · ${name}` : ends, id)}`;
        linked = links.has(id);
      }
      return { note, linked, targetLabel, searchText: `${note.text} ${note.id} ${targetLabel}`.toLowerCase() };
    });
    this.filterNotes();
  }

  setNoteTargetType(type: InvestigationAnnotation['target']['type']): void {
    this.syncNoteDraftSession();
    this.noteTargetType = type;
    this.noteTargetIds = [];
    this.error = '';
    this.refreshNoteTargets();
  }

  private targetName(item: any, field: string, id: string): string {
    const values = [item?.name, item?.Name, item?.label, field && field !== 'None' ? item?.[field] : undefined];
    const value = values.find(value => ['string', 'number'].includes(typeof value) && String(value).trim() && String(value).trim() !== id);
    return value !== undefined ? String(value).trim() : id;
  }

  refreshNoteTargets(): void {
    this.syncNoteDraftSession();
    const data = this.common.session.data, widgets = this.common.session.style.widgets;
    const nodes = new Map<string, any>(data.nodes.map(node => [investigationNodeId(node), node]));
    const nodeName = (id: string) => this.targetName(nodes.get(id), widgets['node-label-variable'], id);
    const label = (name: string, id: string, hidden = false) => `${name === id ? id : `${name} [${id}]`}${hidden ? ' (hidden)' : ''}`;
    let options: typeof this.noteTargetOptions;
    if (this.noteTargetType === 'node') {
      options = data.nodes.map(node => {
        const id = investigationNodeId(node);
        return { id, label: label(nodeName(id), id, node.visible === false) };
      });
    } else if (this.noteTargetType === 'edge') {
      options = data.links.map(link => {
        const id = investigationEdgeId(link);
        const ends = `${nodeName(investigationEndpointId(link.source))} — ${nodeName(investigationEndpointId(link.target))}`;
        const name = this.targetName(link, widgets['link-label-variable'], '');
        return { id, label: label(name ? `${ends} · ${name}` : ends, id, link.visible === false) };
      });
    } else if (this.noteTargetType === 'cohort') {
      options = this.workspace.cohorts.map(cohort => ({ id: cohort.id, label: label(cohort.name, cohort.id) }));
    } else options = [];
    // Keep the picker's keyboard focus and filter stable during periodic refreshes.
    if (options.length !== this.noteTargetOptions.length || options.some((option, index) =>
      option.id !== this.noteTargetOptions[index].id || option.label !== this.noteTargetOptions[index].label)) this.noteTargetOptions = options;
  }

  private selectedNoteEdges(): string[] {
    const ids = new Set<string>([
      ...(this.common.visuals?.twoD?.getSelectedInvestigationEdgeIds?.() || []),
      ...(this.common.visuals?.waterfall?.getSelectedInvestigationEdgeIds?.() || []),
    ]);
    if (!ids.size) return [];
    return this.common.session.data.links.map(investigationEdgeId).filter(id => ids.has(id));
  }

  useNoteSelection(type: 'node' | 'edge'): void {
    this.syncNoteDraftSession();
    const ids = type === 'node' ? this.selectedNodes() : this.selectedNoteEdges();
    if (!ids.length) { this.error = `Select at least one ${type} first, or choose a target by name.`; return; }
    this.setNoteTargetType(type);
    this.noteTargetIds = [...new Set(ids)];
    this.status = `${this.noteTargetIds.length} ${type} target${this.noteTargetIds.length === 1 ? '' : 's'} chosen from the current selection.`;
  }

  addNote(): void {
    if (this.syncNoteDraftSession()) { this.error = 'The investigation changed. Choose targets and enter a note again.'; return; }
    if (!this.noteText.trim()) { this.error = 'Enter a note before saving.'; return; }
    const ids = [...new Set(this.noteTargetIds)];
    if (this.noteTargetType !== 'investigation' && !ids.length) { this.error = 'Choose at least one target by name or use the current selection.'; return; }
    const time = new Date().toISOString();
    const targets = this.noteTargetType === 'investigation' ? [{ type: this.noteTargetType }]
      : ids.map(id => ({ type: this.noteTargetType, id }));
    const notes: InvestigationAnnotation[] = targets.map(target => ({ id: crypto.randomUUID(), text: this.noteText.trim(),
      target, createdAt: time, updatedAt: time }));
    if (notes.some(note => !this.resolved(note))) { this.error = 'A chosen target is no longer available. Choose the targets again; no notes were saved.'; return; }
    this.workspace.annotations = [...this.workspace.annotations, ...notes];
    this.noteText = '';
    this.changed(false, false);
    this.status = notes.length === 1 ? 'Note saved.' : `${notes.length} notes saved, one for each chosen target.`;
  }
  updateNote(note: InvestigationAnnotation): void {
    const text = (this.noteDrafts.get(note) ?? note.text).trim();
    if (!text) {
      this.noteErrors.set(note, 'Enter text or delete this note. The previous note text will be saved.');
      return;
    }
    this.noteDrafts.delete(note);
    this.noteErrors.delete(note);
    if (note.text !== text) { note.text = text; note.updatedAt = new Date().toISOString(); this.changed(false, false); }
  }
  deleteNote(id: string): void { this.workspace.annotations = this.workspace.annotations.filter(note => note.id !== id); this.changed(false, false); }
  resolved(note: InvestigationAnnotation): boolean { return investigationAnnotationResolved(note, this.common.session, this.workspace); }
  outcome(operation: InvestigationOperation) { return this.common.investigationCalculations.lastOutcome(this.common.session, operation); }
  scope(operation: InvestigationOperation): CalculationScope { return investigationScope(this.workspace, operation); }
  private operationOptions(operation: InvestigationOperation) {
    return { sequence: ['alignment', 'ambiguity', 'consensus', 'consensus-distances', 'pairwise-distances', 'bootstrap'].includes(operation),
      sweep: operation === 'threshold-analysis', unpruned: ['tree', 'distance-matrix', 'mst', 'nearest-neighbor'].includes(operation) };
  }
  setScope(operation: InvestigationOperation, scope: CalculationScope): void { this.workspace.scopes[operation] = scope; this.changed(); }
  async run(operation: InvestigationOperation): Promise<void> {
    if (this.running) return;
    const session = this.common.session, token = ++this.runToken;
    const previousOutcomeId = this.common.investigationCalculations.lastOutcome(session, operation)?.id;
    const previousResultId = this.workspace.calculations[operation]?.id;
    const stillCurrent = () => !this.destroyed && token === this.runToken && this.common.session === session;
    this.error = ''; this.status = ''; this.running = operation;
    try {
      this.common.investigationCalculations.resolve(this.common.session, operation, this.operationOptions(operation));
      switch (operation) {
        case 'network-statistics': await this.common.computeInvestigationStatistics(); this.common.visuals.networkStatistics?.onRecallSession(); break;
        case 'threshold-analysis': this.common.recalculateInvestigationThreshold(); await this.common.investigationCalculations.flush(); break;
        case 'mst': await this.common.computeMST(); break;
        case 'nearest-neighbor': await this.common.computeNN(); break;
        case 'directionality': await this.common.computeDirectionality(); break;
        case 'ambiguity': await this.common.computeAmbiguityCounts(); break;
        case 'consensus': {
          const value = await this.common.computeConsensus();
          if (stillCurrent()) session.data['consensus'] = value;
          break;
        }
        case 'consensus-distances': await this.common.computeConsensusDistances(); break;
        case 'pairwise-distances': await this.common.computeLinks(this.common.session.data.nodes); break;
        case 'distance-matrix': await this.common.getDM(); break;
        case 'alignment': await this.common.align({ nodes: this.common.session.data.nodes, reference: this.common.session.data.reference, aligner: 'bioseq', match: [1, -1], gap: [-1, -0.5] }); break;
        case 'tree': {
          const value = await this.common.computeTree();
          if (stillCurrent()) { session.data.newickString = value; this.common.visuals.phylogenetic?.onLoadNewData(); }
          break;
        }
        case 'patristic':
          if (!['newick', 'auspice'].includes(this.common.session.data.newickSource)) throw new Error('Patristic distances require an imported Newick or Auspice tree.');
          await this.common.ensurePatristicEdgesForThreshold(Number(this.common.session.style.widgets['link-threshold'])); break;
        case 'bootstrap':
          if (!this.common.visuals.phylogenetic) throw new Error('Open the Phylogenetic Tree view before calculating bootstrap support.');
          await this.common.visuals.phylogenetic.calculateBootstrapSupport({ skipConfirmation: true });
          break;
      }
      if (!stillCurrent()) return;
      const outcome = this.common.investigationCalculations.lastOutcome(session, operation);
      if (outcome && outcome.id !== previousOutcomeId && outcome.status !== 'completed') {
        if (outcome.status === 'failed') throw new Error(outcome.reason || 'The calculation failed.');
        this.status = outcome.status === 'cancelled' ? outcome.reason || 'Calculation cancelled.'
          : `Calculation skipped. ${outcome.reason || 'No new result was produced.'}${previousResultId ? ' Previous completed result retained.' : ''}`;
        return;
      }
      const result = this.workspace.calculations[operation];
      if (!result || (result.id === previousResultId && !['tree', 'distance-matrix'].includes(operation))) {
        const reason = operation === 'bootstrap' ? this.common.visuals.phylogenetic?.BootstrapStatusMessage : '';
        this.status = `Calculation skipped. ${reason || 'No new completed result was produced.'}${previousResultId ? ' Previous completed result retained.' : ''}`;
        return;
      }
      if (['mst', 'nearest-neighbor', 'directionality', 'pairwise-distances', 'patristic'].includes(operation)) this.common.updateNetworkVisuals(false, true);
      this.status = result.id === previousResultId ? 'Using the previously completed result. Its inputs and output remain saved with the investigation.'
        : 'Calculation finished. Its inputs and completed output are saved with the investigation.';
    } catch (error) {
      if (stillCurrent()) {
        if (error instanceof InvestigationCancelledError) this.status = error.message;
        else this.error = error instanceof Error ? error.message : String(error);
      }
    } finally { if (stillCurrent()) { this.running = null; this.refresh(); } }
  }
}
