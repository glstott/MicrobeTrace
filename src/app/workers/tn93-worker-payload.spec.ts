import {
  packTn93Sequences,
  packedTn93Transferables,
  unpackTn93Sequences,
} from './tn93-worker-payload';

describe('packed TN93 worker payload', () => {
  it('round-trips variable-length integer sequences and ambiguities', () => {
    const packed = packTn93Sequences([
      { _seqInt: Uint8Array.from([0, 1, 2]), _ambiguity: 0.1 },
      { _seqInt: Uint8Array.from([3, 17]), _ambiguity: 0.25 },
    ]);
    const unpacked = unpackTn93Sequences(packed);

    expect(Array.from(unpacked[0]._seqInt)).toEqual([0, 1, 2]);
    expect(Array.from(unpacked[1]._seqInt)).toEqual([3, 17]);
    expect(unpacked[0]._ambiguity).toBeCloseTo(0.1, 5);
    expect(unpacked[1]._ambiguity).toBe(0.25);
    expect(packedTn93Transferables(packed)).toEqual([
      packed.sequenceBytes,
      packed.sequenceOffsets,
      packed.ambiguities,
    ]);
  });

  it('handles an empty sequence collection', () => {
    const unpacked = unpackTn93Sequences(packTn93Sequences([]));
    expect(unpacked).toEqual([]);
  });
});
