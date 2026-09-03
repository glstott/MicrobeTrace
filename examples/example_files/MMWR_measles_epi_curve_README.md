# MMWR-style Epi Curve example

`MMWR_measles_epi_curve.csv` is a synthetic, daily dataset designed to demonstrate the MMWR-style Epi Curve overlay. It spans January 1–September 30, 2025, with case-count bars and two precomputed cumulative vaccination series. The values resemble the visual structure of the supplied reference; they are not surveillance data.

## Load the data

1. Import `MMWR_measles_epi_curve.csv` as a node list.
2. Use `ID` as the node identifier.
3. Open the **Epi Curve** view and its settings.

## Graph settings

- **Graph Type:** `Multi: Overlay`
- **Date Field:** `No. of measles cases in 2025`
- **Bar Value:** `Measles case count`
- **Date Field 2:** `No. of MMR doses administered in 2025`
- **Line 1 Value:** `Cumulative MMR doses administered in 2025`
- **Line 1 Style:** `Solid`
- **Date Field 3:** `No. of MMR doses administered during the same period in 2024`
- **Line 2 Value:** `Cumulative MMR doses administered during the same period in 2024`
- **Line 2 Style:** `Dashed`
- **Bin Size:** `Day`
- **Epi Curve:** `Noncumulative`
- **Bar color:** `#9ec5e5`
- **Line 1 color:** `#005bbb`
- **Line 2 color:** `#005bbb`

Keep the plot noncumulative because the two line-value columns already contain cumulative totals.

## Legend and labels

- **Tick Unit:** `Day`
- **X-axis Interval:** `14`
- **Legend Position:** `Top`

## Titles and axes

- **Chart Title:** `FIGURE. Number of laboratory-confirmed measles cases, by onset date, and cumulative number of measles, mumps, and rubella vaccine doses administered — New Mexico, 2024 and 2025`
- **X-axis Label:** `Onset date`
- **Left Y-axis Label:** `Cumulative no. of MMR doses`
- **Right Y-axis Label:** `No. of measles cases in 2025`
- **Footnote:** `Abbreviation: MMR = measles, mumps, and rubella.`

## Annotations

Add these entries in the **Annotations** tab:

| Date | Label |
| --- | --- |
| `2025-02-14` | `measles outbreak declared` |
| `2025-08-14` | `end of last patient's infectious period` |
| `2025-09-26` | `measles outbreak declared over` |

The overlay automatically assigns the line series to the left axis and the bar series to the right axis.

## Regenerate the dataset

From the repository root, run:

```powershell
node .\scripts\generate-mmwr-epi-curve-example.js
```
