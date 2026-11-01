import { createHash, timingSafeEqual } from 'node:crypto';

const ok = (value) => ({ ok: true, value });
const err = (code) => ({ ok: false, error: { code } });
const uint = (n) => Number.isSafeInteger(n) && n >= 0;
const key = (s) => typeof s === 'string' && s.length > 0 && s.length <= 128 && !/[\u0000-\u001f]/u.test(s);

// Receiver-side cumulative commit ledger; caller commits ONLY after successful decode/application.
// This model does not itself execute codecs or authenticate transports.
export class ReceiverLedger {
  #streamId;
  #generation;
  #nextSeq = 0;
  #nextOffset = 0;
  #lastConfig = null;
  #requireRandomAccess = false;

  constructor({ streamId, generation = 1 }) {
    if (!key(streamId) || !uint(generation) || generation === 0) throw new TypeError('invalid receiver identity');
    this.#streamId = streamId;
    this.#generation = generation;
  }

  get checkpoint() {
    return Object.freeze({ streamId: this.#streamId, generation: this.#generation,
      lastAppliedSequence: this.#nextSeq - 1, lastAppliedEndOffset: this.#nextOffset,
      codecConfigId: this.#lastConfig });
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
      if (item.endOffset > this.#nextOffset) return err('INVALID_DUPLICATE');
      return ok({ mode: 'duplicate', checkpoint: this.checkpoint });
    }
    if (item.sequence !== this.#nextSeq || item.offset !== this.#nextOffset) return err('OUT_OF_ORDER');
    if (this.#requireRandomAccess && !item.randomAccess) return err('KEYFRAME_REQUIRED');
    if (this.#lastConfig !== null && this.#lastConfig !== item.codecConfigId && !item.randomAccess) return err('CODEC_CONFIG_REQUIRES_RANDOM_ACCESS');
    return ok({ mode: 'ready', checkpoint: this.checkpoint });
  }

  // MUST follow a successful, transactionally staged decode/application of this exact item.
  commit(item) {
    const result = this.offer(item);
    if (!result.ok || result.value.mode === 'duplicate') return result;
    this.#nextSeq = item.sequence + 1;
    this.#nextOffset = item.endOffset;
    this.#lastConfig = item.codecConfigId;
    this.#requireRandomAccess = false;
    return ok({ mode: 'applied', checkpoint: this.checkpoint });
  }

  resetAt({ streamId, generation, restartSequence, restartOffset, codecConfigId } = {}) {
    if (streamId !== this.#streamId || generation !== this.#generation) return err('STALE_STREAM_GENERATION');
    if (!uint(restartSequence) || !uint(restartOffset) || !key(codecConfigId) ||
        restartSequence < this.#nextSeq || restartOffset < this.#nextOffset) return err('INVALID_RESET');
    this.#nextSeq = restartSequence;
    this.#nextOffset = restartOffset;
    this.#lastConfig = codecConfigId;
    this.#requireRandomAccess = true;
    return ok({ checkpoint: this.checkpoint, requiresDecoderReset: true });
  }

  fence(nextGeneration) {
    if (!uint(nextGeneration) || nextGeneration <= this.#generation) return err('INVALID_GENERATION');
    this.#generation = nextGeneration;
    this.#nextSeq = 0;
    this.#nextOffset = 0;
    this.#lastConfig = null;
    this.#requireRandomAccess = false;
    return ok({ checkpoint: this.checkpoint });
  }
}
