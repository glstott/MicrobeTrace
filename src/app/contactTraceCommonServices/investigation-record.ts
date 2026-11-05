import { INVESTIGATION_OPERATIONS } from './investigation-state';
import { investigationFigureBytes } from './investigation-state';
import type { InvestigationManifest, InvestigationFigure } from './investigation-state';

interface ReportCell { html: string }
const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const labels: Record<string, string> = {
  distance: 'Genetic distance', snps: 'SNPs', tn93: 'TN93', id: 'ID', nodeIds: 'Node IDs', edgeIds: 'Relationship IDs',
  networkSubsetFilter: 'Shared network filters', node: 'Nodes', link: 'Relationships', timeStart: 'Start time', timeEnd: 'End time', timeTarget: 'Timeline position',
  field: 'Field', operator: 'Condition', value: 'Value', matchMode: 'Condition', enabled: 'Enabled',
  equals: 'equals', notEquals: 'does not equal', contains: 'contains', startsWith: 'starts with', endsWith: 'ends with',
  'polygons-foci': 'Group by', 'polygons-show': 'Show groups', 'polygons-labels-show': 'Show group labels',
  'network-layout': 'Network layout', 'default-distance-metric': 'Distance metric', 'link-sort-variable': 'Threshold field',
  'link-threshold': 'Link threshold', 'link-show-nn': 'Nearest-neighbor filtering', 'filtering-epsilon': 'Nearest-neighbor precision',
  selectedNodeIds: 'Selected node IDs', disabledSources: 'Disabled relationship sources', tree: 'Base tree',
};
const label = (key: string): string => labels[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ').replace(/^./, character => character.toUpperCase());
const format = (value: any): string => {
  if (value === undefined || value === null) return 'Not recorded';
  if (value === '') return 'None';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.map(format).join(', ') : 'None';
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${label(key)}: ${format(item)}`).join('; ') || 'None';
  return String(value);
};
const text = (value: any): ReportCell => ({ html: escape(format(value)) });
const code = (value: any): ReportCell => ({ html: `<span class="reference">${escape(format(value))}</span>` });
const date = (value: string | number): string => {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: 'UTC', timeZoneName: 'short',
  }).format(parsed) : 'Not recorded';
};
const table = (headers: string[], rows: ReportCell[][], empty = 'None recorded.'): string => rows.length
  ? `<div class="table-scroll"><table><thead><tr>${headers.map(header => `<th scope="col">${escape(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell.html}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  : `<p class="muted">${escape(empty)}</p>`;
const facts = (rows: Array<[string, any]>): string => table(['Setting', 'Saved value'], rows.map(([name, value]) => [text(name), text(value)]));
const details = (title: string, body: string): string => `<details><summary>${escape(title)}</summary>${body}</details>`;
const section = (id: string, title: string, body: string): string => `<section id="${id}"><h2>${title}</h2>${body}</section>`;
const scopeName = (scope: string): string => ({ full: 'Full network', visible: 'Visible network', cohort: 'Selected cohorts' }[scope] ?? 'Not recorded');
const counted = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;
const badge = (status: string, title: string): ReportCell => ({ html: `<span class="badge ${status === 'completed' ? 'completed' : status === 'stale' ? 'stale' : 'neutral'}">${escape(title)}</span>` });
const settingRows = (value: any, prefix = ''): Array<[string, any]> => Object.entries(value || {}).flatMap(([key, item]) => {
  const name = [prefix, label(key)].filter(Boolean).join(' · ');
  if (item && typeof item === 'object' && !Array.isArray(item)) return settingRows(item, name);
  return [[name, item] as [string, any]];
});

/** An offline, script-free publication record. Exact machine-readable state stays in the manifest/session. */
export function readableInvestigationRecord(manifest: InvestigationManifest, images: InvestigationFigure[] = []): string {
  const state = manifest.investigation;
  const counts = manifest.counts;
  const runs = Object.values(state.calculations);
  const completed = runs.filter(run => run.status === 'completed').length;
  const stale = runs.filter(run => run.status === 'stale').length;
  const cohortNames = new Map(state.cohorts.map(cohort => [cohort.id, cohort.name]));
  const selectedCohorts = state.cohorts.filter(cohort => state.selectedCohortIds.includes(cohort.id));
  const selectedMembers = new Set(selectedCohorts.flatMap(cohort => cohort.nodeIds));
  const nodes = state.layout.nodes;
  const ids = (title: string, values: string[]): string => details(`${title} (${values.length})`, `<p class="members">${escape(values.length ? values.join(', ') : 'None')}</p>`);
  const evidenceArchives = state.figureEvidence || {};
  const figures = section('figures', 'Exported visualizations', (state.figures?.length
    ? '<p>These are the images exported during this investigation. Each image preserves its appearance and recorded settings at export time; later changes do not replace it.</p>'
      + state.figures.map(figure => {
        const image = images.find(item => item.id === figure.id && item.sha256 === figure.sha256);
        if (image) investigationFigureBytes(image);
        return `<figure class="exported-figure"><h3>${escape(figure.view)}</h3>${image
          ? `<a href="${image.dataUrl}" download="${escape(figure.filename)}"><img src="${image.dataUrl}" width="${figure.width}" height="${figure.height}" alt="${escape(`${figure.view}: ${figure.filename}`)}"></a>`
          : `<p class="muted">Image file: ${escape(figure.path)}. Rebuild this record from the accompanying session to embed the image.</p>`}
          <figcaption><strong>${escape(figure.filename)}</strong> · Exported ${escape(date(figure.exportedAt))} · ${figure.width} × ${figure.height} pixels</figcaption>
          <p class="muted">${figure.evidenceId && evidenceArchives[figure.evidenceId]
            ? `<a href="#evidence-${escape(figure.evidenceId)}">Supporting data and calculation records preserved</a>. Later edits and reruns do not replace these records.`
            : 'Historical analytical records: not recorded for this image.'}</p>
          ${details('Settings and audit references at export', facts([
            ['View', figure.view], ['Loaded nodes', figure.context.nodeIds.length], ['Visible nodes', figure.context.visibleNodeIds.length],
            ['Loaded relationships', figure.context.edgeIds.length], ['Visible relationships', figure.context.visibleEdgeIds.length],
            ['Software', `${figure.software.name} ${figure.software.version}`], ['Software build', figure.software.commit],
          ]) + facts(settingRows(figure.context.options, 'Export')) + facts(settingRows(figure.context.settings, 'Display'))
            + facts(settingRows(figure.context.filters, 'Filters')) + facts(settingRows(figure.context.viewStates, 'View'))
            + ids('Loaded node IDs at export', figure.context.nodeIds) + ids('Visible node IDs at export', figure.context.visibleNodeIds)
            + ids('Loaded relationship IDs at export', figure.context.edgeIds) + ids('Visible relationship IDs at export', figure.context.visibleEdgeIds)
            + ids('Selected cohort IDs at export', figure.context.selectedCohortIds) + ids('Enabled layer IDs at export', figure.context.enabledLayerIds)
            + ids('Saved calculation IDs at export', figure.context.calculationIds)
            + table(['Audit reference', 'Value'], [['Image ID', figure.id], ['Image SHA-256', figure.sha256], ['Input content SHA-256', figure.context.inputChecksum], ['Bundle path', figure.path]].map(([name, value]) => [text(name), code(value)])))}
          </figure>`;
      }).join('')
    : '<p class="muted">No images were exported before this snapshot. Export an image from a view or the dashboard, then save the investigation bundle to include it here.</p>'));
  const figureEvidence = section('figure-evidence', 'Supporting records for exported figures', Object.entries(evidenceArchives).map(([id, evidence], index) => {
    const historicalRuns = Object.values(evidence.calculations);
    const references = (state.figures || []).filter(figure => figure.evidenceId === id).length;
    const labelFor = (operation: string) => INVESTIGATION_OPERATIONS.find(item => item.id === operation)?.label || operation;
    return `<article id="evidence-${escape(id)}"><h3>Supporting record ${index + 1}</h3><p>Preserves the loaded data, source files, cohort and relationship-layer definitions, scope choices, and saved calculation inputs and outputs present at export. ${counted(references, 'figure')} ${references === 1 ? 'references' : 'reference'} this record.</p>`
      + facts([['Loaded nodes at export', evidence.counts.nodes], ['Loaded relationships at export', evidence.counts.edges]])
      + table(['Analysis', 'Retained run ID', 'Scope when run', 'Result at export', 'Recorded inputs', 'Recorded outputs', 'Completed at (UTC)'], historicalRuns.map(run => [
        text(labelFor(run.operation)), code(run.id), text(scopeName(run.scope)), badge(run.status, run.status === 'stale' ? 'Stale — retained' : 'Completed'),
        text(`${run.nodeIds.length} nodes; ${run.edgeIds.length} relationships`),
        text(Object.entries(run.outputSummary?.counts || {}).map(([name, count]) => `${count} ${name}`).join('; ') || 'Original calculation record retained'), text(date(run.completedAt)),
      ]), 'No saved calculations were present when this figure was exported.')
      + historicalRuns.map(run => details(`${labelFor(run.operation)}: original parameters and input IDs`, facts([
        ['Run ID', run.id], ['Software', `${run.software.name} ${run.software.version}`], ['Build', run.software.commit],
        ...settingRows(Object.fromEntries(Object.entries(run.parameters).filter(([key]) => key !== '__scopeOptions'))),
        ['Input SHA-256', run.inputChecksum], ['Output SHA-256', run.outputChecksum],
      ]) + ids('Original calculation node IDs', run.nodeIds) + ids('Original calculation relationship IDs', run.edgeIds))).join('')
      + details('Cohorts, layers, scopes, and source files at export',
        table(['Cohort', 'Members', 'Selected at export'], evidence.cohorts.map(cohort => [text(cohort.name), text(cohort.nodeIds.length), text(evidence.selectedCohortIds.includes(cohort.id))]))
        + evidence.cohorts.map(cohort => ids(`Members of ${cohort.name} at export`, cohort.nodeIds)).join('')
        + table(['Relationship layer', 'Source', 'Enabled', 'Color', 'Opacity'], evidence.edgeLayers.map(layer => [text(layer.name), text(layer.source), text(layer.enabled), text(layer.color), text(layer.opacity)]))
        + table(['Analysis', 'Scope choice at export'], Object.entries(evidence.scopes).map(([operation, scope]) => [text(labelFor(operation)), text(scopeName(scope))]))
        + table(['Source file at export', 'Content SHA-256'], evidence.sources.map(source => [text(source.name), code(source.sha256)])))
      + `<p class="muted">Exact data and calculation outputs are stored in the accompanying session and <a href="${escape(evidence.path)}" download>supporting-record JSON</a> (<span class="reference">${escape(evidence.path)}</span>).</p>`
      + facts([['Supporting-record SHA-256', id], ['Loaded-data SHA-256', evidence.inputChecksum]]) + '</article>';
  }).join('') || '<p class="muted">No figure supporting records were recorded.</p>');

  const threshold = section('threshold', 'Threshold', facts([
    ['Threshold value', state.threshold.value], ['Threshold field', label(state.threshold.metric)],
    ['Distance metric', label(state.threshold.distanceMetric)], ['Distance display format', label(state.threshold.displayFormat)],
    ['Nearest-neighbor filtering', state.threshold.nearestNeighbor],
  ]));

  const sharedRules = state.filters.state?.networkSubsetFilter || {};
  const ruleRows = ['node', 'link'].map(kind => {
    const rule = sharedRules[kind];
    return [text(kind === 'node' ? 'Nodes' : 'Relationships'), text(rule?.enabled ? 'Enabled' : 'Off'),
      text(rule?.enabled ? `${rule.field} ${label(rule.operator || 'equals').toLowerCase()} ${format(rule.value)}` : 'No shared rule enabled')];
  });
  const otherFilters = Object.fromEntries(Object.entries(state.filters.state || {}).filter(([key]) => key !== 'networkSubsetFilter'));
  const filters = section('filters', 'Filters',
    facts([['Minimum cluster size', state.filters.minimumClusterSize], ['Excluded nodes', state.filters.exclusions.length]])
    + table(['Applies to', 'Status', 'Rule'], ruleRows)
    + facts(Object.entries(otherFilters).flatMap(([key, value]) => /^time(Start|End|Target)$/.test(key)
      ? [[label(key), date(value as any)] as [string, any]] : settingRows({ [key]: value })))
    + (state.filters.exclusions.length ? ids('Excluded node IDs', state.filters.exclusions) : '')
    + details('View and table filters', facts(settingRows(state.filters.tables))));

  const tabs = state.layout.tabs || [];
  const layout = section('layout', 'Layout and selection',
    `<p>The snapshot retains positions for <strong>${nodes.length}</strong> nodes, including <strong>${nodes.filter(node => node.fixed).length}</strong> individually pinned and <strong>${nodes.filter(node => node.selected).length}</strong> selected nodes.</p>`
    + table(['Open view', 'Active when saved'], tabs.map(tab => [text(tab.tabTitle || tab.label), text(!!tab.isActive)]), 'No open views recorded.')
    + facts([['All nodes pinned', state.layout.network.allPinned], ['Timeline positions pinned', state.layout.network.timelinePinned]])
    + details('Saved view and camera settings', facts([
      ...settingRows(state.layout.camera, 'Network camera'), ...settingRows(state.viewStates, 'View'),
      ...settingRows(state.layout.dashboardState, 'Dashboard'), ...settingRows(state.layout.widgets, 'Display'),
    ]))
    + details(`Node positions and selections (${nodes.length})`, table(['Node ID', 'X', 'Y', 'Pinned', 'Selected'],
      nodes.map(node => [code(node.id), text(node.x), text(node.y), text(node.fixed), text(node.selected)]))));

  const grouping = section('grouping', 'Grouping',
    table(['Group', 'Grouping field', 'Members'], state.grouping.groups.map(group => [text(group.label || group.id), text(group.field), text(group.nodeIds.length)]), 'No resolved groups recorded.')
    + state.grouping.groups.map(group => ids(`Members of ${group.label || group.id}`, group.nodeIds)).join('')
    + details('Grouping display settings', facts(settingRows(state.grouping.widgets))));

  const cohorts = section('cohorts', 'Cohorts',
    `<p>${selectedCohorts.length} cohort${selectedCohorts.length === 1 ? '' : 's'} selected for calculations, covering <strong>${selectedMembers.size} unique nodes</strong>. Overlapping members are counted once. Saved cohort membership stays fixed when display filters change.</p>`
    + table(['Cohort', 'Members', 'Used for cohort calculations'], state.cohorts.map(cohort => [text(cohort.name), text(cohort.nodeIds.length), text(state.selectedCohortIds.includes(cohort.id))]), 'No cohorts recorded.')
    + state.cohorts.map(cohort => ids(`Members of ${cohort.name}`, cohort.nodeIds)).join(''));

  const layers = section('layers', 'Relationship layers',
    `<p>${state.edgeLayers.filter(layer => layer.enabled).length} of ${state.edgeLayers.length} layers enabled. An edge contributed by several enabled sources is counted once.</p>`
    + table(['Order', 'Layer', 'Status', 'Color override', 'Opacity override'], state.edgeLayers.map((layer, index) => [text(index + 1), text(layer.name),
      badge(layer.enabled ? 'completed' : 'neutral', layer.enabled ? 'Enabled' : 'Disabled'), text(layer.color ?? 'Use view styling'),
      text(layer.opacity === undefined ? 'Use view styling' : `${Math.round(layer.opacity * 100)}%`)]), 'No relationship layers recorded.')
    + details('Layer source identities', table(['Layer', 'Stable ID', 'Source'], state.edgeLayers.map(layer => [text(layer.name), code(layer.id), text(layer.source)]))));

  const notes = section('notes', 'Notes', state.annotations.length ? state.annotations.map(note => {
    const target = note.target.type === 'investigation' ? 'Investigation'
      : note.target.type === 'cohort' ? `Cohort: ${cohortNames.get(note.target.id) || note.target.id}`
      : `${note.target.type === 'node' ? 'Node' : 'Relationship'}: ${note.target.id}`;
    // Schema 3 records every target's resolution; older manifests cannot resolve edges.
    const resolved = manifest.annotationResolution?.[note.id];
    const unresolved = resolved !== undefined ? !resolved : note.target.type === 'node' ? !nodes.some(node => node.id === note.target.id)
      : note.target.type === 'cohort' ? !cohortNames.has(note.target.id) : false;
    return `<article class="note"><h3>${escape(target)}${unresolved ? ' <span class="badge stale">Unlinked note</span>' : resolved === undefined && note.target.type === 'edge' ? ' <span class="badge neutral">Target status not recorded</span>' : ''}</h3><p class="note-text">${escape(note.text)}</p><p class="muted">Created ${escape(date(note.createdAt))} · Updated ${escape(date(note.updatedAt))}</p></article>`;
  }).join('') : '<p class="muted">No notes recorded.</p>');

  const runDetails = INVESTIGATION_OPERATIONS.flatMap(operation => {
    const run = state.calculations[operation.id];
    if (!run) return [];
    const parameters = Object.fromEntries(Object.entries(run.parameters || {}).filter(([key]) => key !== '__scopeOptions' && key !== 'operation'));
    return [details(`${operation.label}: recorded inputs and parameters`, facts([
      ['Scope when run', scopeName(run.scope)], ['Cohorts when run', run.cohortIds.map(id => cohortNames.get(id) || id)],
      ['Started', date(run.startedAt)], ['Completed', date(run.completedAt)],
      ['Software', `${run.software.name} ${run.software.version}`], ['Software build', run.software.commit],
      ['Software build date', date(run.software.buildDate)], ...settingRows(parameters),
      ...settingRows(run.outputSummary || { 'Output summary': 'Not recorded' }),
    ]) + ids('Input node IDs', run.nodeIds) + ids('Input relationship IDs', run.edgeIds)
      + table(['Audit reference', 'Value'], [['Run ID', run.id], ['Input SHA-256', run.inputChecksum], ['Output SHA-256', run.outputChecksum]].map(([name, value]) => [text(name), code(value)])))];
  }).join('');
  const calculations = section('calculations', 'Calculations',
    `<p><strong>${completed} completed</strong> and <strong>${stale} stale</strong> saved results. A stale result is retained, but its current inputs or settings differ from those recorded for the run. Reopening preserves saved results; running again is an explicit action.</p>`
    + table(['Analysis', 'Scope for next run', 'Saved result', 'Saved input counts', 'Saved outputs', 'Completed at (UTC)'], INVESTIGATION_OPERATIONS.map(operation => {
      const run = state.calculations[operation.id];
      return [text(operation.label), text(scopeName(state.scopes[operation.id] || operation.scope)),
        run ? { html: badge(run.status, run.status === 'stale' ? 'Stale — retained' : 'Completed').html
          + (run.status === 'stale' ? `<p class="muted">${escape((run.staleReasons || ['Exact change details were not recorded for this saved result.']).join(' '))}</p>` : '') } : badge('neutral', 'Not run'),
        text(run ? `${counted(run.nodeIds.length, 'node')}; ${counted(run.edgeIds.length, 'relationship')}` : '—'),
        text(run?.outputSummary ? [...Object.entries(run.outputSummary.counts).map(([name, count]) => `${count} ${name}`),
          ...(run.outputSummary.completedReplicates !== undefined ? [`${run.outputSummary.completedReplicates}/${run.outputSummary.requestedReplicates} replicates${run.outputSummary.stoppedEarly ? ' (stopped early)' : ''}`] : [])].join('; ') || 'Completed; see recorded details' : run ? 'Not recorded' : '—'),
        text(run ? date(run.completedAt) : '—')];
    }))
    + '<p class="muted">Full network and selected-cohort scopes ignore display filters while retaining enabled relationship layers and applicable analytical settings. Visible-network scope records the filtered inputs at run start. Exact completed outputs are stored in the accompanying session.</p>'
    + runDetails);

  const sources = section('sources', 'Input sources',
    table(['Source file', 'Content checksum available'], manifest.sources.map(source => [text(source.name), text(source.sha256 !== 'not recorded')])));
  const integrity = section('integrity', 'Software and audit references',
    facts([['Software', `${manifest.software.name} ${manifest.software.version}`], ['Build / commit', manifest.software.commit],
      ['Build date', date(manifest.software.buildDate)], ['Snapshot captured', date(manifest.capturedAt)],
      ['Historical provenance', manifest.historicalProvenance === 'not recorded' ? 'Not recorded in the original session' : 'Recorded']])
    + details('Snapshot and source checksums', table(['Audit reference', 'Value'], [
      [text('Snapshot ID'), code(manifest.snapshotId)], [text('Snapshot SHA-256'), code(manifest.stateChecksum)],
    ]) + table(['Source file', 'SHA-256', 'Content representation'], manifest.sources.map(source => [text(source.name), code(source.sha256), text(source.representation)])))
    + '<p class="muted">This report describes the saved state and recorded calculation provenance. It does not provide a chronological action history or guarantee identical reruns across software versions.</p>');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MicrobeTrace investigation record</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f3f6f8;color:#203345;font:15px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1120px;margin:auto;padding:40px 28px 60px}header{padding:30px 34px;background:#173d55;border-radius:12px;color:#fff}header .eyebrow{letter-spacing:.12em;text-transform:uppercase;font-size:12px;font-weight:650;color:#c1dfeb}h1{font-size:32px;line-height:1.2;margin:10px 0 18px;font-weight:650}header p{max-width:780px;margin:10px 0;color:#e1edf2}.captured{font-size:14px}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:22px 0}.stat{background:#fff;border:1px solid #d9e3e8;border-radius:9px;padding:18px 22px}.stat strong{display:block;font-size:29px;line-height:1.25;color:#164b60}.stat span{font-size:13px;color:#4b6272}nav{display:flex;flex-wrap:wrap;gap:8px 18px;padding:10px 0 22px}a{color:#145976;text-decoration-thickness:1px;text-underline-offset:3px}a:focus-visible,summary:focus-visible{outline:3px solid #2484ab;outline-offset:4px}section{background:#fff;border:1px solid #d9e3e8;border-radius:10px;padding:24px 28px;margin:18px 0;scroll-margin-top:20px}h2{font-size:21px;line-height:1.3;color:#173d55;margin:0 0 18px}h3{font-size:16px;margin:0 0 10px}p{margin:12px 0}.muted{font-size:13px;color:#536a79}.table-scroll{overflow-x:auto;margin:12px 0}table{width:100%;border-collapse:collapse;text-align:left;font-size:13px}th{background:#edf3f6;color:#254658;font-weight:650}th,td{min-width:110px;padding:11px 13px;border-bottom:1px solid #e2e9ed;vertical-align:top;overflow-wrap:anywhere}th:first-child{min-width:140px}td:first-child{font-weight:500}td{max-width:550px}details{border:1px solid #dce5ea;border-radius:7px;padding:11px 15px;margin:14px 0}summary{cursor:pointer;font-size:14px;font-weight:600;color:#29546a}details[open]>summary{margin-bottom:15px}.reference{font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.members{font-size:13px;overflow-wrap:anywhere}.badge{display:inline-block;white-space:nowrap;font-size:12px;line-height:1.4;font-weight:600;border-radius:5px;padding:4px 8px}.completed{color:#165b46;background:#e5f3ec}.stale{color:#815119;background:#fff0d8}.neutral{color:#536675;background:#edf1f4}.note{border-left:3px solid #5592a7;padding:8px 18px;margin:18px 0;background:#f7fafb}.note-text{white-space:pre-wrap}footer{padding:10px 4px;color:#536a79;font-size:13px}
.exported-figure{margin:24px 0;padding-bottom:24px;border-bottom:1px solid #d9e3e8}.exported-figure img{display:block;max-width:100%;height:auto;border:1px solid #d9e3e8;background:#fff}.exported-figure figcaption{margin:10px 0;font-size:13px;overflow-wrap:anywhere}@media print{.exported-figure img{max-height:75vh;width:auto;object-fit:contain}}
@media(max-width:650px){main{padding:18px 12px 30px}header{padding:24px 20px}h1{font-size:27px}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.stat{padding:14px}section{padding:20px 16px}th,td{padding:9px}nav{font-size:13px}}
@media print{body{background:#fff;color:#111;font-size:10pt}main{max-width:none;padding:0}header{background:#fff;color:#111;border:1px solid #aaa;padding:18px}header p,header .eyebrow{color:#333}nav{display:none}section{border:0;border-top:1px solid #aaa;border-radius:0;padding:18px 0;margin:12px 0}h2,h3{break-after:avoid}tr,.note,.stat{break-inside:avoid}.table-scroll{overflow:visible}details>summary{list-style:none}details::details-content{display:block;content-visibility:visible}.badge{border:1px solid #aaa;color:#111;background:#fff}.reference{font-size:8pt}th{background:#eee}}
</style></head><body><main><header><div class="eyebrow">MicrobeTrace · Saved investigation</div><h1>Investigation record</h1><p>A readable account of the network, analytical settings, notes, and saved calculations at the time of capture.</p><p class="captured">Captured ${escape(date(manifest.capturedAt))}</p></header>
<div class="stats">${[[counts.nodes, 'Loaded nodes'], [counts.visibleNodes, 'Visible nodes'], [counts.edges, 'Loaded relationships'], [counts.visibleEdges, 'Visible relationships']].map(([count, title]) => `<div class="stat"><strong>${escape(count)}</strong><span>${title}</span></div>`).join('')}</div>
<p>To continue this analysis, open the accompanying <strong>.microbetrace session</strong> in MicrobeTrace. This HTML is for reading and sharing; <strong>investigation-manifest.json</strong> contains the machine-readable audit details.</p>
<nav aria-label="Record sections">${[['figures','Images'],['figure-evidence','Figure evidence'],['threshold','Threshold'],['filters','Filters'],['layout','Layout'],['grouping','Grouping'],['cohorts','Cohorts'],['layers','Layers'],['notes','Notes'],['calculations','Calculations'],['sources','Sources'],['integrity','Audit references']].map(([id,title])=>`<a href="#${id}">${title}</a>`).join('')}</nav>
${figures}${figureEvidence}${threshold}${filters}${layout}${grouping}${cohorts}${layers}${notes}${calculations}${sources}${integrity}<footer>Snapshot ID: <span class="reference">${escape(manifest.snapshotId)}</span></footer></main></body></html>`;
}
