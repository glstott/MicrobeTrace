# MMWR-Style Mixed Epi Curve — Design QA

## Evidence

- Reference: `C:\Users\qkx2\AppData\Local\Temp\codex-clipboard-d2bfb0cf-68cc-402e-9101-7fa7c8bd3100.png`
- Final implementation capture: `output/playwright/mmwr-epi/implementation-mixed-epi-reference-size.png`
- Combined comparison input: `output/playwright/mmwr-epi/reference-vs-implementation.png`
- Constrained-panel capture: `output/playwright/mmwr-epi/implementation-mixed-epi-constrained-final.png`
- Browser: Microsoft Edge 151 through Playwright CLI
- Comparison viewport: 1821 × 757 CSS pixels
- Compared chart dimensions: 1260 × 586 CSS pixels, captured at CSS-pixel density
- Responsive check viewport: 1280 × 720 CSS pixels

## Compared State

- MicrobeTrace sample dataset
- `Mixed: Bars + Lines`
- Daily bins
- One interval bar series, one cumulative solid-line series, and one cumulative dashed-line series
- Both Y axes, publication title/subtitle/axis labels/footnote, legend, and one dated callout visible
- The unrelated local-instance URL warning was hidden only while capturing chart evidence because its fixed red banner overlaps element screenshots; it was not changed in application code.

## QA History

1. P1 — Dense short date domains produced adjacent end-of-month and start-of-month tick labels in a constrained panel. Replaced reset-prone calendar intervals with explicit, width-aware tick values. Resolved.
2. P1 — The initial callout position could collide with a left-positioned legend. Moved default/reset label positions lower in the plot while retaining normalized coordinates. Resolved.
3. P2 — The publication plot lacked the reference figure's top frame line. Added a top plot rule consistent with the existing axis strokes. Resolved.
4. P2 — Invalid date strings generated Moment fallback warnings during aggregation. Added strict ISO and common epidemiologic date parsing while continuing to skip invalid dates. Resolved.

## Final Review

- Typography and hierarchy: publication title, subtitle, legend, axes, annotation, and footnote are readable at desktop and constrained sizes.
- Layout and spacing: dual axes, plot frame, legend, marks, and publication text remain separated without clipping or overlap.
- Responsiveness: the constrained capture preserves all three mark families, both axes, date ticks, callout, and figure text.
- Color and marks: bar fill/outline and solid/dashed line samples match their plotted series; colors remain user-configurable and default from existing Epi Curve settings.
- States and interactions: empty and invalid configuration states, shared tooltip, annotation drag, keyboard nudge, resize persistence, and session recall were exercised in the browser.
- Accessibility: callout labels are keyboard focusable, expose an accessible move label, and support arrow-key movement with Shift for larger steps.
- Remaining differences from the MMWR reference are dataset-specific values, date ranges, series labels, and user-selected colors rather than unresolved visual defects.

final result: passed
