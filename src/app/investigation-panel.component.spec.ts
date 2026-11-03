import { ComponentFixture, TestBed } from '@angular/core/testing';
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

  it('summarizes saved results and unresolved notes without requiring tools or blocking saves', async () => {
    await common.investigationCalculations.run(common.session, 'network-statistics', async () => ({ value: 'statistics' }));
    await common.investigationCalculations.run(common.session, 'consensus', async () => 'ACGT', undefined, { sequence: true });
    common.session.investigation.scopes.consensus = 'cohort';
    common.session.investigation.annotations.push({ id: 'unresolved', target: { type: 'node', id: 'missing' }, text: 'Retained note', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    fixture.componentInstance.changed();
    fixture.detectChanges();
    const summary = fixture.nativeElement.querySelector('[data-testid="investigation-summary"]');
    expect(summary.textContent).toContain('1 completed result · 1 stale result · 1 unresolved note');
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
    expect(panel.summary.unresolvedNotes).toBe(1);
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
});
