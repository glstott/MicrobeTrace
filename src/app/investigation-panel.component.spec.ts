import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
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
    common = { session: { investigation, data: { nodes: [{ _id: 'A', selected: true, visible: true }], links: [] },
      style: { widgets: { 'link-threshold': 3 } }, state: {}, files: [], meta: {}, network: {} },
      investigationSessions: snapshots, investigationCalculations: new InvestigationCalculationService(snapshots) };
    await TestBed.configureTestingModule({ imports: [FormsModule], declarations: [InvestigationPanelComponent],
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
});
