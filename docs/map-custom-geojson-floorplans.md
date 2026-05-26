# Map View Custom Floorplans and GeoJSON

MicrobeTrace Map View can show a user-provided background behind the network. Use this when the investigation space is not a regular geographic map, such as a hospital floor, clinic, ward, workplace, shelter, school, lab, or event venue.

The new background can be either:

- an image file, such as a PNG, JPEG, GIF, WebP, BMP, or SVG floorplan
- a GeoJSON file, such as a `FeatureCollection` with room polygons and wall lines

Nodes and links continue to use the normal Map View styling controls. When a custom background is shown, MicrobeTrace hides the basemap, satellite, country, state, and county layers so the floorplan is the only background.

## Choosing a Workflow

Use an image floorplan when you already have a drawing, screenshot, PDF export, or diagram image and you only need to place nodes on top of it.

Use a GeoJSON floorplan when you want the background itself to be made of simple map features such as room polygons, corridors, walls, zones, or points.

Use GeoJSON as a location data file when each GeoJSON feature represents a node location and should be matched to a node by ID. In that workflow, MicrobeTrace extracts feature centers into node fields named `GeoJSON Latitude`, `GeoJSON Longitude`, and `GeoJSON Feature ID`.

## Loading a Custom Background

1. Load the usual node and link data.
2. Open `Map View`.
3. Open `Geospatial Settings`.
4. Open the `Components` tab.
5. Expand `User Provided`.
6. Use `Background` to choose a GeoJSON or image file.
7. Keep `Layer` set to `Show`.
8. Use `Center` or `Center Screen` to fit the nodes and background.

Only one user-provided background is active through this control. Loading a GeoJSON file clears the uploaded image background, and loading an image clears the uploaded GeoJSON background.

## Providing Coordinates for an Image Floorplan

Image floorplans do not use real-world latitude and longitude. MicrobeTrace gives the image a normalized local coordinate plane and reuses the Map View `Latitude` and `Longitude` selectors as vertical and horizontal coordinate selectors:

- `Longitude` means floorplan `x`, moving left to right.
- `Latitude` means floorplan `y`, moving bottom to top.

After an image is loaded, the `Loaded` summary shows the image size and coordinate range, for example:

```text
floorplan.svg (100 x 100px, x 0-80.00, y 0-80.00)
```

The longer side of the image is scaled to `80`. The shorter side is scaled proportionally. For example:

- A `100 x 100px` image uses `x 0-80` and `y 0-80`.
- A `1600 x 900px` image uses `x 0-80` and `y 0-45`.
- A `900 x 1600px` image uses `x 0-45` and `y 0-80`.

If your node file already contains floorplan coordinates, add one column for `x` and one column for `y`, then select them in Map View:

```csv
id,floor_x,floor_y
A,12,8
B,35,18
C,60,30
```

In `Geospatial Settings > Data`, set:

- `Latitude` to `floor_y`
- `Longitude` to `floor_x`

If you are measuring positions from image pixels, convert them into the normalized coordinate range before loading the file. Use:

```text
scale = 80 / max(image_width_pixels, image_height_pixels)
floor_x = pixel_x_from_left * scale
floor_y = pixel_y_from_bottom * scale
```

Many image tools report `y` from the top of the image. In that case use:

```text
floor_y = (image_height_pixels - pixel_y_from_top) * scale
```

For a `1600 x 900px` floorplan, `scale` is `80 / 1600`, or `0.05`. A point `400px` from the left and `250px` from the top becomes:

```text
floor_x = 400 * 0.05 = 20
floor_y = (900 - 250) * 0.05 = 32.5
```

Use those values as `Longitude` and `Latitude` in MicrobeTrace.

## Manually Placing Nodes

If the node file does not already contain floorplan coordinates, place nodes directly in Map View:

1. Load and show the custom background.
2. Open `Components > User Provided > Manual Positions`.
3. Set `Positioning` to `On`.
4. Choose a visible node from `Node`.
5. Click the floorplan to place that node.
6. Use `Next Unplaced` to move through the remaining visible nodes.
7. Drag an existing marker to adjust its position.

When a custom background is shown, manual positions are saved on the node as:

- `map_floorplan_x`
- `map_floorplan_y`

These fields are used only while a custom floorplan background is shown. When no floorplan background is shown, Map View returns to the normal geographic fields and to regular manual map fields:

- `map_manual_latitude`
- `map_manual_longitude`

Use `Clear Selected` to remove one node position or `Clear All` to remove positions for all currently visible nodes in the current mode.

## Using a GeoJSON Background

GeoJSON coordinates must use GeoJSON order:

```text
[longitude, latitude]
```

For a floorplan, treat that as:

```text
[x, y]
```

The GeoJSON background and the node coordinates must use the same coordinate plane. If a room polygon spans `x 0-30` and `y 0-20`, the nodes should use matching `x` and `y` values.

MicrobeTrace can render these GeoJSON top-level types as a background:

- `FeatureCollection`
- `Feature`
- `GeometryCollection`
- `Point`
- `MultiPoint`
- `LineString`
- `MultiLineString`
- `Polygon`
- `MultiPolygon`

For simple floorplans, keep coordinates small and local, such as `0-30` by `0-20`. This makes it easier to reason about positions and keeps the floorplan close to the map projection's equator.

## Creating a Basic GeoJSON Floorplan

A basic floorplan can be a `FeatureCollection` with one polygon for the outer boundary and lines for interior walls.

Save this as a `.geojson` or `.json` file:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "name": "Clinic Floor"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            [0, 0],
            [30, 0],
            [30, 20],
            [0, 20],
            [0, 0]
          ]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "name": "Exam Room Wall"
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [10, 0],
          [10, 20]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "name": "Nurse Station Wall"
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [20, 0],
          [20, 20]
        ]
      }
    }
  ]
}
```

Then create node coordinates in the same plane:

```csv
id,floor_x,floor_y
case-001,5,5
case-002,15,12
case-003,25,7
```

In Map View, set `Latitude` to `floor_y` and `Longitude` to `floor_x`, then load the GeoJSON through `Components > User Provided > Background`.

## Using GeoJSON to Assign Node Locations

You can also load a GeoJSON file through the Files screen as location data. This is useful when each GeoJSON feature corresponds to one node.

1. Include an ID in each GeoJSON feature. The ID can be the feature's top-level `id` or a property such as `id`, `node_id`, `Sample ID`, or `name`.
2. Make sure the IDs match the node IDs in your node file.
3. Load the node file and the GeoJSON file.
4. In the file table, leave the GeoJSON file type as `GeoJSON`.
5. Choose the GeoJSON `ID` field if MicrobeTrace does not select the right one automatically.
6. Launch the session.

MicrobeTrace calculates the center of each GeoJSON feature and writes it to matching nodes as:

- `GeoJSON Latitude`
- `GeoJSON Longitude`
- `GeoJSON Feature ID`

For points, the point coordinate is used directly. For lines and polygons, MicrobeTrace uses the center of the feature's coordinate bounds. If at least one feature matches a node, Map View automatically selects `GeoJSON Latitude` and `GeoJSON Longitude` as the map coordinate fields.

Example GeoJSON location file:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "case-001",
      "properties": {
        "room": "Exam 1"
      },
      "geometry": {
        "type": "Point",
        "coordinates": [5, 5]
      }
    },
    {
      "type": "Feature",
      "id": "case-002",
      "properties": {
        "room": "Exam 2"
      },
      "geometry": {
        "type": "Point",
        "coordinates": [15, 12]
      }
    }
  ]
}
```

With a matching node file:

```csv
id,status
case-001,Confirmed
case-002,Probable
```

## Saving and Reopening

Custom GeoJSON backgrounds, image backgrounds, background visibility, and manual floorplan positions are saved in MicrobeTrace session files. Reopening the session restores the floorplan and the node positions.

## Troubleshooting

If the background loads but nodes are missing, check that `Latitude` and `Longitude` are set to numeric fields. For floorplans, `Latitude` should be the vertical `y` field and `Longitude` should be the horizontal `x` field.

If an image floorplan appears but node positions are flipped vertically, the source coordinates were probably measured from the top of the image. Convert them with `floor_y = (image_height_pixels - pixel_y_from_top) * scale`.

If a GeoJSON file does not render, make sure it is valid JSON and contains one of the supported GeoJSON types. A `FeatureCollection` must have at least one feature.

If a GeoJSON location file does not match nodes, check the selected `ID` field and confirm that the GeoJSON feature IDs exactly match the node IDs.
