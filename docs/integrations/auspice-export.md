# Export a MicrobeTrace tree to Auspice

MicrobeTrace can save the current Phylogenetic Tree as one Auspice v2 JSON file. The export is generated and downloaded in the browser. MicrobeTrace does not upload the file to Nextstrain or any other service.

## Export and open the file

1. Open the **Phylogenetic Tree** view.
2. Reroot, rotate, flip, or show a subtree if needed. The export uses the tree currently shown.
3. Select **Export Screen**, then **Auspice JSON**.
4. Review the filename and select **Save Auspice JSON**. MicrobeTrace adds `.json` when it is missing.
5. Open the file in one of these ways:
   - Visit [auspice.us](https://auspice.us), choose **Drag & drop files**, and drop the JSON file.
   - Install Auspice and run `auspice view --datasetDir <directory>`, following the [Auspice local-view instructions](https://docs.nextstrain.org/projects/auspice/en/stable/introduction/how-to-run.html).

The collapsed **Advanced options** section has separate checkbox menus for exported node metadata, Auspice color-by choices, and Auspice filters. Every eligible field is selected in all three menus by default, preserving the standard export behavior. Each menu has a **Select all** or **Deselect all** control. Removing a field from node metadata also removes it from the color-by and filter menus because those controls require the corresponding node attribute.

Do not upload identifiable, restricted, or otherwise sensitive records to a public service unless your data-use rules allow it. The downloaded file can include every safe scalar metadata field on exported tips and identifiable internal nodes, even fields that are not currently displayed. Use a local `auspice view` server when public upload is not appropriate.

## What is exported

The single JSON file follows the Auspice v2 `version`, `meta`, and `tree` structure. It includes:

- the current tree topology, visible branch orientation after rerooting, rotation, flipping, or subtree selection, and cumulative branch-length divergence;
- exact tip IDs and deterministic internal node names;
- safe scalar node metadata, including retained metadata on uniquely identifiable internal nodes, plus tip identity, cluster, degree, selected/visible state, and valid latitude/longitude values when present;
- the current node color-by field when that field is exportable;
- current resolved tip coordinates as a `microbetrace_location` geography, without external geocoding;
- stored bootstrap support when its split still matches a current branch; and
- categorical, continuous, boolean, and supported date colorings and filters.

The title uses a partner-provided dataset name when one is available. Otherwise it uses the source filename without its extension. Auspice chooses the palette and visual presentation.

## Divergence-only behavior and exclusions

MicrobeTrace exports branch distance as cumulative `div` values with root divergence set to zero. It does not claim the tree is time-scaled and does not emit `num_date`, because MicrobeTrace does not infer dates for internal ancestors. Date-like tip fields can still appear as temporal colorings.

The export deliberately omits:

- raw sequences and sequence-processing fields;
- arrays, objects, nulls, and non-finite numbers;
- force-layout coordinates, jitter values, and graphical objects;
- branch mutations, root sequences, genome annotations, entropy, and frequency data; and
- original Auspice metadata that MicrobeTrace no longer retains with the same meaning.

Export stops with an inline error instead of changing invalid data when a tip ID is missing or duplicated, or when a branch length is negative or non-finite.

## Round-trip limitations

An exported file can be imported into MicrobeTrace again, including its tree orientation, scalar tip fields, retained scalar fields on identifiable internal nodes, and synthetic tip coordinates. It is a new representation of MicrobeTrace's normalized current state, not a byte-for-byte copy of an originally imported Auspice dataset. Pixel-level styling, inferred ancestral geography, original internal node identifiers, original palettes, mutations, and unsupported Auspice sidecar data are not reconstructed.

Auspice displays sibling arrays in reverse traversal order compared with MicrobeTrace. The JSON therefore stores sibling arrays in the opposite order so that the visible tree orientation—including branch rotations—matches when the file is opened in Auspice. MicrobeTrace applies the same convention when an Auspice file is imported.

The implementation is checked against the official [Auspice v2 schema](https://github.com/nextstrain/augur/blob/master/augur/data/schema-export-v2.json). Release candidates should also pass `augur validate export-v2 <file.json>` and be opened in the release-target versions of auspice.us and `auspice view`.
