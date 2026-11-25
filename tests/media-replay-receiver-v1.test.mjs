import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ReceiverLedger } from '../lib/media-replay-receiver-v1.mjs';

const frame = (sequence, offset, bytes = [42], randomAccess = false, codecConfigId = 'c1', generation = 1) => {
  const owned = Uint8Array.from(bytes);
  return { streamId: 's', generation, sequence, offset, endOffset: offset + owned.length,
    bytes: owned, sha256: createHash('sha256').update(owned).digest('hex'), randomAccess, codecConfigId };
};
const code = (result, expected) => assert.deepEqual(result, { ok: false, error: { code: expected } });

test('offer has no checkpoint side effect; commit advances after application', () => {
  const r = new ReceiverLedger({ streamId: 's' });
  const f = frame(0, 0, [1], true);
  assert.equal(r.offer(f).value.mode, 'ready');
  assert.equal(r.checkpoint.lastAppliedSequence, -1);
  assert.equal(r.commit(f).value.mode, 'applied');
  assert.equal(r.checkpoint.lastAppliedSequence, 0);
  assert.equal(r.checkpoint.lastAppliedEndOffset, 1);
});

test('duplicate deliveries never double-apply', () => {
  const r = new ReceiverLedger({ streamId: 's' });
  const f = frame(0, 0);
  r.commit(f);
  assert.equal(r.offer(f).value.mode, 'duplicate');
  assert.equal(r.commit(f).value.mode, 'duplicate');
  assert.equal(r.checkpoint.lastAppliedSequence, 0);
});

test('out-of-order and offset violations cannot advance checkpoint', () => {
  const r = new ReceiverLedger({ streamId: 's' });
  code(r.offer(frame(1, 1)), 'OUT_OF_ORDER');
  code(r.commit(frame(0, 3)), 'OUT_OF_ORDER');
  assert.equal(r.checkpoint.lastAppliedSequence, -1);
});

test('tampering with payload after hash generation fails integrity verification', () => {
  const r = new ReceiverLedger({ streamId: 's' });
  const f = frame(0, 0);
  f.bytes[0] = 9;
  code(r.commit(f), 'HASH_MISMATCH');
  assert.equal(r.checkpoint.lastAppliedSequence, -1);
});

test('only a declared decoder reset may introduce a missing-sequence gap', () => {
  const r = new ReceiverLedger({ streamId: 's' });
  r.commit(frame(0, 0));
  assert.equal(r.resetAt({ streamId: 's', generation: 1, restartSequence: 8, restartOffset: 20, codecConfigId: 'c1' }).ok, true);
  code(r.offer(frame(8, 20, [1], false)), 'KEYFRAME_REQUIRED');
  assert.equal(r.commit(frame(8, 20, [1], true)).ok, true);
  assert.equal(r.checkpoint.lastAppliedSequence, 8);
});

test('cannot reset decoder backwards or change configuration on a delta frame', () => {
  const r = new ReceiverLedger({ streamId: 's' });
  r.commit(frame(0, 0, [1], true));
  code(r.resetAt({ streamId: 's', generation: 1, restartSequence: 0, restartOffset: 0, codecConfigId: 'c1' }), 'INVALID_RESET');
  code(r.commit(frame(1, 1, [2], false, 'c2')), 'CODEC_CONFIG_REQUIRES_RANDOM_ACCESS');
  assert.equal(r.commit(frame(1, 1, [2], true, 'c2')).ok, true);
});

test('wrong stream/generation and old incarnation are rejected', () => {
  const r = new ReceiverLedger({ streamId: 's' });
  code(r.offer({ ...frame(0, 0), streamId: 'other' }), 'STALE_STREAM_GENERATION');
  r.fence(2);
  code(r.commit(frame(0, 0)), 'STALE_STREAM_GENERATION');
  assert.equal(r.commit(frame(0, 0, [1], true, 'c1', 2)).ok, true);
  assert.equal(r.checkpoint.generation, 2);
});

test('invalid hash/offset metadata is rejected', () => {
  const r = new ReceiverLedger({ streamId: 's' });
  code(r.offer({ ...frame(0, 0), sha256: 'bad' }), 'INVALID_CHUNK');
  code(r.offer({ ...frame(0, 0), endOffset: 77 }), 'INVALID_CHUNK');
  assert.equal(r.checkpoint.lastAppliedSequence, -1);
});
