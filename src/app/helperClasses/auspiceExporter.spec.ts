import { canonicalSplitKey } from '@app/workers/phylogenetic-bootstrap-utils';
import Ajv from 'ajv';
import draft6MetaSchema from 'ajv/dist/refs/json-schema-draft-06.json';
import annotationsSchema from './testData/auspice-annotations-schema.pinned.json';
import auspiceConfigSchema from './testData/auspice-config-v2-schema.pinned.json';
import rootSequenceSchema from './testData/auspice-root-sequence-schema.pinned.json';
import auspiceV2Schema from './testData/auspice-v2-schema.pinned.json';
import {
  AuspiceExportError,
  buildAuspiceV2Dataset,
  ensureAuspiceJsonFilename,
} from './auspiceExporter';

describe('Auspice v2 exporter', () => {
  const auspiceDisplayLeafOrder = (node: any): string[] => {
    const children = Array.isArray(node?.children) ? node.children : [];
    return children.length
      ? [...children].reverse().flatMap(auspiceDisplayLeafOrder)
      : [String(node?.name ?? '')];
  };

  const fourTipTree = () => ({
    id: 'original-root',
    length: 0,
    children: [
      {
        id: 'left-clade',
        length: 0.1,
        children: [
          { id: 'A', length: 0.2 },
          { id: 'B', length: 0.3 },
        ],
      },
      {
        id: '',
        length: 0.4,
        children: [
          { id: 'C', length: 0.5 },
          { id: 'D', length: 0.6 },
        ],
      },
    ],
  });

  it('creates a deterministic v2 divergence tree and preserves current Auspice display order', () => {
    const dataset = buildAuspiceV2Dataset({
      tree: fourTipTree(),
      title: 'Current tree',
      updated: '2026-09-22',
    });

    expect(dataset.version).toBe('v2');
    expect(dataset.meta).toEqual(jasmine.objectContaining({
      title: 'Current tree',
      updated: '2026-09-22',
      panels: ['tree'],
      display_defaults: { distance_measure: 'div' },
    }));
    expect(dataset.tree.name).toBe('NODE_0000000');
    expect(dataset.tree.node_attrs.div).toBe(0);
    expect(dataset.tree.branch_attrs?.labels?.microbetrace).toBe('original-root');

    const left = dataset.tree.children!.find(child => (
      child.branch_attrs?.labels?.microbetrace === 'left-clade'
    ))!;
    const right = dataset.tree.children!.find(child => child !== left)!;
    expect(left.name).toBe('NODE_0000001');
    expect(right.name).toBe('NODE_0000002');
    expect(left.node_attrs.div).toBeCloseTo(0.1, 10);
    expect(left.children!.map(child => child.name)).toEqual(['B', 'A']);
    expect(left.children!.find(child => child.name === 'A')!.node_attrs.div).toBeCloseTo(0.3, 10);
    expect(left.children!.find(child => child.name === 'B')!.node_attrs.div).toBeCloseTo(0.4, 10);
    expect(right.children!.map(child => child.name)).toEqual(['D', 'C']);
    expect(right.children!.find(child => child.name === 'C')!.node_attrs.div).toBeCloseTo(0.9, 10);
    expect(right.children!.find(child => child.name === 'D')!.node_attrs.div).toBeCloseTo(1, 10);
    expect(auspiceDisplayLeafOrder(dataset.tree)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('avoids collisions between generated internal names and sample IDs', () => {
    const dataset = buildAuspiceV2Dataset({
      tree: {
        children: [
          { id: 'NODE_0000000', length: 1 },
          { id: 'sample-2', length: 1 },
        ],
      },
    });

    expect(dataset.tree.name).toBe('NODE_0000001');
    expect(dataset.tree.children!.map(child => child.name)).toEqual(['sample-2', 'NODE_0000000']);
    expect(auspiceDisplayLeafOrder(dataset.tree)).toEqual(['NODE_0000000', 'sample-2']);
  });

  it('exports all safe scalars, infers coloring types, and remaps reserved fields', () => {
    const nodes = [
      {
        _id: 'A', id: 'A', group: 'alpha', score: 1.5, event_date: '2026-01-01',
        selected: true, visible: false, div: 'source-div', 'field with spaces': 'one',
        seq: 'ACGT', _diff: 'A1G', x: 50, index: 0, hasDistance: false, nodeSize: 20,
        nested: { unsafe: true }, values: ['unsafe'],
      },
      {
        _id: 'B', id: 'B', group: 'beta', score: 2.5, event_date: '2026-01-02',
        selected: false, visible: true, div: 'source-div-2', 'field with spaces': 'two',
        seq: 'AGGT', _diff: 'C2T', x: 75, index: 1, hasDistance: true, nodeSize: 20,
        nested: { unsafe: true }, values: ['unsafe'],
      },
    ];
    const dataset = buildAuspiceV2Dataset({
      tree: { children: [{ id: 'A', length: 0.1 }, { id: 'B', length: 0.2 }] },
      nodes,
      nodeFields: [
        '_id', 'id', 'group', 'score', 'event_date', 'selected', 'visible', 'div',
        'field with spaces', 'seq', '_diff', 'x', 'index', 'hasDistance', 'nodeSize',
        'nested', 'values',
      ],
      colorBy: 'group',
      temporalFields: ['event_date'],
    });

    const colorings = dataset.meta.colorings!;
    expect(colorings).toContain(jasmine.objectContaining({ key: 'group', type: 'categorical' }));
    expect(colorings).toContain(jasmine.objectContaining({ key: 'score', type: 'continuous' }));
    expect(colorings).toContain(jasmine.objectContaining({ key: 'event_date', type: 'temporal' }));
    expect(colorings).toContain(jasmine.objectContaining({ key: 'selected', type: 'boolean' }));
    expect(colorings).toContain(jasmine.objectContaining({ key: 'visible', type: 'boolean' }));
    expect(colorings).toContain(jasmine.objectContaining({ key: 'microbetrace_div', title: 'div' }));
    expect(colorings).toContain(jasmine.objectContaining({ key: 'microbetrace_field_with_spaces', title: 'field with spaces' }));
    expect(colorings.some(coloring => (
      ['seq', '_diff', 'x', 'index', 'hasDistance', 'nodeSize', 'nested', 'values'].includes(coloring.key)
    ))).toBeFalse();
    expect(dataset.meta.display_defaults.color_by).toBe('group');
    expect(dataset.meta.filters).toEqual(colorings.map(coloring => coloring.key));

    const leafA = dataset.tree.children!.find(child => child.name === 'A')!;
    expect(leafA.node_attrs.group).toEqual({ value: 'alpha' });
    expect(leafA.node_attrs.score).toEqual({ value: 1.5 });
    expect(leafA.node_attrs.selected).toEqual({ value: true });
    expect(leafA.node_attrs.microbetrace_div).toEqual({ value: 'source-div' });
    expect(leafA.node_attrs.seq).toBeUndefined();
    expect(JSON.stringify(dataset)).not.toContain('ACGT');
  });

  it('adds a partial map from resolved and configured coordinates', () => {
    const dataset = buildAuspiceV2Dataset({
      tree: fourTipTree(),
      nodes: [
        { _id: 'A', _lat: 13.4, _lon: 144.7 },
        { _id: 'B', latitude: '18.5N', longitude: '66.1W' },
        { _id: 'C', lat_field: '34.1', lon_field: '-118.2' },
        { _id: 'D', latitude: 95, longitude: 200 },
      ],
      latitudeField: 'lat_field',
      longitudeField: 'lon_field',
    });

    expect(dataset.meta.panels).toEqual(['tree', 'map']);
    expect(dataset.meta.display_defaults.geo_resolution).toBe('microbetrace_location');
    expect(dataset.meta.geo_resolutions).toEqual([jasmine.objectContaining({
      key: 'microbetrace_location',
      title: 'MicrobeTrace location',
      demes: {
        A: { latitude: 13.4, longitude: 144.7 },
        B: { latitude: 18.5, longitude: -66.1 },
        C: { latitude: 34.1, longitude: -118.2 },
      },
    })]);
    expect(dataset.meta.colorings).toContain(jasmine.objectContaining({
      key: 'microbetrace_location',
      type: 'categorical',
    }));

    const leaves = dataset.tree.children!.flatMap(branch => branch.children || []);
    expect(leaves.find(leaf => leaf.name === 'A')!.node_attrs.microbetrace_location).toEqual({ value: 'A' });
    expect(leaves.find(leaf => leaf.name === 'D')!.node_attrs.microbetrace_location).toBeUndefined();
  });

  it('exports stored bootstrap support as a default branch label', () => {
    const tree = fourTipTree();
    const splitKey = canonicalSplitKey(['A', 'B'], ['A', 'B', 'C', 'D'])!;
    const dataset = buildAuspiceV2Dataset({
      tree,
      bootstrap: {
        labels: ['A', 'B', 'C', 'D'],
        supportBySplitKey: { [splitKey]: 97.25 },
        decimalLength: 2,
      },
    });

    expect(dataset.meta.display_defaults.branch_label).toBe('bootstrap');
    const left = dataset.tree.children!.find(child => (
      child.branch_attrs?.labels?.microbetrace === 'left-clade'
    ))!;
    expect(left.branch_attrs?.labels?.bootstrap).toBe('97.25');
    expect(left.branch_attrs?.labels?.microbetrace).toBe('left-clade');
  });

  it('rejects missing, duplicate, negative, and non-finite tree values', () => {
    expect(() => buildAuspiceV2Dataset({ tree: { children: [{ id: '', length: 1 }] } }))
      .toThrowError(AuspiceExportError, /non-empty sample ID/);
    expect(() => buildAuspiceV2Dataset({
      tree: { children: [{ id: 'A', length: 1 }, { id: 'A', length: 2 }] },
    })).toThrowError(AuspiceExportError, /duplicate sample ID/);
    expect(() => buildAuspiceV2Dataset({
      tree: { children: [{ id: 'A', length: -1 }, { id: 'B', length: 2 }] },
    })).toThrowError(AuspiceExportError, /negative branch length/);
    expect(() => buildAuspiceV2Dataset({
      tree: { children: [{ id: 'A', length: Number.NaN }, { id: 'B', length: 2 }] },
    })).toThrowError(AuspiceExportError, /non-finite branch length/);
  });

  it('normalizes download filenames', () => {
    expect(ensureAuspiceJsonFilename('tree')).toBe('tree.json');
    expect(ensureAuspiceJsonFilename('tree.JSON')).toBe('tree.JSON');
    expect(ensureAuspiceJsonFilename('')).toBe('microbetrace-auspice.json');
  });

  it('validates a generated rich fixture against the pinned official Auspice v2 schema', () => {
    const splitKey = canonicalSplitKey(['A', 'B'], ['A', 'B', 'C', 'D'])!;
    const dataset = buildAuspiceV2Dataset({
      tree: fourTipTree(),
      title: 'Synthetic compatibility fixture',
      updated: '2026-09-22',
      nodes: [
        { _id: 'A', cluster: 'one', score: 1, selected: true, visible: true, _lat: 33.7, _lon: -84.4 },
        { _id: 'B', cluster: 'one', score: 2, selected: false, visible: true, _lat: 40.7, _lon: -74 },
        { _id: 'C', cluster: 'two', score: 3, selected: false, visible: false },
        { _id: 'D', cluster: 'two', score: 4, selected: true, visible: true },
      ],
      nodeFields: ['_id', 'cluster', 'score', 'selected', 'visible'],
      colorBy: 'cluster',
      bootstrap: {
        labels: ['A', 'B', 'C', 'D'],
        supportBySplitKey: { [splitKey]: 98 },
      },
    });
    const ajv = new Ajv({ allErrors: true, strict: false });
    ajv.addMetaSchema(draft6MetaSchema);
    ajv.addSchema(auspiceConfigSchema);
    ajv.addSchema(annotationsSchema);
    ajv.addSchema(rootSequenceSchema);
    const validate = ajv.compile(auspiceV2Schema);

    expect(validate(dataset))
      .withContext(JSON.stringify(validate.errors, null, 2))
      .toBeTrue();
  });
});
