import * as tn93 from 'tn93';

import { tn93DistanceOnInts } from './tn93-distance';

describe('TN93 integer distance wrapper', () => {
  const distance = (source: string, target: string, mode: string) => (
    tn93DistanceOnInts(tn93.toInts(source), tn93.toInts(target), mode)
  );

  it('preserves package AVERAGE distances', () => {
    const source = tn93.toInts('ACGTNNGT');
    const target = tn93.toInts('AGGTRRGT');
    expect(tn93DistanceOnInts(source, target, 'AVERAGE')).toBe(
      tn93.onInts(source, target, 'AVERAGE'),
    );
  });

  it('computes RESOLVE without the package onInts ReferenceError', () => {
    expect(distance('ACGTACGT', 'AGGTACGT', 'RESOLVE'))
      .toBeCloseTo(0.13903291233808712, 12);
    expect(distance('ACGTACGT', 'AYGTACGT', 'RESOLVE')).toBeCloseTo(0, 12);
    expect(distance('ACGTNNGT', 'AGGTRRGT', 'RESOLVE'))
      .toBeCloseTo(0.14253853215556697, 12);
  });
});
