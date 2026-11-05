import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MultiSelectModule } from 'primeng/multiselect';
import { InvestigationPanelComponent } from './investigation-panel.component';
import { CommonService } from './contactTraceCommonServices/common.service';
import { InvestigationSessionService } from './contactTraceCommonServices/investigation-session.service';
import { InvestigationCalculationService } from './contactTraceCommonServices/investigation-calculation.service';
import { createInvestigationWorkspace } from './contactTraceCommonServices/investigation-state';

describe('Investigation text editing', () => {
  let fixture: ComponentFixture<InvestigationPanelComponent>;
  let common: any;
  beforeEach(async () => {
    const investigation = createInvestigationWorkspace();
    investigation.cohorts = [{ id: 'review', name: 'Saved cohort', nodeIds: ['A'] }];
    investigation.annotations = [{ id: 'note', target: { type: 'investigation' }, text: 'Saved note',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }];
    const snapshots = new InvestigationSessionService();
    common = { session: { investigation, data: { nodes: [{ _id: 'A', seq: 'ACGT', selected: true, visible: true }], links: [] },
      style: { widgets: { 'link-threshold': 3 } }, state: {}, files: [], meta: {}, network: {} },
      investigationSessions: snapshots, investigationCalculations: new InvestigationCalculationService(snapshots) };
    await TestBed.configureTestingModule({ imports: [FormsModule, MultiSelectModule, NoopAnimationsModule], declarations: [InvestigationPanelComponent],
      providers: [{ provide: CommonService, useValue: common }] }).compileComponents();
    fixture = TestBed.createComponent(InvestigationPanelComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });
  afterEach(() => fixture?.destroy());

  it('offers one save action with all editing and calculation controls collapsed', () => {
    const tools = fixture.nativeElement.querySelector('[data-testid="investigation-tools"]') as HTMLDetailsElement;
    expect(tools.open).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('No individual selections are needed.');
    const button = fixture.nativeElement.querySelector('[data-testid="investigation-save"]') as HTMLButtonElement;
    expect(button.textContent.trim()).toBe('Save investigation');
    for (const control of fixture.nativeElement.querySelectorAll('input[type="checkbox"], .scope-row select')) {
      expect((control as HTMLElement).closest('[data-testid="investigation-tools"]')).toBe(tools);
    }
  });

  it('requests a complete save without opening tools or changing existing investigation state', async () => {
    const before = JSON.stringify(common.session);
    const save = jasmine.createSpy('save');
    fixture.componentInstance.saveInvestigation.subscribe(save);
    fixture.nativeElement.querySelector('[data-testid="investigation-save"]').click();
    expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(common.session)).toBe(before);
    const captured = await common.investigationSessions.capture({ session: common.session, tabs: [] });
    expect(captured.investigation.cohorts).toEqual(common.session.investigation.cohorts);
    expect(captured.investigation.annotations).toEqual(common.session.investigation.annotations);
    expect(captured.investigation.scopes).toEqual(common.session.investigation.scopes);
  });

  it('summarizes saved results and linked/unlinked notes without requiring tools or blocking saves', async () => {
    await common.investigationCalculations.run(common.session, 'network-statistics', async () => ({ value: 'statistics' }));
    await common.investigationCalculations.run(common.session, 'consensus', async () => 'ACGT', undefined, { sequence: true });
    common.session.investigation.scopes.consensus = 'cohort';
    common.session.investigation.annotations.push({ id: 'unresolved', target: { type: 'node', id: 'missing' }, text: 'Retained note', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    fixture.componentInstance.changed();
    fixture.detectChanges();
    const summary = fixture.nativeElement.querySelector('[data-testid="investigation-summary"]');
    expect(summary.textContent).toContain('1 completed result · 1 stale result · 1 linked note · 1 unlinked note');
    expect(summary.textContent).toContain('Calculation scope changed.');
    expect(summary.textContent).toContain('You can save the complete investigation');
    expect(summary.closest('[data-testid="investigation-tools"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="investigation-save"]').disabled).toBeFalse();
    const captured = await common.investigationSessions.capture({ session: common.session, tabs: [] });
    expect(captured.investigation.calculations.consensus.output).toBe('ACGT');
    expect(captured.provenance.annotationResolution.unresolved).toBeFalse();
  });

  it('disables duplicate save requests while a save is being prepared', () => {
    const save = jasmine.createSpy('save');
    fixture.componentInstance.saveInvestigation.subscribe(save);
    fixture.componentRef.setInput('saving', true);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('[data-testid="investigation-save"]') as HTMLButtonElement;
    expect(button.disabled).toBeTrue();
    button.click();
    expect(save).not.toHaveBeenCalled();
  });

  function reviewNotes() {
    return Array.from(fixture.nativeElement.querySelectorAll('#investigation-note-review textarea')) as HTMLTextAreaElement[];
  }
  function addReviewNote(id: string, type: 'investigation' | 'node' | 'edge' | 'cohort', targetId?: string, text = id) {
    common.session.investigation.annotations.push({ id, target: { type, ...(targetId ? { id: targetId } : {}) }, text,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
  }

  it('opens the requested note group from the summary, clears old searches, and leaves saved membership intact', async () => {
    addReviewNote('orphan', 'cohort', 'removed-review', 'Retained methods');
    fixture.componentInstance.changed(false, false);
    fixture.componentInstance.setNoteSearch('previous search');
    fixture.detectChanges();
    const before = JSON.stringify(common.session);
    const resolve = spyOn(common.investigationCalculations, 'resolve').and.callThrough();
    fixture.nativeElement.querySelector('[data-testid="investigation-unlinked-notes"]').click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="investigation-tools"]').open).toBeTrue();
    expect(fixture.nativeElement.querySelector('[data-testid="investigation-note-tools"]').open).toBeTrue();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('[aria-label="Search notes"]'));
    expect(fixture.componentInstance.noteSearch).toBe('');
    expect(fixture.componentInstance.noteFilter).toBe('unlinked');
    expect(reviewNotes().map(input => input.value)).toEqual(['Retained methods']);
    expect(fixture.nativeElement.querySelector('[data-testid="investigation-note-count"]').textContent).toContain('Showing 1 of 2 notes');
    fixture.nativeElement.querySelector('[data-testid="investigation-linked-notes"]').click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(reviewNotes().map(input => input.value)).toEqual(['Saved note']);
    expect(resolve).not.toHaveBeenCalled();
    expect(JSON.stringify(common.session)).toBe(before);
    const captured = await common.investigationSessions.capture({ session: common.session, tabs: [] });
    expect(captured.investigation.annotations).toEqual(common.session.investigation.annotations);
    expect('noteFilter' in captured.investigation).toBeFalse();
    expect('noteSearch' in captured.investigation).toBeFalse();
  });

  it('searches text, stable IDs, hidden target names, relationship endpoints and cohort names with combined filters', async () => {
    common.session.data.nodes[0].name = 'Case Alpha';
    common.session.data.nodes.push({ _id: 'B', name: 'Case Beta', visible: false });
    common.session.data.links.push({ id: 'edge-AB', source: 'A', target: 'B', name: 'Field contact' });
    addReviewNote('hidden-note', 'node', 'B', 'Follow up next week');
    addReviewNote('edge-note', 'edge', 'edge-AB', 'Relationship methods');
    addReviewNote('cohort-note', 'cohort', 'review', 'Review methods');
    addReviewNote('orphan-note', 'node', 'missing-node', 'Retained methods');
    const panel = fixture.componentInstance;
    panel.changed(false, false); panel.showNotes('linked');
    const search = async (query: string, ids: string[]) => {
      await edit('[aria-label="Search notes"]', query, false);
      expect(reviewNotes().map(input => input.getAttribute('aria-label').replace('Edit note ', ''))).toEqual(ids);
    };
    await search('  FOLLOW UP  ', ['hidden-note']);
    await search('case beta', ['hidden-note', 'edge-note']);
    await search('edge-AB', ['edge-note']);
    await search('field contact', ['edge-note']);
    await search('saved cohort', ['cohort-note']);
    await search('orphan-note', []);
    expect(fixture.nativeElement.textContent).toContain('No notes match these filters.');
    const filter = fixture.nativeElement.querySelector('[aria-label="Show notes"]') as HTMLSelectElement;
    filter.value = 'unlinked'; filter.dispatchEvent(new Event('change'));
    await fixture.whenStable(); fixture.detectChanges();
    expect(reviewNotes().map(input => input.value)).toEqual(['Retained methods']);
    fixture.nativeElement.querySelector('#investigation-note-review button').click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(filter.value).toBe('all');
    expect(reviewNotes().length).toBe(5);
    expect(fixture.nativeElement.querySelector('[aria-label="Search notes"]').value).toBe('');
  });

  it('updates filtered membership after adding, editing, deleting notes or removing a cohort without changing other notes', async () => {
    addReviewNote('cohort-note', 'cohort', 'review', 'Cohort methods');
    const panel = fixture.componentInstance;
    panel.changed(false, false); panel.showNotes('unlinked');
    expect(panel.filteredNotes.length).toBe(0);
    panel.deleteCohort('review'); fixture.detectChanges(); await fixture.whenStable();
    expect(reviewNotes().map(input => input.value)).toEqual(['Cohort methods']);
    panel.setNoteSearch('cohort methods');
    const note = common.session.investigation.annotations[1];
    panel.noteDrafts.set(note, 'Revised methods'); panel.updateNote(note);
    fixture.detectChanges(); await fixture.whenStable(); expect(reviewNotes().length).toBe(0);
    panel.clearNoteFilters(); panel.setNoteSearch('revised');
    fixture.detectChanges(); await fixture.whenStable(); expect(reviewNotes().map(input => input.value)).toEqual(['Revised methods']);
    panel.deleteNote('cohort-note'); fixture.detectChanges(); await fixture.whenStable();
    expect(reviewNotes().length).toBe(0);
    panel.noteText = 'Revised investigation methods'; panel.addNote(); fixture.detectChanges(); await fixture.whenStable();
    expect(reviewNotes().map(input => input.value)).toEqual(['Revised investigation methods']);
    expect(common.session.investigation.annotations[0].text).toBe('Saved note');
    expect(panel.summary.linkedNotes).toBe(2);
    expect(panel.summary.unlinkedNotes).toBe(0);
  });

  it('clears note filters when another investigation opens and explains empty groups', async () => {
    const panel = fixture.componentInstance;
    panel.showNotes('unlinked'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No notes match these filters.');
    panel.setNoteSearch('missing');
    const saved = await common.investigationSessions.capture({ session: common.session, tabs: [] });
    common.session = (await common.investigationSessions.prepare(saved)).session;
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(panel.noteFilter).toBe('all'); expect(panel.noteSearch).toBe('');
    expect(reviewNotes().map(input => input.value)).toEqual(['Saved note']);
    panel.deleteNote('note'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No notes saved yet.');
    expect(fixture.nativeElement.querySelector('[data-testid="investigation-note-count"]').textContent).toContain('Showing 0 of 0 notes');
  });

  async function edit(selector: string, value: string, commit = true) {
    const input = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    if (commit) input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    await fixture.whenStable();
    return input;
  }

  it('keeps an empty cohort-name draft from invalidating file or local-link snapshots', async () => {
    const input = await edit('[aria-label="Cohort name"]', '   ');
    expect(common.session.investigation.cohorts[0].name).toBe('Saved cohort');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(fixture.nativeElement.textContent).toContain('previous cohort name will be saved');
    const saved = await common.investigationSessions.capture({ session: common.session, tabs: [] });
    const restored = await common.investigationSessions.prepare(JSON.parse(JSON.stringify(saved)));
    expect(restored.session.investigation.cohorts[0].name).toBe('Saved cohort');
    await edit('[aria-label="Cohort name"]', '  Revised cohort  ');
    expect(common.session.investigation.cohorts[0].name).toBe('Revised cohort');
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });
  it('keeps empty note drafts out of saved state and changes timestamps only on valid edits', async () => {
    const input = await edit('[aria-label="Edit note note"]', '');
    const note = common.session.investigation.annotations[0];
    expect(note.text).toBe('Saved note');
    expect(note.updatedAt).toBe('2026-01-01T00:00:00Z');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const saved = await common.investigationSessions.capture({ session: common.session, tabs: [] });
    expect(saved.investigation.annotations[0].text).toBe('Saved note');
    await edit('[aria-label="Edit note note"]', 'Revised note');
    expect(note.text).toBe('Revised note');
    expect(Date.parse(note.updatedAt)).toBeGreaterThan(Date.parse('2026-01-01T00:00:00Z'));
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });
  it('does not persist uncommitted edits or reuse their drafts in another investigation', async () => {
    await edit('[aria-label="Cohort name"]', 'Uncommitted name', false);
    await edit('[aria-label="Edit note note"]', 'Uncommitted note', false);
    const saved = await common.investigationSessions.capture({ session: common.session, tabs: [] });
    expect(saved.investigation.cohorts[0].name).toBe('Saved cohort');
    expect(saved.investigation.annotations[0].text).toBe('Saved note');
    common.session = (await common.investigationSessions.prepare(saved)).session;
    expect(fixture.componentInstance.workspace).toBe(common.session.investigation);
    fixture.componentRef.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[aria-label="Cohort name"]').value).toBe('Saved cohort');
    expect(fixture.nativeElement.querySelector('[aria-label="Edit note note"]').value).toBe('Saved note');
  });

  it('offers names and distinct stable IDs for duplicate names, including hidden targets', async () => {
    common.session.style.widgets['node-label-variable'] = '_id';
    common.session.data.nodes[0].name = 'Alex';
    common.session.data.nodes.push({ _id: 'B', name: 'Alex', visible: false, selected: false });
    const panel = fixture.componentInstance;
    panel.setNoteTargetType('node');
    expect(panel.noteTargetOptions).toEqual([{ id: 'A', label: 'Alex [A]' }, { id: 'B', label: 'Alex [B] (hidden)' }]);
    panel.noteTargetIds = ['B']; panel.noteText = 'Review hidden case.';
    panel.addNote();
    expect(panel.summary.linkedNotes).toBe(2);
    expect(panel.summary.unlinkedNotes).toBe(0);
    const saved = await common.investigationSessions.capture({ session: common.session, tabs: [] });
    const restored = await common.investigationSessions.prepare(JSON.parse(JSON.stringify(saved)));
    expect(restored.session.investigation.annotations.slice(-1)[0].target).toEqual({ type: 'node', id: 'B' });
    common.session.data.nodes[1].name = 'Renamed case'; panel.changed();
    expect(panel.noteTargetOptions[1].label).toBe('Renamed case [B] (hidden)');
    expect(common.session.investigation.annotations.slice(-1)[0].target.id).toBe('B');
  });

  it('copies a node selection once and saves one note per target without changing selection', () => {
    common.session.data.nodes.push({ _id: 'B', name: 'Hidden case', visible: false, selected: true });
    const panel = fixture.componentInstance, before = JSON.stringify(common.session.data.nodes);
    panel.useNoteSelection('node');
    expect(panel.noteTargetIds).toEqual(['A', 'B']);
    expect(JSON.stringify(common.session.data.nodes)).toBe(before);
    common.session.data.nodes.forEach(node => node.selected = false);
    common.session.data.nodes[0].visible = false;
    panel.noteTargetIds.push('A'); panel.noteText = 'Selection at note creation'; panel.addNote();
    const notes = common.session.investigation.annotations.slice(1);
    expect(notes.map(note => note.target)).toEqual([{ type: 'node', id: 'A' }, { type: 'node', id: 'B' }]);
    expect(new Set(notes.map(note => note.id)).size).toBe(2);
    expect(notes.every(note => note.text === 'Selection at note creation')).toBeTrue();
    expect(panel.status).toContain('2 notes saved');
  });

  it('chooses relationships by endpoint names and deduplicates real edge selections across views', () => {
    common.session.data.nodes[0].name = 'First case';
    common.session.data.nodes.push({ _id: 'B', name: 'Second case' });
    common.session.data.links = [{ id: 'AB', source: { _id: 'A' }, target: 'B', visible: false, origin: ['Contacts'] }];
    common.visuals = { twoD: { getSelectedInvestigationEdgeIds: () => ['AB', 'AB', 'stale-edge'] },
      waterfall: { getSelectedInvestigationEdgeIds: () => ['AB'] } };
    const panel = fixture.componentInstance; panel.useNoteSelection('edge');
    expect(panel.noteTargetIds).toEqual(['AB']);
    expect(panel.noteTargetOptions[0].label).toBe('First case — Second case [AB] (hidden)');
    panel.noteText = 'Review this relationship'; panel.addNote();
    expect(common.session.investigation.annotations.slice(-1)[0].target).toEqual({ type: 'edge', id: 'AB' });
  });

  it('rejects missing targets atomically and retains the text for correction', () => {
    const panel = fixture.componentInstance; panel.setNoteTargetType('node');
    panel.noteTargetIds = ['A', 'removed']; panel.noteText = 'Do not partially save this note';
    const before = JSON.stringify(common.session.investigation.annotations); panel.addNote();
    expect(JSON.stringify(common.session.investigation.annotations)).toBe(before);
    expect(panel.noteText).toBe('Do not partially save this note');
    expect(panel.error).toContain('no notes were saved');
    panel.noteTargetIds = []; panel.addNote();
    expect(panel.error).toContain('Choose at least one target');
    expect(JSON.stringify(common.session.investigation.annotations)).toBe(before);
  });

  it('resets targets when changing target type and never falls back to the investigation', () => {
    const panel = fixture.componentInstance; panel.setNoteTargetType('node');
    panel.noteTargetIds = ['A']; panel.noteText = 'Keep text when changing type';
    panel.setNoteTargetType('cohort');
    expect(panel.noteTargetIds).toEqual([]);
    expect(panel.noteText).toBe('Keep text when changing type');
    panel.addNote(); expect(common.session.investigation.annotations.length).toBe(1);
    panel.useNoteSelection('edge'); expect(panel.error).toContain('Select at least one edge');
  });

  it('keeps a named cohort note attached by ID and retains it when its cohort disappears', async () => {
    const panel = fixture.componentInstance; panel.setNoteTargetType('cohort');
    expect(panel.noteTargetOptions).toEqual([{ id: 'review', label: 'Saved cohort [review]' }]);
    panel.noteTargetIds = ['review']; common.session.investigation.cohorts[0].name = 'Renamed cohort';
    panel.noteText = 'Cohort methods'; panel.addNote();
    const note = common.session.investigation.annotations.slice(-1)[0];
    expect(note.target).toEqual({ type: 'cohort', id: 'review' });
    panel.deleteCohort('review'); expect(panel.resolved(note)).toBeFalse();
    expect(panel.summary.unlinkedNotes).toBe(1);
    expect(panel.summary.linkedNotes).toBe(1);
    const saved = await common.investigationSessions.capture({ session: common.session, tabs: [] });
    expect(saved.provenance.annotationResolution[note.id]).toBeFalse();
  });

  it('discards target drafts when another investigation opens, even before the next refresh', async () => {
    const panel = fixture.componentInstance; panel.setNoteTargetType('node');
    panel.noteTargetIds = ['A']; panel.noteText = 'Draft belongs to previous investigation';
    common.session = (await common.investigationSessions.prepare(await common.investigationSessions.capture({ session: common.session, tabs: [] }))).session;
    panel.addNote(); expect(common.session.investigation.annotations.length).toBe(1);
    expect(panel.noteTargetIds).toEqual([]); expect(panel.noteText).toBe('');
    expect(panel.error).toContain('investigation changed');
  });

  it('renders a selected target name as plain text without active markup', async () => {
    const panel = fixture.componentInstance; common.session.data.nodes[0].name = '<img src=x onerror=alert(1)>';
    panel.setNoteTargetType('node'); panel.noteTargetIds = ['A'];
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    const picker = fixture.nativeElement.querySelector('[data-testid="note-target-picker"]');
    expect(picker.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(picker.querySelector('img')).toBeNull();
  });

  it('defers previews until both tool sections open and performs no repeated idle resolutions', fakeAsync(() => {
    const panel = fixture.componentInstance;
    const resolve = spyOn(common.investigationCalculations, 'resolve').and.callThrough();
    tick(6000);
    expect(resolve).not.toHaveBeenCalled();
    panel.setToolsOpen(true);
    expect(resolve).not.toHaveBeenCalled();
    panel.setCalculationsOpen(true);
    expect(Object.keys(panel.previews).length).toBe(panel.operations.length);
    expect(resolve).toHaveBeenCalledTimes(panel.operations.length);
    tick(6000);
    expect(resolve).toHaveBeenCalledTimes(panel.operations.length);
    panel.setToolsOpen(false);
    common.session.data.nodes.push({ _id: 'B', seq: 'AAAA', visible: true });
    common.investigationCalculations.notifyChanged(common.session);
    tick(0);
    expect(resolve).toHaveBeenCalledTimes(panel.operations.length);
    panel.setToolsOpen(true);
    expect(panel.previews.consensus).toContain('2 eligible sequences');
    expect(resolve).toHaveBeenCalledTimes(2 * panel.operations.length);
  }));

  it('coalesces graph changes while leaving unrelated presentation and outcome notifications cheap', fakeAsync(() => {
    const panel = fixture.componentInstance;
    panel.setToolsOpen(true); panel.setCalculationsOpen(true);
    const resolve = spyOn(common.investigationCalculations, 'resolve').and.callThrough();
    for (let i = 0; i < 5; i++) common.investigationCalculations.notifyChanged(common.session);
    tick(0);
    expect(resolve).toHaveBeenCalledTimes(panel.operations.length);
    common.investigationCalculations.notifyChanged(common.session, 'outcome');
    common.investigationCalculations.notifyChanged(common.session, 'presentation');
    tick(0);
    expect(resolve).toHaveBeenCalledTimes(panel.operations.length);
    common.session.data.nodes.push({ _id: 'B', seq: 'AAAA', visible: true });
    common.investigationCalculations.notifyChanged(common.session);
    panel.noteText = 'Note committed while graph refresh is queued';
    panel.addNote();
    tick(0);
    expect(panel.previews.consensus).toContain('2 eligible sequences');
    expect(resolve).toHaveBeenCalledTimes(2 * panel.operations.length);
  }));

  it('updates stale status and selection shortcuts while previews remain collapsed', async () => {
    await common.investigationCalculations.run(common.session, 'network-statistics', async () => 'statistics');
    await fixture.whenStable();
    const panel = fixture.componentInstance;
    common.session.data.nodes[0].selected = false;
    $(document).trigger('node-selected');
    await new Promise(resolve => setTimeout(resolve, 0));
    fixture.detectChanges();
    expect(panel.noteSelection.nodes).toBe(0);
    expect(panel.summary.stale).toBe(1);
    expect(panel.previews).toEqual({});
    expect(common.session.investigation.calculations['network-statistics'].staleReasons).toContain('Selected nodes changed.');
  });

  it('refreshes when analytical settings change outside the panel and stops after destruction', async () => {
    await common.investigationCalculations.run(common.session, 'network-statistics', async () => 'statistics');
    await fixture.whenStable();
    common.session.style.widgets['link-threshold'] = 2;
    fixture.detectChanges();
    await new Promise(resolve => setTimeout(resolve, 0));
    fixture.detectChanges();
    expect(fixture.componentInstance.summary.stale).toBe(1);
    fixture.destroy();
    const resolve = spyOn(common.investigationCalculations, 'resolve').and.callThrough();
    common.investigationCalculations.notifyChanged(common.session);
    $(document).trigger('node-selected');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(resolve).not.toHaveBeenCalled();
  });

  it('explains a skipped run and retains the earlier completed result', async () => {
    const calculations = common.investigationCalculations;
    await calculations.run(common.session, 'pairwise-distances', async () => ({ value: 'previous distances' }), undefined, { sequence: true });
    const original = common.session.investigation.calculations['pairwise-distances'];
    common.computeLinks = () => calculations.run(common.session, 'pairwise-distances',
      async () => ({ skipped: { message: 'The sequence pair count exceeds the browser limit.' } }), undefined, { sequence: true });
    common.updateNetworkVisuals = jasmine.createSpy('update network');
    await fixture.componentInstance.run('pairwise-distances');
    fixture.detectChanges();
    expect(fixture.componentInstance.status).toContain('Calculation skipped.');
    expect(fixture.componentInstance.status).toContain('exceeds the browser limit');
    expect(fixture.componentInstance.status).toContain('Previous completed result retained.');
    expect(fixture.componentInstance.status).not.toContain('Calculation finished.');
    expect(fixture.componentInstance.error).toBe('');
    expect(fixture.nativeElement.querySelector('[data-testid="investigation-run-outcome"]').textContent).toContain('Last attempt skipped: The sequence pair count exceeds the browser limit.');
    expect(common.session.investigation.calculations['pairwise-distances']).toBe(original);
    expect(common.updateNetworkVisuals).not.toHaveBeenCalled();
  });

  it('reports cancellation without applying a late consensus result or overwriting a replacement session', async () => {
    const original = common.session;
    let release: (value: string) => void;
    common.computeConsensus = () => common.investigationCalculations.run(original, 'consensus',
      () => new Promise<string>(resolve => release = resolve), undefined, { sequence: true }, () => common.session);
    const pending = fixture.componentInstance.run('consensus');
    common.session = { ...original, data: { ...original.data, consensus: 'replacement consensus' }, investigation: createInvestigationWorkspace() };
    fixture.detectChanges();
    release('old consensus'); await pending; await fixture.whenStable();
    expect(common.session.data.consensus).toBe('replacement consensus');
    expect(fixture.componentInstance.status).toBe('');
    expect(fixture.componentInstance.error).toBe('');
    expect(fixture.componentInstance.running).toBeNull();
  });

  it('reports an input-change cancellation while retaining the previous result', async () => {
    const calculations = common.investigationCalculations, session = common.session;
    await calculations.run(session, 'consensus', async () => 'previous consensus', undefined, { sequence: true });
    const previous = session.investigation.calculations.consensus;
    let release: (value: string) => void;
    common.computeConsensus = () => calculations.run(session, 'consensus',
      () => new Promise<string>(resolve => release = resolve), undefined, { sequence: true });
    const pending = fixture.componentInstance.run('consensus');
    session.data.nodes[0].seq = 'TTTT';
    release('discard this result'); await pending;
    expect(fixture.componentInstance.status).toContain('Calculation cancelled');
    expect(fixture.componentInstance.error).toBe('');
    expect(session.investigation.calculations.consensus).toBe(previous);
    expect(session.data.consensus).toBeUndefined();
  });

  it('identifies reuse of a completed tree without claiming a replacement calculation', async () => {
    const calculations = common.investigationCalculations, session = common.session;
    session.data.nodes.push({ _id: 'B', seq: 'AAAA', visible: true });
    await calculations.run(session, 'tree', async () => ({ value: '(A:1,B:1);' }), undefined, { unpruned: true });
    const previous = session.investigation.calculations.tree;
    common.visuals = {};
    common.computeTree = jasmine.createSpy('tree cache').and.resolveTo(previous.output.value);
    await fixture.componentInstance.run('tree');
    expect(fixture.componentInstance.status).toContain('Using the previously completed result');
    expect(session.investigation.calculations.tree).toBe(previous);
    expect(session.data.newickString).toBe('(A:1,B:1);');
  });
});
