export interface PhyloBootstrapTreeNode {
  id?: string;
  children?: PhyloBootstrapTreeNode[];
}

const SPLIT_PART_SEPARATOR = '\u001f';

function uniqueSortedStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(value => typeof value === 'string' && value.length > 0))).sort();
}

function compareStringArrays(a: string[], b: string[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

export function splitKeyToLeafIds(splitKey: string): string[] {
  if (!splitKey) return [];
  return splitKey.split(SPLIT_PART_SEPARATOR).filter(Boolean);
}

export function collectTreeLeafIds(tree: PhyloBootstrapTreeNode): string[] {
  if (!tree) return [];
  const children = Array.isArray(tree.children) ? tree.children : [];
  if (children.length === 0) {
    return typeof tree.id === 'string' && tree.id.length > 0 ? [tree.id] : [];
  }
  return uniqueSortedStrings(children.flatMap(child => collectTreeLeafIds(child)));
}

export function normalizeSplitKey(leafIds: string[], allLeafIds: string[]): string | null {
  const all = uniqueSortedStrings(allLeafIds);
  const allSet = new Set(all);
  const subset = uniqueSortedStrings(leafIds).filter(id => allSet.has(id));
  const subsetSet = new Set(subset);
  const complement = all.filter(id => !subsetSet.has(id));

  if (all.length < 4 || subset.length <= 1 || complement.length <= 1) {
    return null;
  }

  let selected: string[];
  if (subset.length < complement.length) {
    selected = subset;
  } else if (subset.length > complement.length) {
    selected = complement;
  } else {
    selected = compareStringArrays(subset, complement) <= 0 ? subset : complement;
  }

  return selected.length > 1 ? selected.join(SPLIT_PART_SEPARATOR) : null;
}

export function extractSplitLeafIdsFromTree(
  tree: PhyloBootstrapTreeNode,
  allLeafIds: string[] = collectTreeLeafIds(tree)
): Record<string, string[]> {
  const allLeaves = uniqueSortedStrings(allLeafIds);
  const splits: Record<string, string[]> = {};

  const visit = (node: PhyloBootstrapTreeNode): string[] => {
    const children = Array.isArray(node?.children) ? node.children : [];
    if (children.length === 0) {
      return typeof node?.id === 'string' && node.id.length > 0 ? [node.id] : [];
    }

    const leaves = uniqueSortedStrings(children.flatMap(child => visit(child)));
    const splitKey = normalizeSplitKey(leaves, allLeaves);
    if (splitKey) {
      splits[splitKey] = splitKeyToLeafIds(splitKey);
    }
    return leaves;
  };

  if (tree) {
    visit(tree);
  }

  return splits;
}

export function extractSplitKeysFromTree(
  tree: PhyloBootstrapTreeNode,
  allLeafIds: string[] = collectTreeLeafIds(tree)
): string[] {
  return Object.keys(extractSplitLeafIdsFromTree(tree, allLeafIds)).sort();
}

export function formatBootstrapSupport(percent: number): string {
  const finitePercent = Number.isFinite(percent) ? percent : 0;
  const clamped = Math.max(0, Math.min(100, finitePercent));
  return `${clamped.toFixed(1)}%`;
}

export function calculateSupportPercentages(
  countsBySplit: Record<string, number>,
  completedReplicates: number
): Record<string, number> {
  const supportBySplit: Record<string, number> = {};
  const denominator = Math.max(1, completedReplicates);
  Object.keys(countsBySplit).forEach(splitKey => {
    supportBySplit[splitKey] = (countsBySplit[splitKey] / denominator) * 100;
  });
  return supportBySplit;
}

export function getMaxSupportDelta(
  previousSupportBySplit: Record<string, number> | null,
  currentSupportBySplit: Record<string, number>
): number | null {
  if (!previousSupportBySplit) return null;
  let maxDelta = 0;
  Object.keys(currentSupportBySplit).forEach(splitKey => {
    const previous = previousSupportBySplit[splitKey] ?? 0;
    const current = currentSupportBySplit[splitKey] ?? 0;
    maxDelta = Math.max(maxDelta, Math.abs(current - previous));
  });
  return maxDelta;
}

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

