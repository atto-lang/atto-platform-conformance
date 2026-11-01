import { createHash } from 'node:crypto';

// Host-side executable reference for oreslang.media-replay/1. Not a guest Oreslang runtime.
export const DEFAULT_CAPACITY_BYTES = 2 * 1024 * 1024;
export const DEFAULT_MAX_CHUNKS = 4096;

const ok = (value) => ({ ok: true, value });
const err = (code) => ({ ok: false, error: { code } });
const uint = (value) => Number.isSafeInteger(value) && value >= 0;
const seq = (value) => Number.isSafeInteger(value) && value >= -1;
const key = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f]/u.test(value);

export class ReplayWindow {
  #streamId;
  #generation;
  #capacity;
  #maxChunks;
  #chunks = [];
  #used = 0;
  #nextSequence = 0;
  #nextOffset = 0;
  #ackSequence = -1;
  #ackOffset = 0;
  #lastConfig = null;
  #lastDiscontinuity = null;

  constructor({ streamId, generation = 1, capacityBytes = DEFAULT_CAPACITY_BYTES, maxChunks = DEFAULT_MAX_CHUNKS }) {
    if (!key(streamId) || !uint(generation) || generation === 0 || !uint(capacityBytes) || capacityBytes === 0 || !uint(maxChunks) || maxChunks === 0) {
      throw new TypeError('invalid replay-window configuration');
    }
    this.#streamId = streamId;
    this.#generation = generation;
    this.#capacity = capacityBytes;
    this.#maxChunks = maxChunks;
  }

  get status() {
    return Object.freeze({
      streamId: this.#streamId, generation: this.#generation,
      capacityBytes: this.#capacity, usedBytes: this.#used,
      retainedChunks: this.#chunks.length, nextSequence: this.#nextSequence,
      nextOffset: this.#nextOffset, lastAckSequence: this.#ackSequence,
      lastAckEndOffset: this.#ackOffset,
      lastDiscontinuity: this.#lastDiscontinuity === null ? null : Object.freeze({ ...this.#lastDiscontinuity }),
    });
  }

  #identity(message) {
    return message?.streamId === this.#streamId && message?.generation === this.#generation;
  }

  append({ sequence, offset, bytes, codecConfigId, randomAccess = false, ptsUs = 0 } = {}) {
    if (!seq(sequence) || sequence < 0 || !uint(offset) || !uint(ptsUs) || !key(codecConfigId) || typeof randomAccess !== 'boolean' || !(bytes instanceof Uint8Array) || bytes.length === 0) {
      return err('INVALID_CHUNK');
    }
    if (sequence !== this.#nextSequence || offset !== this.#nextOffset) return err('NONCONTIGUOUS_CHUNK');
    if (sequence === Number.MAX_SAFE_INTEGER || offset + bytes.length > Number.MAX_SAFE_INTEGER) return err('COUNTER_OVERFLOW');
    if (bytes.length > this.#capacity) return err('CHUNK_TOO_LARGE');
    if (this.#used + bytes.length > this.#capacity || this.#chunks.length >= this.#maxChunks) return err('BACKPRESSURE');
    // Decoder configuration changes are only admitted on verified random-access boundaries.
    if (this.#lastConfig !== null && this.#lastConfig !== codecConfigId && !randomAccess) return err('CODEC_CONFIG_REQUIRES_RANDOM_ACCESS');
    const item = Object.freeze({ sequence, offset, endOffset: offset + bytes.length,
      codecConfigId, randomAccess, ptsUs, bytes: Uint8Array.from(bytes) });
    const sealed = Object.freeze({ ...item, sha256: createHash('sha256').update(item.bytes).digest('hex') });
    this.#chunks.push(sealed);
    this.#used += bytes.length;
    this.#nextSequence++;
    this.#nextOffset = item.endOffset;
    this.#lastConfig = codecConfigId;
    return ok({ sequence, endOffset: item.endOffset });
  }

  acknowledge({ streamId, generation, sequence, endOffset } = {}) {
    if (!this.#identity({ streamId, generation })) return err('STALE_STREAM_GENERATION');
    if (!seq(sequence) || !uint(endOffset)) return err('INVALID_ACK');
    if (sequence === this.#ackSequence && endOffset === this.#ackOffset) return ok({ duplicate: true });
    if (sequence <= this.#ackSequence || sequence >= this.#nextSequence) return err('ACK_OUT_OF_RANGE');
    const match = this.#chunks.find((chunk) => chunk.sequence === sequence);
    if (!match || match.endOffset !== endOffset) return err('ACK_OFFSET_MISMATCH');
    // Cumulative ACK = receiver has fully applied *every* chunk through sequence.
    while (this.#chunks.length > 0 && this.#chunks[0].sequence <= sequence) {
      const first = this.#chunks.shift();
      this.#used -= first.bytes.length;
    }
    this.#ackSequence = sequence;
    this.#ackOffset = endOffset;
    return ok({ duplicate: false });
  }

  // Only the authenticated transport/session owner may submit a recovery receipt.
  // The result exposes a GAP, never claims skipped units were decoded.
  acknowledgeDiscontinuity({
    streamId, generation, previousAppliedSequence, previousAppliedEndOffset,
    skippedFromSequence, skippedThroughSequence, restartSequence, restartOffset,
    sequence, endOffset,
  } = {}) {
    if (!this.#identity({ streamId, generation })) return err('STALE_STREAM_GENERATION');
    if (!seq(previousAppliedSequence) || !uint(previousAppliedEndOffset) ||
        !uint(skippedFromSequence) || !uint(skippedThroughSequence) ||
        !uint(restartSequence) || !uint(restartOffset) ||
        !uint(sequence) || !uint(endOffset)) return err('INVALID_DISCONTINUITY');
    if (previousAppliedSequence !== this.#ackSequence ||
        previousAppliedEndOffset !== this.#ackOffset ||
        skippedFromSequence !== previousAppliedSequence + 1 ||
        skippedThroughSequence !== restartSequence - 1 ||
        restartSequence <= skippedFromSequence ||
        sequence < restartSequence || sequence >= this.#nextSequence) return err('DISCONTINUITY_MISMATCH');
    const anchor = this.#chunks.find((item) => item.sequence === restartSequence);
    const tail = this.#chunks.find((item) => item.sequence === sequence);
    if (!anchor || !anchor.randomAccess || anchor.offset !== restartOffset ||
        !tail || tail.endOffset !== endOffset) return err('UNVERIFIED_RESTART');
    const gap = Object.freeze({ previousAppliedSequence, previousAppliedEndOffset,
      skippedFromSequence, skippedThroughSequence, restartSequence, restartOffset });
    // Source advances its storage-reclamation watermark; gap remains separately visible.
    while (this.#chunks.length > 0 && this.#chunks[0].sequence <= sequence) {
      const first = this.#chunks.shift();
      this.#used -= first.bytes.length;
    }
    this.#ackSequence = sequence;
    this.#ackOffset = endOffset;
    this.#lastDiscontinuity = gap;
    return ok({ disposition: 'discontinuous', gap, lastAckSequence: sequence });
  }

  resume({ streamId, generation, lastAppliedSequence, lastAppliedEndOffset, codecConfigId = null } = {}) {
    if (!this.#identity({ streamId, generation })) return err('STALE_STREAM_GENERATION');
    if (!seq(lastAppliedSequence) || !uint(lastAppliedEndOffset) || (codecConfigId !== null && !key(codecConfigId))) return err('INVALID_CHECKPOINT');
    if (lastAppliedSequence >= this.#nextSequence || lastAppliedEndOffset > this.#nextOffset) return err('CHECKPOINT_AHEAD');
    if (lastAppliedSequence === -1 && lastAppliedEndOffset !== 0) return err('CHECKPOINT_OFFSET_MISMATCH');
    if (lastAppliedSequence === this.#ackSequence && lastAppliedEndOffset !== this.#ackOffset) return err('CHECKPOINT_OFFSET_MISMATCH');
    const knownCheckpoint = this.#chunks.find((chunk) => chunk.sequence === lastAppliedSequence);
    if (knownCheckpoint && knownCheckpoint.endOffset !== lastAppliedEndOffset) return err('CHECKPOINT_OFFSET_MISMATCH');
    const firstWanted = lastAppliedSequence + 1;
    if (firstWanted === this.#nextSequence) {
      if (lastAppliedEndOffset !== this.#nextOffset) return err('CHECKPOINT_OFFSET_MISMATCH');
      return ok({ mode: 'continue', chunks: [], requiresDecoderReset: false });
    }
    const index = this.#chunks.findIndex((chunk) => chunk.sequence === firstWanted);
    if (index >= 0 && this.#chunks[index].offset === lastAppliedEndOffset &&
        (codecConfigId === null || codecConfigId === this.#chunks[index].codecConfigId)) {
      // A replay plan may never silently span a codec config change. A codec
      // transition requires decoder reinitialization in its own admitted step.
      const startConfig = this.#chunks[index].codecConfigId;
      if (this.#chunks.slice(index).some((item) => item.codecConfigId !== startConfig))
        return err('CODEC_CONFIG_TRANSITION');
      return ok({ mode: 'replay', chunks: this.#copyFrom(index), requiresDecoderReset: false });
    }
    // Never resume a delta frame without a verified codec restart point.
    const anchor = this.#chunks.findIndex((chunk) => chunk.sequence > lastAppliedSequence && chunk.randomAccess);
    if (anchor < 0) return err('KEYFRAME_REQUIRED');
    return ok({ mode: 'reset', chunks: this.#copyFrom(anchor), requiresDecoderReset: true,
      restartSequence: this.#chunks[anchor].sequence,
      restartOffset: this.#chunks[anchor].offset,
      codecConfigId: this.#chunks[anchor].codecConfigId });
  }

  #copyFrom(index) {
    return this.#chunks.slice(index).map((item) => ({
      sequence: item.sequence, offset: item.offset, endOffset: item.endOffset,
      codecConfigId: item.codecConfigId, randomAccess: item.randomAccess, ptsUs: item.ptsUs,
      sha256: item.sha256, bytes: Uint8Array.from(item.bytes),
    }));
  }

  fence(newGeneration) {
    if (!uint(newGeneration) || newGeneration <= this.#generation) return err('INVALID_GENERATION');
    this.#generation = newGeneration;
    this.#chunks = [];
    this.#used = 0;
    this.#nextSequence = 0;
    this.#nextOffset = 0;
    this.#ackSequence = -1;
    this.#ackOffset = 0;
    this.#lastConfig = null;
    this.#lastDiscontinuity = null;
    return ok({ generation: newGeneration });
  }
}
