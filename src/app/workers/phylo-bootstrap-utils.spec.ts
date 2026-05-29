import {
  calculateSupportPercentages,
  collectTreeLeafIds,
  extractSplitKeysFromTree,
  formatBootstrapSupport,
  getMaxSupportDelta,
  normalizeSplitKey,
} from './phylo-bootstrap-utils';

describe('phylo bootstrap utils', () => {
  const allLeaves = ['A', 'B', 'C', 'D', 'E'];

  it('normalizes split keys to the smaller side', () => {
    expect(normalizeSplitKey(['A', 'B', 'C'], allLeaves)).toBe(normalizeSplitKey(['D', 'E'], allLeaves));
  });

  it('uses a lexicographic tie-break for equal split sizes', () => {
    expect(normalizeSplitKey(['C', 'D'], ['A', 'B', 'C', 'D'])).toBe(normalizeSplitKey(['A', 'B'], ['A', 'B', 'C', 'D']));
  });

  it('skips singleton and root-only splits', () => {
    expect(normalizeSplitKey(['A'], allLeaves)).toBeNull();
    expect(normalizeSplitKey(allLeaves, allLeaves)).toBeNull();
  });

  it('extracts informative splits from a tree', () => {
    const tree = {
      children: [
        { children: [{ id: 'A' }, { id: 'B' }] },
        { children: [{ id: 'C' }, { id: 'D' }] },
      ],
    };

    expect(collectTreeLeafIds(tree)).toEqual(['A', 'B', 'C', 'D']);
    expect(extractSplitKeysFromTree(tree)).toEqual([normalizeSplitKey(['A', 'B'], ['A', 'B', 'C', 'D'])]);
  });

  it('formats and compares support percentages', () => {
    expect(formatBootstrapSupport(85.234)).toBe('85.2%');
    expect(calculateSupportPercentages({ split: 17 }, 20).split).toBe(85);
    expect(getMaxSupportDelta({ split: 84.5 }, { split: 85.2 })).toBeCloseTo(0.7, 5);
  });
});

