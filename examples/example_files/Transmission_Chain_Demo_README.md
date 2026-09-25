# Transmission Chain View demo dataset

This is a wholly synthetic outbreak dataset designed to demonstrate the Transmission Chain View. It contains 30 nodes in three connected outbreaks, two unlinked nodes, two link lists, branching transmission paths, four named facilities, missing facility values, and missing onset dates.

## Load the data

1. Add `Transmission_Chain_Demo_Nodes.csv` as a node list.
2. Add both `Transmission_Chain_Demo_Confirmed_Links.csv` and `Transmission_Chain_Demo_Probable_Links.csv` as link lists.
3. For each link list, use `source` as Field 1 and `target` as Field 2.
4. Process the files and open **Transmission Chain View**.

## Recommended demonstration

In **Layout**:

- Set **Date Field** to `Date of symptom onset Date`.
- Set **Y-Axis Field** to `Facility`.
- Increase **Y Spacing** if you want more separation between facility bands.
- Toggle the confirmed and probable files under **Link Lists** to show how evidence sources change the displayed chain.

In **Network → Display**:

- Start with **Stepped** to emphasize source-to-target timing.
- Switch to **Curved** or **Fan-out Curves** to highlight branching events such as `A01` and `B01`.

Useful comparisons:

- Set **Y-Axis Field** back to `None` to compare automatic connected-component grouping with facility grouping.
- Color nodes by `Case Classification` or `Outbreak` in Global Settings.
- Use `Unit` as the Y-axis field for a more detailed view.
- Look for the `(No Facility)` band and nodes with no onset date to demonstrate missing-value handling.

## Expected shape

- 30 nodes total
- 20 confirmed links
- 8 probable links
- 3 connected outbreak components (`Alpha`, `Bravo`, and `Charlie`)
- 2 unlinked nodes
- 4 named facility bands plus a missing-facility band

All names, dates, facilities, and relationships are fictional and intended only for product demonstration and testing.
