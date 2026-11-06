# Reproducibility report performance

The opt-in report benchmark measures the saved investigation workflow with many large images. It uses the configured six-node synthetic investigation, including cohorts, mixed relationship sources, notes and a completed calculation. It isolates image-archive costs from large-graph analysis costs.

| Scenario | PNG images | Pixels per image | Historical data revisions |
| --- | ---: | --- | ---: |
| Control | 1 | 1280 × 720 | 1 |
| Large | 12 | 1600 × 900 | 4 |
| Stress, explicitly enabled | 24 | 1920 × 1080 | 8 |

Images contain deterministic, opaque RGB noise generated from seed 41001 plus the image index. They compress poorly, which exercises large file payloads without checking binary fixtures into Git. Figures share supporting records within a revision and retain distinct historical records across revisions. PNG byte sizes can vary with the browser encoder; every result records the actual image and bundle sizes.

## Run

Use Chrome for heap measurements. Start one application server in a separate PowerShell terminal:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm.cmd run start:local-cypress
```

Run the control and large scenarios against that server:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm.cmd run e2e:perf:investigation:local
```

For a particular scenario, pass its ID; the 24-image case also requires `perfStress=1`:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm.cmd run e2e:perf:investigation:local -- --env perfMode=1,perfReports=1,perfStress=1,perfReportScenario=stress-report-24-images
```

Clear only prior-date stale test processes before running Cypress, as described in the repository testing instructions. The report suite has no retries, uses a fifteen-minute command allowance per scenario, and is excluded unless `perfReports=1`. Standard journeys and normal regressions do not run it. A fresh fixture is loaded for every scenario; the probe removes only the local-link keys it creates, restores its hooks, and returns to the original small investigation afterward.

## Measurements and checks

- `fixturePreparationMs` and `imageRetentionMs` report synthetic PNG preparation and the normal image-retention pipeline separately from saving.
- `bundleSaveMs` includes the application's complete capture, HTML generation and ZIP compression. `bundleCaptureMs` and `htmlRenderMs` identify substeps; they overlap with the total and must not be added to it.
- Save timing ends at the application's download handoff. The probe retains that Blob in memory for reopening; operating-system download and physical disk I/O are excluded.
- `fileReopenMs` uses **File → Add Data**, the ordinary ZIP loader, integrity validation, and dashboard restoration. It waits for the replacement investigation and all restored views.
- `localLinkSaveMs` includes capture, JSON serialization and IndexedDB writing. `localLinkCaptureMs` identifies its capture substep. `localLinkReadMs` measures the normal local-link service read; `localLinkReopenMs` also includes validation and rendering through the local-link restore path.
- File and local-link reopening run inside the already loaded application. Browser startup, navigation and application-code loading are outside these timings.
- `storageInitializeMs` records the IndexedDB driver's readiness separately, before storage hooks are attached. Local-link save/read figures therefore use an initialized driver.
- Payload metrics record original PNG bytes, compressed bundle bytes, uncompressed session/HTML bytes, historical-record count, local-link JSON character count, and browser storage-usage/quota estimates.
- Heap samples are taken every 50 ms and at phase boundaries. Reports include initial, final, observed peak, heap limit and sample count. Unavailable measurements are `null`. These are **observed JavaScript heap**, excluding native image/ZIP buffers and allocations missed while the main thread is blocked. They are not total process memory or a guaranteed absolute peak. Heartbeat gaps and long tasks help identify blocking work.
- Initial heap is sampled after capturing the original small fixture; final heap is sampled before cleanup. The probe does not force garbage collection during timed operations, so the final value can include uncollected temporary objects and does not by itself identify a memory leak.
- Reopening must preserve figure IDs, byte checksums, historical references and completed result IDs/outputs without replacement calculations. The ZIP directory must contain every original image and historical archive.
- After a successful local-link save/reopen, a synthetic `QuotaExceededError` checks the existing error message, unchanged investigation and earlier saved link. This checks failure handling without filling browser storage. A real storage failure is recorded as an unavailable local-link outcome and must be investigated separately from timing results.

The browser probe is shared by the Cypress spec and ad hoc Playwright measurements. It is test code only; it does not add controls or instrumentation to the shipped application.

## Results and interpretation

Cypress writes the normal performance artifacts in `cypress/downloads/performance/`, including the full probe result under `app.performance.investigationReport`. Existing performance-summary and budget tools can compare its numeric metrics across runs. No timing limit is enforced until a representative baseline and reviewed budgets exist.

Collect at least five samples per scenario on the same browser, build and hardware before treating timings as a baseline. Record the browser version, development versus production build, memory flags, and whether garbage collection was requested before each sample. Keep cold page loads and warm measurements separate. Report median and high-percentile timings, byte sizes, observed heap and local-link outcomes; one successful large save does not establish a browser's maximum capacity.

## Baseline collected 5 November 2026

[Raw measurements and environment](baselines/investigation-reports-20261105.json) contain one control run and five large runs using this shared probe through Playwright. Chrome 156.0.8078.80 ran the development build on Windows, with precise memory reporting enabled and garbage collection requested before each sample. The control is a single reference measurement. The five-sample large baseline has no enforced release budget; its nearest-rank p95 is the observed maximum.

| Measurement | One-image control | 12-image median | 12-image p95 |
| --- | ---: | ---: | ---: |
| Bundle preparation and download handoff | 1.64 s | 29.44 s | 29.62 s |
| Capture within bundle preparation | 0.34 s | 6.41 s | 6.59 s |
| HTML construction within bundle preparation | 0.17 s | 2.89 s | 2.92 s |
| File reopening | 0.99 s | 8.18 s | 8.32 s |
| Local-link capture and save | 0.40 s | 6.79 s | 6.86 s |
| Local-link service read | 0.015 s | 0.128 s | 0.144 s |
| Local-link reopening including validation/rendering | 1.17 s | 6.83 s | 6.97 s |

The large case contained **56.7 MiB of PNG bytes**, producing a **228.4 MiB ZIP**, a **151.5 MiB HTML record**, and a **76.0 MiB session**. Estimated browser storage grew by **76.1 MiB** per local link. Observed JavaScript heap peaks ranged from **1.48 to 1.80 GiB**. The largest heartbeat gap was **12.5 seconds**. Final heap measurements include temporary objects awaiting collection; these observations do not establish a memory leak.

Every run preserved images, historical references and completed outputs through both reopen paths, with no replacement calculations. The simulated quota failure preserved the current investigation and earlier saved link. Generated local links were removed, and the original small fixture was restored. A file-loading bug discovered by the probe was also repaired: file processing now subscribes to the Files pane's events when another pane precedes it. All **111 focused unit tests passed**; Cypress was not run for this check. The optional 24-image stress tier remains unmeasured.

The main follow-up is to reduce repeated image encoding and main-thread serialization/validation work while preserving offline images and integrity checks. The bundle currently includes original PNG files plus encoded copies in the session and HTML; the HTML repeats each image URI for its download link and image element. This explains substantial file-size amplification. The measured heartbeat gaps also warrant profiling before deciding which operations to move to workers. These are opportunities identified by the benchmark, not performance fixes included with it.
