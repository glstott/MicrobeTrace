export interface Tn93ThresholdLowerBoundScan {
  definitelyAboveThreshold: boolean;
  inspectedSites: number;
  definiteMismatchCount: number;
}

export interface Tn93ThresholdFilterDecision {
  useThresholdFilter: boolean;
  sampledPairCount: number;
  candidatePairShare: number;
  meanInspectedSiteShare: number;
  estimatedWorkRatio: number;
}

export const DEFAULT_TN93_THRESHOLD_FILTER_SAMPLE_SIZE = 128;
export const DEFAULT_TN93_THRESHOLD_FILTER_MAX_WORK_RATIO = 0.8;
export const DEFAULT_TN93_THRESHOLD_FILTER_MIN_PAIR_COUNT = 5000;

/**
 * Counts only resolved A/C/G/T mismatches. Dividing this count by the full
 * aligned length is a conservative lower bound on observed p-distance and,
 * therefore, on a valid TN93-corrected distance.
 */
export function scanTn93DefiniteMismatchLowerBound(
  source: Uint8Array,
  target: Uint8Array,
  threshold: number,
): Tn93ThresholdLowerBoundScan {
  const length = Math.min(source.length, target.length);
  if (!Number.isFinite(threshold) || threshold < 0 || length === 0) {
    return {
      definitelyAboveThreshold: false,
      inspectedSites: 0,
      definiteMismatchCount: 0,
    };
  }

  const mismatchLimit = threshold * length;
  const roundingTolerance = Number.EPSILON * 8 * Math.max(1, Math.abs(mismatchLimit));
  let definiteMismatchCount = 0;

  for (let site = 0; site < length; site++) {
    const sourceBase = source[site];
    const targetBase = target[site];
    if (sourceBase < 4 && targetBase < 4 && sourceBase !== targetBase) {
      definiteMismatchCount++;
      if (definiteMismatchCount > mismatchLimit + roundingTolerance) {
        return {
          definitelyAboveThreshold: true,
          inspectedSites: site + 1,
          definiteMismatchCount,
        };
      }
    }
  }

  return {
    definitelyAboveThreshold: false,
    inspectedSites: length,
    definiteMismatchCount,
  };
}

export function tn93PairCoordinates(
  pairIndex: number,
): { sourceIndex: number; targetIndex: number } {
  const sourceIndex = Math.floor((1 + Math.sqrt(1 + 8 * pairIndex)) / 2);
  return {
    sourceIndex,
    targetIndex: pairIndex - (sourceIndex * (sourceIndex - 1)) / 2,
  };
}

export function decideTn93ThresholdFilter(
  sequences: ArrayLike<Uint8Array>,
  threshold: number,
  sampleSize = DEFAULT_TN93_THRESHOLD_FILTER_SAMPLE_SIZE,
  maximumWorkRatio = DEFAULT_TN93_THRESHOLD_FILTER_MAX_WORK_RATIO,
  minimumPairCount = DEFAULT_TN93_THRESHOLD_FILTER_MIN_PAIR_COUNT,
): Tn93ThresholdFilterDecision {
  const pairCount = (sequences.length * (sequences.length - 1)) / 2;
  if (
    pairCount < minimumPairCount
    || !Number.isFinite(threshold)
    || threshold < 0
  ) {
    return {
      useThresholdFilter: false,
      sampledPairCount: 0,
      candidatePairShare: 1,
      meanInspectedSiteShare: 1,
      estimatedWorkRatio: 2,
    };
  }

  const sampledPairCount = Math.min(
    pairCount,
    Math.max(1, Math.floor(sampleSize)),
  );
  let candidateCount = 0;
  let inspectedSiteShareTotal = 0;

  for (let sampleIndex = 0; sampleIndex < sampledPairCount; sampleIndex++) {
    const pairIndex = Math.min(
      pairCount - 1,
      Math.floor(((sampleIndex + 0.5) * pairCount) / sampledPairCount),
    );
    const { sourceIndex, targetIndex } = tn93PairCoordinates(pairIndex);
    const source = sequences[sourceIndex];
    const target = sequences[targetIndex];
    const length = Math.min(source.length, target.length);
    const scan = scanTn93DefiniteMismatchLowerBound(source, target, threshold);
    if (!scan.definitelyAboveThreshold) {
      candidateCount++;
    }
    inspectedSiteShareTotal += length > 0 ? scan.inspectedSites / length : 1;
  }

  const candidatePairShare = candidateCount / sampledPairCount;
  const meanInspectedSiteShare = inspectedSiteShareTotal / sampledPairCount;
  const estimatedWorkRatio = candidatePairShare + meanInspectedSiteShare;

  return {
    useThresholdFilter: estimatedWorkRatio <= maximumWorkRatio,
    sampledPairCount,
    candidatePairShare,
    meanInspectedSiteShare,
    estimatedWorkRatio,
  };
}
