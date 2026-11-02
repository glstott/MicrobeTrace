# Investigation snapshots

Open **File → Reproducibility Report** and choose **Save investigation** to save everything together. No individual feature selections are needed. **File → Save** uses the same complete snapshot.

The workspace starts with its editing controls hidden. Expand **Optional tools** only to edit cohorts, relationship layers or notes, run or change calculations, or download the investigation record separately. These tools change the investigation; they do not choose which features are included in a save.

## Files and investigation records

- A `.microbetrace` file contains the versioned snapshot and its manifest.
- A compressed save includes the session, `investigation-manifest.json`, and `investigation-record.html`. Saving by cluster also includes the complete investigation alongside the cluster CSV files.
- **Export reproducibility report** downloads a ZIP containing the readable HTML, manifest, and matching portable `.microbetrace` session from one capture. Drop this ZIP back into MicrobeTrace to resume the saved investigation.
- A **Local link** uses the same snapshot format but works only in the browser and site where it was saved. Clearing browser storage removes it.

The manifest identifies the snapshot, capture time, MicrobeTrace version/build, settings, source-content checksums, network counts, and calculation provenance. Source checksums cover canonical saved content, including the binary encoding of spreadsheet inputs. They are explicitly labelled with that representation.

Open `investigation-record.html` in a browser to read the audit report. It presents network counts, threshold and filter rules, layout and grouping, cohorts, relationship layers, notes, and calculation status in summaries and tables. Expand individual sections for exact memberships, saved display settings, calculation parameters, and checksums. Dates are labelled in UTC. The HTML works offline and includes a print layout; the manifest remains the detailed machine-readable record. To resume the analysis, reopen the accompanying `.microbetrace` session or its complete ZIP rather than the HTML or manifest alone.

Opening a snapshot validates its version, integrity, and required references before replacing the current investigation. Its manifest must agree with its settings and results. Legacy sessions remain supported; historical provenance unavailable in those files is labelled **not recorded**.

New saves use schema 3. Their state checksum covers the session and all manifest metadata, including software identity, capture time, counts, source summaries, calculation output summaries, and annotation target resolution. Reports include actual Bootstrap replicate counts, batch seeds and early stopping, and network-statistics approximation details when recorded. Schema-1 and schema-2 files remain readable using their original validation rules; resaving upgrades them to schema 3. Older checksums cannot retroactively verify historical metadata that they did not cover.

Tree pan/zoom, Heatmap axis ranges and Alignment scroll positions are saved alongside existing network, map, table and statistics view settings. A rejected or report-only older ZIP displays an explanation and leaves the open investigation intact.

## Cohorts, layers, and notes

Create cohorts from the current node selection. Membership remains fixed until **Replace from selection** is used. Checked cohorts form a deduplicated union for cohort calculations. Selecting members and choosing calculation cohorts are separate controls.

Cohort names and note text are edited as drafts until a valid change is committed. Empty edits show an inline explanation and retain the previous valid value for saves, including local links. Loading another investigation discards these editing drafts.

Layers represent the existing relationship sources. Their names, enabled state, order, color, and opacity are saved. Disabling a source preserves its underlying data. Mixed-origin edges remain available through other enabled sources and count once in analyses. Explicit layer styles override view styling.

Notes target the investigation, a node ID, an edge ID, or a cohort ID. Notes whose targets disappear remain available with an unresolved-target label. Notes are plain text and are escaped in the HTML record.

## Calculation scope and results

Each analytical operation has its own saved scope:

| Scope | Inputs |
| --- | --- |
| Full | All loaded nodes, ignoring display filters; enabled sources and applicable analysis settings remain in effect. |
| Visible | The current filtered graph at calculation start. |
| Cohort | The union of checked cohort members, ignoring display filters; enabled sources and applicable analysis settings remain in effect. |

Network statistics default to visible scope. Other operations retain full-population defaults. Sequence operations exclude nodes without sequences. Threshold analysis uses its sweep range. Distance matrices and tree inference require the complete applicable distances; display threshold pruning does not substitute for missing matrix entries. Bootstrap requires an eligible base tree matching the scoped taxa.

MST and nearest-neighbor calculations use the scoped population's eligible weighted candidate edges before threshold and previous nearest-neighbor pruning. This prevents the nearest-neighbor toggle from removing the inputs needed to calculate its own result. Distance matrices and tree inference likewise use the applicable complete distances between scoped nodes. Enabled source layers remain in effect.

For visible scope, restoring threshold/nearest-neighbor candidates never bypasses an explicit shared link rule. The same case-insensitive text, list, numeric, and canonical-source matching is used by display filters and calculations. Threshold sweeps likewise retain their sweep candidates while honoring explicit visible link rules. Full and cohort scopes continue to ignore display filters.

The panel previews input counts. Calculations run on isolated copies; outputs are applied by stable IDs after input and investigation checks. Failed, skipped, or superseded runs preserve earlier completed results and unrelated loaded data. Browser guardrails continue to apply.

Completed runs retain exact input rows, parameters, software identity, checksums, timestamps, and outputs. Approximation sampling and bootstrap batch seeds are retained with their outputs. Later input changes mark results stale. Restoring a snapshot preserves its saved outputs, including stale results; use **Run** to refresh them explicitly.

Snapshots do not provide a chronological action history or guarantee identical reruns across software versions. In development builds the software identity reports `development`; production builds use the generated version/commit metadata.

## Regression coverage

Focused unit coverage exercises round trips, binary inputs, legacy migration, manifest consistency, scope resolution, mixed-origin layers, missing references, orphan notes, calculation isolation, stable-ID result merges, and late-result rejection. Existing filtering, threshold, statistics, and renderer tests cover shared behavior. The investigation Cypress round-trip spec covers the combined UI and saved-file workflow; run it only when Cypress testing is requested.
