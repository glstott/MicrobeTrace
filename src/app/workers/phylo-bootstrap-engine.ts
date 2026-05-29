import * as patristic from 'patristic';
import * as tn93 from 'tn93';
import type {
  PhyloBootstrapProgressResponse,
  PhyloBootstrapRequest,
  PhyloBootstrapResultResponse,
  PhyloBootstrapSequence,
} from './phylo-bootstrap.types';
import {
  calculateSupportPercentages,
  createSeededRandom,
  extractSplitKeysFromTree,
  extractSplitLeafIdsFromTree,
  getMaxSupportDelta,
} from './phylo-bootstrap-utils';

type ProgressCallback = (progress: Omit<PhyloBootstrapProgressResponse, 'type' | 'jobId'>) => void;
type CancellationCheck = () => boolean;

function normalizeMetric(metric: string): string {
  return (metric || 'snps').toLowerCase();
}

function normalizeStrategy(strategy: string): string {
  return (strategy || 'AVERAGE').toUpperCase();
}

function hasGap(char: string): boolean {
  return char === '-';
}

function snpDistance(sequenceA: string, sequenceB: string, columns: number[]): number {
  let distance = 0;
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i];
    const a = sequenceA[column] || '-';
    const b = sequenceB[column] || '-';
    if (!hasGap(a) && !hasGap(b) && a !== b) {
      distance++;
    }
  }
  return distance;
}

function sampleColumns(sequenceLength: number, random: () => number): number[] {
  const columns = new Array(sequenceLength);
  for (let i = 0; i < sequenceLength; i++) {
    columns[i] = Math.floor(random() * sequenceLength);
  }
  return columns;
}

function buildSampledSequences(sequences: string[], columns: number[]): string[] {
  return sequences.map(sequence => {
    let sampled = '';
    for (let i = 0; i < columns.length; i++) {
      sampled += sequence[columns[i]] || '-';
    }
    return sampled;
  });
}

function ambiguityFraction(sequence: Uint8Array): number {
  if (sequence.length === 0) return 0;
  let ambiguous = 0;
  for (let i = 0; i < sequence.length; i++) {
    if (sequence[i] > 3 && sequence[i] !== 17) {
      ambiguous++;
    }
  }
  return ambiguous / sequence.length;
}

function tn93DistanceMatrix(
  sequences: string[],
  columns: number[],
  strategy: string,
  ambiguityThreshold: number
): number[][] {
  const sampledSequences = buildSampledSequences(sequences, columns);
  const encoded = sampledSequences.map(sequence => tn93.toInts(sequence));
  const ambiguityFractions = encoded.map(ambiguityFraction);
  const n = sequences.length;
  const matrix = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      let mode = strategy;
      if (strategy === 'HIVTRACE-G') {
        mode = ambiguityFractions[i] < ambiguityThreshold && ambiguityFractions[j] < ambiguityThreshold
          ? 'RESOLVE'
          : 'AVERAGE';
      }
      const distance = tn93.onInts(encoded[i], encoded[j], mode);
      matrix[i][j] = matrix[j][i] = Number.isFinite(distance) && distance >= 0 ? distance : 0;
    }
  }

  return matrix;
}

function snpDistanceMatrix(sequences: string[], columns: number[]): number[][] {
  const n = sequences.length;
  const matrix = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      matrix[i][j] = matrix[j][i] = snpDistance(sequences[i], sequences[j], columns);
    }
  }
  return matrix;
}

function buildDistanceMatrix(
  sequences: string[],
  columns: number[],
  metric: string,
  strategy: string,
  ambiguityThreshold: number
): number[][] {
  if (metric === 'snps') {
    return snpDistanceMatrix(sequences, columns);
  }
  return tn93DistanceMatrix(sequences, columns, strategy, ambiguityThreshold);
}

function validateRequest(request: PhyloBootstrapRequest): { orderedSequences: string[]; sequenceLength: number } {
  const leafIds = request.leafIds || [];
  const sequenceById = new Map<string, PhyloBootstrapSequence>();
  (request.sequences || []).forEach(sequence => {
    sequenceById.set(sequence.id, sequence);
  });

  const orderedSequences = leafIds.map(id => sequenceById.get(id)?.sequence || '');
  const sequenceLength = orderedSequences[0]?.length || 0;
  if (leafIds.length < 4) {
    throw new Error('Bootstrapping requires at least four sequence-backed leaves.');
  }
  if (sequenceLength === 0) {
    throw new Error('Bootstrapping requires non-empty sequences.');
  }
  if (orderedSequences.some(sequence => sequence.length !== sequenceLength)) {
    throw new Error('Bootstrapping requires aligned sequences with equal lengths.');
  }

  return { orderedSequences, sequenceLength };
}

function emptyCounts(splitKeys: string[]): Record<string, number> {
  return splitKeys.reduce((counts, splitKey) => {
    counts[splitKey] = 0;
    return counts;
  }, {} as Record<string, number>);
}

function mergeCounts(target: Record<string, number>, source: Record<string, number>): void {
  Object.keys(source).forEach(splitKey => {
    target[splitKey] = (target[splitKey] || 0) + source[splitKey];
  });
}

function computeBootstrapBatch(
  size: number,
  leafIds: string[],
  sequences: string[],
  sequenceLength: number,
  referenceSplitSet: Set<string>,
  metric: string,
  strategy: string,
  ambiguityThreshold: number,
  random: () => number,
  isCancelled: CancellationCheck
): Record<string, number> {
  const batchCounts: Record<string, number> = {};

  for (let replicate = 0; replicate < size; replicate++) {
    if (isCancelled()) {
      break;
    }

    const columns = sampleColumns(sequenceLength, random);
    const matrix = buildDistanceMatrix(sequences, columns, metric, strategy, ambiguityThreshold);
    const tree = patristic.parseMatrix(matrix, leafIds);
    const splitKeys = extractSplitKeysFromTree(tree as any, leafIds);

    splitKeys.forEach(splitKey => {
      if (referenceSplitSet.has(splitKey)) {
        batchCounts[splitKey] = (batchCounts[splitKey] || 0) + 1;
      }
    });
  }

  return batchCounts;
}

function makeProgress(
  completedReplicates: number,
  requestedReplicates: number,
  supportBySplit: Record<string, number>,
  stable: boolean,
  stoppedEarly: boolean,
  maxDeltaPercentagePoints: number | null,
  stableBatchCount: number
): Omit<PhyloBootstrapProgressResponse, 'type' | 'jobId'> {
  return {
    completedReplicates,
    requestedReplicates,
    supportBySplit,
    stable,
    stoppedEarly,
    maxDeltaPercentagePoints,
    stableBatchCount,
  };
}

function delayForWorkerYield(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export async function runPhylogeneticBootstrap(
  request: PhyloBootstrapRequest,
  onProgress: ProgressCallback = () => undefined,
  isCancelled: CancellationCheck = () => false
): Promise<PhyloBootstrapResultResponse> {
  const { orderedSequences, sequenceLength } = validateRequest(request);
  const replicates = Math.max(1, Math.min(10000, Math.floor(request.replicates)));
  const batchSize = Math.max(1, Math.floor(request.batchSize || 10));
  const parallelism = Math.max(1, Math.min(4, Math.floor(request.parallelism || 1)));
  const metric = normalizeMetric(request.metric);
  const strategy = normalizeStrategy(request.ambiguityStrategy);
  const ambiguityThreshold = Number.isFinite(request.ambiguityThreshold) ? request.ambiguityThreshold : 0.015;
  const random = request.seed === undefined ? Math.random : createSeededRandom(request.seed);
  const referenceSplitLeafIds = extractSplitLeafIdsFromTree(request.referenceTree, request.leafIds);
  const referenceSplitKeys = Object.keys(referenceSplitLeafIds).sort();
  const referenceSplitSet = new Set(referenceSplitKeys);

  if (referenceSplitKeys.length === 0) {
    throw new Error('No informative internal splits were found in the current tree.');
  }

  const supportCountsBySplit = emptyCounts(referenceSplitKeys);
  let completedReplicates = 0;
  let stable = false;
  let stoppedEarly = false;
  let stableBatchCount = 0;
  let maxDeltaPercentagePoints: number | null = null;
  let previousSupportBySplit: Record<string, number> | null = null;

  while (completedReplicates < replicates && !isCancelled()) {
    const remaining = replicates - completedReplicates;
    const waveBatchCount = Math.min(parallelism, Math.ceil(remaining / batchSize));
    const waveBatchSizes = Array.from({ length: waveBatchCount }, (_, index) => {
      const reservedForLater = (waveBatchCount - index - 1) * batchSize;
      return Math.min(batchSize, remaining - reservedForLater);
    });

    const waveCounts = await Promise.all(
      waveBatchSizes.map(size => Promise.resolve().then(() => computeBootstrapBatch(
        size,
        request.leafIds,
        orderedSequences,
        sequenceLength,
        referenceSplitSet,
        metric,
        strategy,
        ambiguityThreshold,
        random,
        isCancelled
      )))
    );

    if (isCancelled()) {
      break;
    }

    waveCounts.forEach(counts => mergeCounts(supportCountsBySplit, counts));
    completedReplicates += waveBatchSizes.reduce((sum, size) => sum + size, 0);
    const supportBySplit = calculateSupportPercentages(supportCountsBySplit, completedReplicates);

    if (request.stability?.enabled && completedReplicates >= request.stability.minReplicates) {
      maxDeltaPercentagePoints = getMaxSupportDelta(previousSupportBySplit, supportBySplit);
      if (
        maxDeltaPercentagePoints !== null &&
        maxDeltaPercentagePoints < request.stability.thresholdPercentagePoints
      ) {
        stableBatchCount++;
      } else if (maxDeltaPercentagePoints !== null) {
        stableBatchCount = 0;
      }
      previousSupportBySplit = { ...supportBySplit };

      if (stableBatchCount >= request.stability.consecutiveBatches) {
        stable = true;
        stoppedEarly = completedReplicates < replicates;
      }
    }

    onProgress(makeProgress(
      completedReplicates,
      replicates,
      supportBySplit,
      stable,
      stoppedEarly,
      maxDeltaPercentagePoints,
      stableBatchCount
    ));

    if (stable) {
      break;
    }

    await delayForWorkerYield();
  }

  const supportBySplit = calculateSupportPercentages(supportCountsBySplit, completedReplicates);

  return {
    type: 'RESULT',
    jobId: request.jobId,
    completedReplicates,
    requestedReplicates: replicates,
    supportBySplit,
    supportCountsBySplit,
    referenceSplitLeafIds,
    stable,
    stoppedEarly,
    maxDeltaPercentagePoints,
    metric,
    leafIds: [...request.leafIds],
    updatedAt: Date.now(),
  };
}

