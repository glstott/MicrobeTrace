import * as tn93 from 'tn93';

import {
  decideTn93ThresholdFilter,
  scanTn93DefiniteMismatchLowerBound,
  tn93PairCoordinates,
} from './tn93-threshold-filter';
import { tn93DistanceOnInts } from './tn93-distance';

describe('TN93 threshold lower-bound filter', () => {
  const makePair = (mismatches: number, length = 1800): [Uint8Array, Uint8Array] => {
    const source = tn93.toInts('A'.repeat(length));
    const target = tn93.toInts(`${'G'.repeat(mismatches)}${'A'.repeat(length - mismatches)}`);
    return [source, target];
  };

  it('rejects only after the first mismatch strictly above the threshold', () => {
    const [sourceAtThreshold, targetAtThreshold] = makePair(27);
    const [sourceAbove, targetAbove] = makePair(28);

    expect(
      scanTn93DefiniteMismatchLowerBound(sourceAtThreshold, targetAtThreshold, 0.015)
        .definitelyAboveThreshold,
    ).toBeFalse();
    const rejected = scanTn93DefiniteMismatchLowerBound(sourceAbove, targetAbove, 0.015);
    expect(rejected.definitelyAboveThreshold).toBeTrue();
    expect(rejected.definiteMismatchCount).toBe(28);
  });

  it('keeps the high-divergence nested-pair counterexample eligible for exact TN93', () => {
    const [source, target] = makePair(22);
    expect(
      scanTn93DefiniteMismatchLowerBound(source, target, 0.015)
        .definitelyAboveThreshold,
    ).toBeFalse();
  });

  it('does not treat ambiguous or gap symbols as definite mismatches', () => {
    const source = tn93.toInts('AAAA----');
    const target = tn93.toInts('NNNNGGGG');
    const result = scanTn93DefiniteMismatchLowerBound(source, target, 0.1);

    expect(result.definitelyAboveThreshold).toBeFalse();
    expect(result.definiteMismatchCount).toBe(0);
  });

  it('falls back conservatively for invalid thresholds and empty sequences', () => {
    expect(
      scanTn93DefiniteMismatchLowerBound(new Uint8Array(), new Uint8Array(), 0.015)
        .definitelyAboveThreshold,
    ).toBeFalse();
    const [source, target] = makePair(100);
    expect(
      scanTn93DefiniteMismatchLowerBound(source, target, Number.NaN)
        .definitelyAboveThreshold,
    ).toBeFalse();
  });

  it('selects the filter for broadly divergent sequences', () => {
    const bases = ['A', 'C', 'G', 'T'];
    const sequences = Array.from({ length: 110 }, (_, index) => (
      tn93.toInts(bases[index % bases.length].repeat(200))
    ));
    const decision = decideTn93ThresholdFilter(sequences, 0.015);

    expect(decision.sampledPairCount).toBe(128);
    expect(decision.useThresholdFilter).toBeTrue();
    expect(decision.estimatedWorkRatio).toBeLessThanOrEqual(0.8);
  });

  it('falls back for compact sequences and small jobs', () => {
    const compact = Array.from(
      { length: 110 },
      () => tn93.toInts('A'.repeat(200)),
    );
    expect(decideTn93ThresholdFilter(compact, 0.015).useThresholdFilter).toBeFalse();
    expect(
      decideTn93ThresholdFilter(compact.slice(0, 20), 0.015).sampledPairCount,
    ).toBe(0);
  });

  it('decodes triangular pair indices at row boundaries', () => {
    expect(tn93PairCoordinates(0)).toEqual({ sourceIndex: 1, targetIndex: 0 });
    expect(tn93PairCoordinates(1)).toEqual({ sourceIndex: 2, targetIndex: 0 });
    expect(tn93PairCoordinates(2)).toEqual({ sourceIndex: 2, targetIndex: 1 });
    expect(tn93PairCoordinates(3)).toEqual({ sourceIndex: 3, targetIndex: 0 });
    expect(tn93PairCoordinates(9)).toEqual({ sourceIndex: 4, targetIndex: 3 });
  });

  it('never rejects a threshold-qualified pair across supported ambiguity modes', () => {
    const symbols = ['A', 'C', 'G', 'T', 'R', 'Y', 'N', '-'];
    let state = 0x12345678;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const makeSequence = () => Array.from(
      { length: 200 },
      () => symbols[Math.floor(random() * symbols.length)],
    ).join('');

    ['AVERAGE', 'RESOLVE', 'SKIP', 'GAPMM'].forEach((mode) => {
      [0.015, 0.1].forEach((threshold) => {
        for (let sample = 0; sample < 100; sample++) {
          const source = tn93.toInts(makeSequence());
          const target = tn93.toInts(makeSequence());
          const scan = scanTn93DefiniteMismatchLowerBound(
            source,
            target,
            threshold,
          );
          if (!scan.definitelyAboveThreshold) continue;

          const exactDistance = tn93DistanceOnInts(source, target, mode);
          expect(Number.isFinite(exactDistance) && exactDistance <= threshold)
            .withContext(`${mode} sample ${sample} at ${threshold}`)
            .toBeFalse();
        }
      });
    });
  });
});
