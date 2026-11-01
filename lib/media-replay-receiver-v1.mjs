import { createHash, timingSafeEqual } from 'node:crypto';

const ok = (value) => ({ ok: true, value });
const err = (code) => ({ ok: false, error: { code } });
const uint = (n) => Number.isSafeInteger(n) && n >= 0;
const key = (s) => typeof s === 'string' && s.length > 0 && s.length <= 128 && !/[\u0000-\u001f]/u.test(s);

// Receiver-side applied checkpoint; 'resetAt' never claims abandoned frames were decoded.
// Caller alone owns the ledger and commits only after successful decode/application.
export class ReceiverLedger {
  #streamId;
  #generation;
  #nextSeq = 0;
  #nextOffset = 0;
  #appliedSequence = -1;
  #appliedOffset = 0;
  #lastConfig = null;
  #requireRandomAccess = false;
  #pendingReset = null;
  #discontinuity = null;
  #recent = new Map();
  #maxReceipts;

  constructor({ streamId, generation = 1, maxReceipts = 4096 }) {
    if (!key(streamId) || !uint(generation) || generation === 0 || !uint(maxReceipts) || maxReceipts === 0) throw new TypeError('invalid receiver identity');
    this.#streamId = streamId;
    this.#generation = generation;
    this.#maxReceipts = maxReceipts;
  }

  get checkpoint() {
    return Object.freeze({ streamId: this.#streamId, generation: this.#generation,
      lastAppliedSequence: this.#appliedSequence, lastAppliedEndOffset: this.#appliedOffset,
      codecConfigId: this.#lastConfig,
      discontinuity: this.#discontinuity === null ? null : Object.freeze({ ...this.#discontinuity }),
      resetPending: this.#pendingReset !== null });
  }

  offer(item) {
    if (item?.streamId !== this.#streamId || item?.generation !== this.#generation) return err('STALE_STREAM_GENERATION');
    if (!uint(item.sequence) || !uint(item.offset) || !uint(item.endOffset) ||
        !(item.bytes instanceof Uint8Array) || item.bytes.length === 0 ||
        item.offset + item.bytes.length !== item.endOffset ||
        !key(item.codecConfigId) || typeof item.randomAccess !== 'boolean' ||
        !/^[0-9a-f]{64}$/.test(item.sha256 ?? '')) return err('INVALID_CHUNK');
    const actual = createHash('sha256').update(item.bytes).digest();
    const expected = Buffer.from(item.sha256, 'hex');
    if (!timingSafeEqual(actual, expected)) return err('HASH_MISMATCH');
    if (item.sequence < this.#nextSeq) {
      const receipt = this.#recent.get(item.sequence);
      if (!receipt) return err('DUPLICATE_EXPIRED');
      if (receipt.offset !== item.offset || receipt.endOffset !== item.endOffset ||
          receipt.sha256 !== item.sha256 || receipt.codecConfigId !== item.codecConfigId ||
          receipt.randomAccess !== item.randomAccess) return err('DUPLICATE_CONFLICT');
      return ok({ mode: 'duplicate', checkpoint: this.checkpoint });
    }
    if (item.sequence !== this.#nextSeq || item.offset !== this.#nextOffset) return err('OUT_OF_ORDER');
    if (this.#requireRandomAccess && !item.randomAccess) return err('KEYFRAME_REQUIRED');
    if (this.#lastConfig !== null && this.#lastConfig !== item.codecConfigId && !item.randomAccess) return err('CODEC_CONFIG_REQUIRES_RANDOM_ACCESS');
    return ok({ mode: 'ready', checkpoint: this.checkpoint });
  }

  // The host must commit only after a transactionally successful decode/application.
  commit(item) {
    const result = this.offer(item);
    if (!result.ok || result.value.mode === 'duplicate') return result;
    if (item.sequence === Number.MAX_SAFE_INTEGER) return err('COUNTER_OVERFLOW');
    if (this.#pendingReset !== null) {
      const previous = this.#pendingReset;
      if (item.sequence > previous.previousSequence + 1) {
        this.#discontinuity = Object.freeze({
          previousAppliedSequence: previous.previousSequence,
          previousAppliedEndOffset: previous.previousOffset,
          skippedFromSequence: previous.previousSequence + 1,
          skippedThroughSequence: item.sequence - 1,
          restartSequence: item.sequence, restartOffset: item.offset,
        });
      }
    }
    this.#nextSeq = item.sequence + 1;
    this.#nextOffset = item.endOffset;
    this.#appliedSequence = item.sequence;
    this.#appliedOffset = item.endOffset;
    this.#lastConfig = item.codecConfigId;
    this.#requireRandomAccess = false;
    this.#pendingReset = null;
    this.#recent.set(item.sequence, { offset: item.offset, endOffset: item.endOffset,
      sha256: item.sha256, codecConfigId: item.codecConfigId, randomAccess: item.randomAccess });
    if (this.#recent.size > this.#maxReceipts) this.#recent.delete(this.#recent.keys().next().value);
    return ok({ mode: 'applied', checkpoint: this.checkpoint });
  }

  // Only after authenticated recovery authorization and actual codec reset.
  resetAt({ streamId, generation, restartSequence, restartOffset, codecConfigId } = {}) {
    if (streamId !== this.#streamId || generation !== this.#generation) return err('STALE_STREAM_GENERATION');
    if (this.#pendingReset !== null || this.#discontinuity !== null) return err('RESET_NOT_SETTLED');
    if (!uint(restartSequence) || !uint(restartOffset) || !key(codecConfigId) ||
        restartSequence < this.#nextSeq || restartOffset < this.#nextOffset ||
        restartSequence === Number.MAX_SAFE_INTEGER) return err('INVALID_RESET');
    this.#pendingReset = { previousSequence: this.#appliedSequence, previousOffset: this.#appliedOffset };
    this.#nextSeq = restartSequence;
    this.#nextOffset = restartOffset;
    this.#requireRandomAccess = true;
    // Until first decoded random-access unit, the reported checkpoint does not advance.
    return ok({ checkpoint: this.checkpoint, requiresDecoderReset: true });
  }

  // Requires external authenticated acknowledgment of the discontinuity receipt.
  settleDiscontinuity({ streamId, generation, restartSequence } = {}) {
    if (streamId !== this.#streamId || generation !== this.#generation) return err('STALE_STREAM_GENERATION');
    if (this.#discontinuity === null || this.#discontinuity.restartSequence !== restartSequence) return err('NO_PENDING_DISCONTINUITY');
    this.#discontinuity = null;
    return ok({ checkpoint: this.checkpoint });
  }

  fence(nextGeneration) {
    if (!uint(nextGeneration) || nextGeneration <= this.#generation) return err('INVALID_GENERATION');
    this.#generation = nextGeneration;
    this.#nextSeq = 0;
    this.#nextOffset = 0;
    this.#appliedSequence = -1;
    this.#appliedOffset = 0;
    this.#lastConfig = null;
    this.#requireRandomAccess = false;
    this.#pendingReset = null;
    this.#discontinuity = null;
    this.#recent.clear();
    return ok({ checkpoint: this.checkpoint });
  }
}
