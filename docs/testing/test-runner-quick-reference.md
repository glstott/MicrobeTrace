# Test Runner Quick Reference

This repo already supports targeted test runs. You do not need to run the full suite for every view-level change.

## What Is Available Today

- Angular unit tests run through `ng test`, which supports `--include`.
- Cypress E2E runs through `npx cypress run`, which supports `--spec`.
- Most maintained coverage in this repo is Cypress-based, so view-specific validation will usually mean running one or a few Cypress specs rather than the entire suite.

## Complete Standard Regression

The normal `e2e:journeys:all:local:chrome` command now discovers all standard ingestion/journey, view-state, and contract specs. It uses alphabetical batches of at most 25 specs, with a 45-minute timeout per batch, against one server on port 4210. Chrome is preferred; missing Chrome automatically substitutes Electron. Performance, stress, dedicated parity captures and the five dedicated large-data journeys remain separate.

In PowerShell, start each Cypress-related command with the environment cleanup below. Use `npm.cmd` rather than `npm.ps1`:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm.cmd run start:local-cypress
```

In another terminal:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm.cmd run e2e:journeys:all:local:chrome
```

`npm.cmd run e2e` owns the server for the whole run and stops it afterward. The direct local commands reuse an existing server, leaving it running for its owner. The runner clears only previous-date test processes associated with this checkout or Cypress; it preserves unrelated same-day processes.

Each batch retains complete logs and Cypress JSON results under a dated `tmp/cypress-regression-*` directory, plus a checkpointed `report.json` with passed, failed, pending, skipped, duration and retry information. Every final failing spec is rerun in isolation; retry-only passes and isolation passes are distinguished from persistent failures. Attribution to branch changes still requires reviewing the diff and, where uncertain, comparing the base revision. An incomplete batch is reported as incomplete coverage.

If a process or browser is interrupted, restart the same application server, then resume with the original output directory. Completed batches are retained, incomplete batches are rerun, and the interruption remains recorded:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
node scripts/run-cypress-regression.js --suite all --output tmp/cypress-regression-YOUR-RUN --resume
```

The corresponding `flows`, `view-state` and `contracts` scripts use the same discovery and reporting. `npm.cmd run test:regression-plan` checks discovery without running Cypress.

## Run One Unit Spec

```bash
npm test -- --watch=false --include src/app/app.component.spec.ts
```

Useful variations:

- Run every spec in a folder:

```bash
npm test -- --watch=false --include src/app/visualizationComponents/GanttComponent/
```

- Run more than one spec:

```bash
npm test -- --watch=false --include src/app/app.component.spec.ts --include src/shared/dnd.directive.spec.ts
```

Notes:

- `npm test` defaults to watch mode, so add `--watch=false` for one-off verification.
- Angular resolves `--include` against the project root.
- Current unit coverage is limited, so a local view fix may still need Cypress coverage to be meaningful.

## Run One Cypress Spec

Start the stable local app server in one terminal:

```bash
npm run start:local-cypress
```

Then run only the relevant spec in another terminal:

```bash
npm run e2e:journeys:spec:local -- --spec cypress/e2e/journeys/flows/map-navigation-uploaded.cy.ts
```

Useful variations:

- Run a view-state spec:

```bash
npm run e2e:journeys:spec:local -- --spec cypress/e2e/view-state/twod-view.cy.ts
```

- Run multiple specs:

```bash
npm run e2e:journeys:spec:local -- --spec "cypress/e2e/journeys/flows/map-navigation-uploaded.cy.ts,cypress/e2e/journeys/flows/map-export-uploaded.cy.ts"
```

- Use Chrome instead of Electron:

```bash
npm run e2e:journeys:spec:local -- --browser chrome --spec cypress/e2e/journeys/flows/map-navigation-uploaded.cy.ts
```

## When a Narrow Run Is Enough

A targeted run is usually enough when the change is local to:

- one Angular component or service with existing unit coverage
- one visualization's view mechanics
- one uploaded-data journey
- one export flow
- one bug fix with a clear regression spec

## When To Run More Than the Local Slice

Run the broader suites when the change touches shared behavior such as:

- `CommonService` or other shared services
- file ingestion or prelaunch settings
- dashboard propagation
- global styling or filtering behavior
- dataset profile helpers under `cypress/e2e/journeys/datasets/`
- shared Cypress helpers or selectors under `cypress/support/`
- routing, app bootstrap, or cross-view state

Recommended broader commands:

```bash
npm run e2e:journeys:flows:local
```

```bash
npm run e2e:journeys:view-state:local
```

```bash
npm run e2e:journeys:contracts:local
```

```bash
npm run e2e
```

## Practical Rule

Start with the smallest spec that directly covers the change. If the edit touched shared infrastructure or changed behavior used by more than one view, widen the run before merging.

## Codex Prompt For Targeted Test Selection

Use this when you want Codex to inspect the current local changes and tell you which targeted command to run.

```text
Review the current local changes in this MicrobeTrace checkout and recommend the smallest meaningful test run.

Please:
1. Inspect the changed files and diffs.
2. Map the changes to the most relevant existing tests in this repo.
3. Prefer maintained Cypress specs under `cypress/e2e/ingestion/`, `cypress/e2e/journeys/flows/`, and `cypress/e2e/view-state/`, plus any directly relevant Angular unit specs.
4. If the change is isolated, output one exact runnable command, preferably:
   `npm run e2e:journeys:spec:local -- --spec "..."`
5. If multiple specs are needed, combine them into one `--spec` argument when reasonable.
6. If the change is broad or shared, say that the narrow slice is not enough and give the next wider command to run instead.
7. Keep the answer short:
   - `Why these tests`
   - `Command to run`
   - `Optional wider follow-up`
```

Example of the kind of output to ask for:

```bash
npm run e2e:journeys:spec:local -- --spec "cypress/e2e/journeys/flows/map-navigation-uploaded.cy.ts,cypress/e2e/journeys/flows/map-export-uploaded.cy.ts"
```
