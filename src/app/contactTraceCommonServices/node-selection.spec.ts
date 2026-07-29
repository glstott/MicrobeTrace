import {
  applyNodeClickSelection,
  getSelectedNodeIds,
  syncSelectedNodeIds,
} from './node-selection';

describe('node selection', () => {
  it('synchronizes selected IDs to the main and filtered node collections', () => {
    const nodes = [
      { _id: 'a', selected: true },
      { _id: 'b', selected: false },
    ];
    const filteredNodes = [
      { _id: 'a', selected: true },
      { _id: 'b', selected: false },
    ];

    expect(syncSelectedNodeIds(nodes, filteredNodes, new Set(['b']))).toBeTrue();
    expect(getSelectedNodeIds(nodes)).toEqual(new Set(['b']));
    expect(getSelectedNodeIds(filteredNodes)).toEqual(new Set(['b']));
    expect(syncSelectedNodeIds(nodes, filteredNodes, new Set(['b']))).toBeFalse();
  });

  it('supports single selection and additive toggling', () => {
    const nodes = [
      { _id: 'a', selected: true },
      { _id: 'b', selected: false },
      { _id: 'c', selected: false },
    ];
    const filteredNodes = nodes.map(node => ({ ...node }));

    applyNodeClickSelection(nodes, filteredNodes, 'b', false);
    expect(getSelectedNodeIds(nodes)).toEqual(new Set(['b']));

    applyNodeClickSelection(nodes, filteredNodes, 'c', true);
    expect(getSelectedNodeIds(nodes)).toEqual(new Set(['b', 'c']));

    applyNodeClickSelection(nodes, filteredNodes, 'b', true);
    expect(getSelectedNodeIds(nodes)).toEqual(new Set(['c']));
    expect(getSelectedNodeIds(filteredNodes)).toEqual(new Set(['c']));
  });
});
