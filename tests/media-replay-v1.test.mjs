import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ReplayWindow, DEFAULT_CAPACITY_BYTES } from '../lib/media-replay-v1.mjs';

const id = (generation = 1) => ({ streamId: 'stream-a', generation });
const windowOf = (capacityBytes = 8, maxChunks = 100) => new ReplayWindow({ ...id(), capacityBytes, maxChunks });
const chunk = (sequence, offset, bytes = [sequence + 1], randomAccess = false, codecConfigId = 'h264:a', ptsUs = sequence * 1000) => ({ sequence, offset, bytes: Uint8Array.from(bytes), randomAccess, codecConfigId, ptsUs });
const checkpoint = (lastAppliedSequence, lastAppliedEndOffset, codecConfigId = 'h264:a') => ({ ...id(), lastAppliedSequence, lastAppliedEndOffset, codecConfigId });
const ack = (sequence, endOffset, generation = 1) => ({ ...id(generation), sequence, endOffset });
const code = (result, error) => assert.deepEqual(result, { ok: false, error: { code: error } });

test('default is exactly 2 MiB, with bounded metadata slots', () => {
  const w = new ReplayWindow(id());
  assert.equal(w.status.capacityBytes, DEFAULT_CAPACITY_BYTES);
  assert.equal(w.status.capacityBytes, 2_097_152);
});

test('appending copies the input and replay returns an independent copy', () => {
  const w = windowOf();
  const source = Uint8Array.from([9, 8]);
  assert.equal(w.append(chunk(0, 0, source, true)).ok, true);
  source[0] = 44;
  const a = w.resume(checkpoint(-1, 0));
  assert.equal(a.value.mode, 'replay');
  assert.deepEqual([...a.value.chunks[0].bytes], [9, 8]);
  assert.equal(a.value.chunks[0].sha256, createHash('sha256').update(Uint8Array.from([9,8])).digest('hex'));
  a.value.chunks[0].bytes[0] = 77;
  assert.deepEqual([...w.resume(checkpoint(-1, 0)).value.chunks[0].bytes], [9, 8]);
});

test('normal ACK and replay after network disconnect', () => {
  const w = windowOf();
  for (let i = 0; i < 4; i++) assert.equal(w.append(chunk(i, i, undefined, i === 0)).ok, true);
  assert.deepEqual(w.acknowledge(ack(1, 2)), { ok: true, value: { duplicate: false } });
  const r = w.resume(checkpoint(1, 2));
  assert.equal(r.value.mode, 'replay');
  assert.deepEqual(r.value.chunks.map(x => x.sequence), [2, 3]);
  assert.equal(w.status.usedBytes, 2);
});

test('duplicate acknowledgments idempotent; out-of-order and future acks reject', () => {
  const w = windowOf();
  w.append(chunk(0, 0)); w.append(chunk(1, 1));
  assert.equal(w.acknowledge(ack(0, 1)).ok, true);
  assert.deepEqual(w.acknowledge(ack(0, 1)), { ok: true, value: { duplicate: true } });
  code(w.acknowledge(ack(0, 99)), 'ACK_OUT_OF_RANGE');
  code(w.acknowledge(ack(3, 4)), 'ACK_OUT_OF_RANGE');
  code(w.acknowledge(ack(1, 100)), 'ACK_OFFSET_MISMATCH');
  assert.equal(w.status.lastAckSequence, 0);
});

test('capacity backpressure never drops unacknowledged packets silently', () => {
  const w = windowOf(3);
  w.append(chunk(0, 0, [1, 2]));
  code(w.append(chunk(1, 2, [3, 4])), 'BACKPRESSURE');
  assert.equal(w.status.usedBytes, 2);
  assert.deepEqual(w.resume(checkpoint(-1, 0)).value.chunks.map(x => x.sequence), [0]);
  assert.equal(w.acknowledge(ack(0, 2)).ok, true);
  assert.equal(w.append(chunk(1, 2, [3, 4])).ok, true);
});

test('reject oversized single frame and 1-based zero-length frames', () => {
  const w = windowOf(2);
  code(w.append(chunk(0, 0, [1, 2, 3])), 'CHUNK_TOO_LARGE');
  code(w.append(chunk(0, 0, [])), 'INVALID_CHUNK');
});

test('bounded metadata count blocks many tiny frames', () => {
  const w = windowOf(100, 2);
  w.append(chunk(0, 0)); w.append(chunk(1, 1));
  code(w.append(chunk(2, 2)), 'BACKPRESSURE');
  assert.equal(w.status.retainedChunks, 2);
});

test('sequence and byte offset must both be contiguous', () => {
  const w = windowOf();
  code(w.append(chunk(1, 0)), 'NONCONTIGUOUS_CHUNK');
  code(w.append(chunk(0, 1)), 'NONCONTIGUOUS_CHUNK');
  assert.equal(w.append(chunk(0, 0)).ok, true);
  code(w.append(chunk(0, 1)), 'NONCONTIGUOUS_CHUNK');
});

test('stale checkpoint after eviction must not claim valid contiguous replay', () => {
  const w = windowOf();
  w.append(chunk(0, 0)); w.append(chunk(1, 1)); w.append(chunk(2, 2));
  w.acknowledge(ack(1, 2));
  code(w.resume(checkpoint(-1, 0)), 'KEYFRAME_REQUIRED');
});

test('keyframe-aware fallback returns reset, never transparent partial replay', () => {
  const w = windowOf(10);
  w.append(chunk(0, 0)); w.append(chunk(1, 1)); w.append(chunk(2, 2));
  w.append(chunk(3, 3, [8], true)); w.append(chunk(4, 4));
  w.acknowledge(ack(1, 2));
  const r = w.resume(checkpoint(-1, 0));
  assert.equal(r.value.mode, 'reset');
  assert.equal(r.value.requiresDecoderReset, true);
  assert.equal(r.value.restartSequence, 3);
  assert.deepEqual(r.value.chunks.map(x => x.sequence), [3, 4]);
});

test('codec config mismatch forces a fresh decoder at a verified anchor', () => {
  const w = windowOf();
  w.append(chunk(0, 0, [1], true));
  w.append(chunk(1, 1));
  const r = w.resume(checkpoint(-1, 0, 'h265:b'));
  assert.equal(r.value.mode, 'reset');
  assert.equal(r.value.codecConfigId, 'h264:a');
});

test('codec config change without a random access point rejects, leaving state unchanged', () => {
  const w = windowOf();
  w.append(chunk(0, 0, [1], true));
  code(w.append(chunk(1, 1, [2], false, 'h265:b')), 'CODEC_CONFIG_REQUIRES_RANDOM_ACCESS');
  assert.equal(w.status.nextSequence, 1);
  assert.equal(w.append(chunk(1, 1, [2], true, 'h265:b')).ok, true);
});

test('fences old actor incarnations; reset clears replay and counters', () => {
  const w = windowOf();
  w.append(chunk(0, 0));
  assert.equal(w.fence(2).ok, true);
  code(w.resume(checkpoint(-1, 0)), 'STALE_STREAM_GENERATION');
  code(w.acknowledge(ack(0, 1)), 'STALE_STREAM_GENERATION');
  code(w.fence(2), 'INVALID_GENERATION');
  assert.equal(w.status.usedBytes, 0);
  assert.equal(w.status.nextSequence, 0);
  assert.equal(w.resume({ ...id(2), lastAppliedSequence: -1, lastAppliedEndOffset: 0 }).value.mode, 'continue');
});

test('invalid offsets and checkpoints fail closed', () => {
  const w = windowOf();
  w.append(chunk(0, 0));
  code(w.resume(checkpoint(99, 100)), 'CHECKPOINT_AHEAD');
  code(w.resume(checkpoint(-1, 1)), 'CHECKPOINT_OFFSET_MISMATCH');
  code(w.resume(checkpoint(0, 9)), 'CHECKPOINT_AHEAD');
  code(w.resume({ ...id(), lastAppliedSequence: 0, lastAppliedEndOffset: -1 }), 'INVALID_CHECKPOINT');
  code(w.acknowledge(ack(0, 4)), 'ACK_OFFSET_MISMATCH');
});

test('if end already applied, continue requires exact offset', () => {
  const w = windowOf();
  w.append(chunk(0, 0));
  assert.equal(w.resume(checkpoint(0, 1)).value.mode, 'continue');
  code(w.resume(checkpoint(0, 0)), 'CHECKPOINT_OFFSET_MISMATCH');
});

test('long deterministic churn never retains more than capacity or leaks ACKed data', () => {
  const w = windowOf(64, 64);
  let lastSeq = -1;
  let endOffset = 0;
  for (let i = 0; i < 2000; i++) {
    const r = w.append(chunk(i, i, [i & 255], i % 11 === 0));
    assert.equal(r.ok, true);
    if (i % 31 === 30) {
      assert.equal(w.acknowledge(ack(i, i + 1)).ok, true);
      lastSeq = i; endOffset = i + 1;
    }
    assert.ok(w.status.usedBytes <= 64);
    assert.ok(w.status.retainedChunks <= 64);
  }
  assert.equal(w.acknowledge(ack(1999, 2000)).ok, true);
  assert.equal(w.status.usedBytes, 0);
  assert.equal(w.status.lastAckSequence, 1999);
  assert.ok(lastSeq >= 0 && endOffset > 0);
});

test('known retained checkpoint with wrong end offset cannot request a silent reset', () => {
  const w = windowOf();
  w.append(chunk(0, 0, [1], true)); w.append(chunk(1, 1, [2], true));
  code(w.resume(checkpoint(0, 0)), 'CHECKPOINT_OFFSET_MISMATCH');
});

test('full 2 MiB window is bounded, then cumulative ACK frees exactly its byte budget', () => {
  const w = new ReplayWindow(id());
  const bytes = new Uint8Array(DEFAULT_CAPACITY_BYTES);
  assert.equal(w.append(chunk(0, 0, bytes, true)).ok, true);
  code(w.append(chunk(1, DEFAULT_CAPACITY_BYTES, [1])), 'BACKPRESSURE');
  assert.equal(w.status.usedBytes, DEFAULT_CAPACITY_BYTES);
  assert.equal(w.acknowledge(ack(0, DEFAULT_CAPACITY_BYTES)).ok, true);
  assert.equal(w.status.usedBytes, 0);
  assert.equal(w.append(chunk(1, DEFAULT_CAPACITY_BYTES, [1])).ok, true);
});
