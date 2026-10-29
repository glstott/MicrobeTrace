import {
  buildThreeDGraph, normalizeThreeDViewState, readThreeDSettings, threeDNodeId, writeThreeDSettings,
} from './three-d-network.model';

describe('3D network data and saved state', () => {
  const settings = readThreeDSettings({});
  const color = () => '#123456';
  const camera = { position: { x: 10, y: 20, z: 30 }, target: { x: 0, y: 0, z: 0 } };

  it('keeps force-engine mutations out of the shared session, including 2D coordinates', () => {
    const nodes = [{ _id: 'A', x: 100, y: 200 }, { _id: 'B', x: 300, y: 400 }];
    const links = [{ source: 'A', target: 'B' }];
    const data = buildThreeDGraph(nodes, links, settings, color, color);
    data.nodes[0].x = -50;
    data.links[0].source = data.nodes[0];
    expect(nodes[0].x).toBe(100);
    expect(nodes[0].y).toBe(200);
    expect(links[0].source).toBe('A');
    expect(data.nodes[1].x).toBeUndefined();
  });

  it('drops dangling links, supports object endpoints, and preserves parallel links', () => {
    const data = buildThreeDGraph([{ _id: 'A' }, { _id: 'B' }], [
      { source: { _id: 'A' }, target: 'B' }, { source: 'A', target: { id: 'B' } },
      { source: 'A', target: 'hidden' },
    ], settings, color, color);
    expect(data.links.length).toBe(2);
    expect(data.links[0].source).toBe('A');
    expect(data.links[0].key).not.toBe(data.links[1].key);
  });

  it('preserves renderer node identity, coordinates, and velocity through filtering and restyling', () => {
    const initial = buildThreeDGraph([{ _id: 'A' }, { _id: 'B' }], [], settings, color, color);
    Object.assign(initial.nodes[0], { x: 12, y: 13, z: 14, vx: 2 });
    const filtered = buildThreeDGraph([{ _id: 'A' }], [], settings, () => '#ffffff', color,
      new Map(initial.nodes.map(node => [node.id, node])));
    expect(filtered.nodes[0]).toBe(initial.nodes[0]);
    expect(filtered.nodes[0].x).toBe(12);
    expect(filtered.nodes[0].vx).toBe(2);
    expect(filtered.nodes[0].color).toBe('#ffffff');
  });

  it('restores cached 3D positions when previously hidden nodes return', () => {
    const data = buildThreeDGraph([{ _id: 'A', x: 999 }], [], settings, color, color, new Map(),
      new Map([['A', { x: 1, y: 2, z: 3 }]]));
    expect(data.nodes[0].x).toBe(1);
    expect(data.nodes[0].z).toBe(3);
  });

  it('normalizes IDs without discarding zero and skips missing or duplicate IDs', () => {
    expect(threeDNodeId({ _id: 0 })).toBe('0');
    const data = buildThreeDGraph([{ _id: 0 }, { id: '0' }, {}], [], settings, color, color);
    expect(data.nodes.map(node => node.id)).toEqual(['0']);
  });

  it('uses safe node volumes for missing, zero, negative, or invalid sizes', () => {
    const data = buildThreeDGraph([0, -2, 'bad', null, 8].map((size, id) => ({ _id: id, size })), [],
      { ...settings, nodeSizeField: 'size' }, color, color);
    expect(data.nodes.map(node => node.value)).toEqual([1, 1, 1, 1, 8]);
  });

  it('keeps tooltip text as data, including markup and missing fields', () => {
    const data = buildThreeDGraph([{ _id: 'A', label: '<img src=x onerror=alert(1)>' }, { _id: 'B' }], [],
      { ...settings, nodeTooltipField: 'label' }, color, color);
    expect(data.nodes[0].tooltip).toBe('<img src=x onerror=alert(1)>');
    expect(data.nodes[1].tooltip).toBe('');
  });

  it('round-trips Classic widget names and clamps invalid controls', () => {
    const widgets = { '3DNet-node-radius': 100, '3DNet-link-transparency': -1, '3DNet-link-width': 'bad' };
    const parsed = readThreeDSettings(widgets);
    expect(parsed.nodeSize).toBe(20);
    expect(parsed.linkTransparency).toBe(0);
    expect(parsed.linkWidth).toBe(1.6);
    const output = {};
    writeThreeDSettings(output, parsed);
    expect(readThreeDSettings(output)).toEqual(parsed);
  });

  it('does not use 2D appearance settings as 3D settings or defaults', () => {
    const twoDWidgets = {
      'node-label-variable': 'State', 'node-label-size': 28,
      'node-tooltip-variable': ['Profession'], 'node-radius': 75, 'node-radius-variable': 'degree',
      'link-tooltip-variable': ['distance'], 'link-width': 12, 'link-opacity': 0.25,
    };
    expect(readThreeDSettings(twoDWidgets)).toEqual(readThreeDSettings({}));

    const widgets = { ...twoDWidgets, '3DNet-node-radius': 7, '3DNet-node-tooltip-variable': 'ID' };
    const before = readThreeDSettings(widgets);
    widgets['node-label-variable'] = 'Profession';
    widgets['node-radius'] = 90;
    widgets['link-width'] = 2;
    expect(readThreeDSettings(widgets)).toEqual(before);
  });

  it('changes 3D appearance without overwriting 2D settings or intentionally shared settings', () => {
    const independentWidgets = {
      'node-label-variable': 'State', 'node-label-size': 24, 'node-label-orientation': 'Left',
      'node-tooltip-variable': ['Profession'], 'node-radius': 35, 'node-radius-variable': 'degree',
      'link-tooltip-variable': ['distance'], 'link-width': 3, 'link-opacity': 0.8,
      'node-color': '#abcdef', 'link-color': '#123456', 'background-color': '#ffffff',
      'selected-color': '#ff6600', 'link-threshold': 16,
    };
    const widgets: Record<string, any> = JSON.parse(JSON.stringify(independentWidgets));
    writeThreeDSettings(widgets, {
      nodeSize: 9, nodeSizeField: 'degree', nodeTooltipField: 'ID',
      linkWidth: 2.7, linkTransparency: 0.65, linkTooltipField: 'source',
    });
    const remainingSettings = Object.fromEntries(Object.entries(widgets).filter(([key]) => !key.startsWith('3DNet-')));
    expect(remainingSettings).toEqual(independentWidgets);
    expect(readThreeDSettings(widgets).nodeSize).toBe(9);
  });

  it('round-trips a saved camera, frozen layout, and position dictionary', () => {
    const state = normalizeThreeDViewState({ version: 1, camera, layoutFrozen: true, positions: { A: { x: 1, y: 2, z: 3 } } });
    expect(normalizeThreeDViewState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(state.layoutFrozen).toBe(true);
    expect(state.positions.A.z).toBe(3);
  });

  it('rejects corrupt or future camera states, and coincident camera/target coordinates', () => {
    expect(normalizeThreeDViewState(null)).toBeNull();
    expect(normalizeThreeDViewState({ version: 2, camera })).toBeNull();
    expect(normalizeThreeDViewState({ version: 1, camera: { ...camera, position: { x: Infinity, y: 0, z: 1 } } })).toBeNull();
    expect(normalizeThreeDViewState({ version: 1, camera: { position: camera.target, target: camera.target } })).toBeNull();
  });

  it('discards invalid positions and handles node IDs such as __proto__ without prototype mutation', () => {
    const positions = JSON.parse('{"__proto__":{"x":1,"y":2,"z":3},"bad":{"x":null,"y":2,"z":3}}');
    const state = normalizeThreeDViewState({ version: 1, camera, positions });
    expect(Object.keys(state.positions)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(state.positions)).toBeNull();
    expect(state.positions['__proto__'].x).toBe(1);
  });
});
