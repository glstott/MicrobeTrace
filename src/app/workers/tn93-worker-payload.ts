export interface Tn93SequenceSource {
  _seqInt: Uint8Array;
  _ambiguity?: number;
}

export interface PackedTn93Sequences {
  sequenceBytes: ArrayBuffer;
  sequenceOffsets: ArrayBuffer;
  ambiguities: ArrayBuffer;
}

export interface UnpackedTn93Sequence {
  _seqInt: Uint8Array;
  _ambiguity: number;
}

export function packTn93Sequences(
  sources: ArrayLike<Tn93SequenceSource>,
): PackedTn93Sequences {
  const offsets = new Uint32Array(sources.length + 1);
  const ambiguities = new Float32Array(sources.length);
  let totalLength = 0;

  for (let index = 0; index < sources.length; index++) {
    offsets[index] = totalLength;
    totalLength += sources[index]._seqInt.length;
    ambiguities[index] = Number(sources[index]._ambiguity);
  }
  offsets[sources.length] = totalLength;

  const sequenceBytes = new Uint8Array(totalLength);
  for (let index = 0; index < sources.length; index++) {
    sequenceBytes.set(sources[index]._seqInt, offsets[index]);
  }

  return {
    sequenceBytes: sequenceBytes.buffer,
    sequenceOffsets: offsets.buffer,
    ambiguities: ambiguities.buffer,
  };
}

export function unpackTn93Sequences(
  packed: PackedTn93Sequences,
): UnpackedTn93Sequence[] {
  const sequenceBytes = new Uint8Array(packed.sequenceBytes);
  const offsets = new Uint32Array(packed.sequenceOffsets);
  const ambiguities = new Float32Array(packed.ambiguities);
  const sequenceCount = Math.max(0, offsets.length - 1);
  const output = new Array<UnpackedTn93Sequence>(sequenceCount);

  for (let index = 0; index < sequenceCount; index++) {
    output[index] = {
      _seqInt: sequenceBytes.subarray(offsets[index], offsets[index + 1]),
      _ambiguity: ambiguities[index],
    };
  }

  return output;
}

export function packedTn93Transferables(
  packed: PackedTn93Sequences,
): Transferable[] {
  return [
    packed.sequenceBytes,
    packed.sequenceOffsets,
    packed.ambiguities,
  ];
}
