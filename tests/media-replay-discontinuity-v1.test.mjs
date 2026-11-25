import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ReceiverLedger } from '../lib/media-replay-receiver-v1.mjs';

const frame = (sequence, offset, bytes = [1], randomAccess = false, codecConfigId = 'c1', generation = 1) => {
  const owned = Uint8Array.from(bytes);
  return { streamId: 's', generation, sequence, offset, endOffset: offset + owned.length,
    bytes: owned, sha256: createHash('sha256').update(owned).digest('hex'), randomAccess, codecConfigId };
};
const reject = (result, expected) => assert.deepEqual(result, { ok: false, error: { code: expected } });

test('decoder reset leaves applied checkpoint unchanged until keyframe commit', () => {
  const r = new ReceiverLedger({ streamId: 's' });
  r.commit(frame(0, 0, [11], true));
  const before = r.checkpoint;
  assert.equal(r.resetAt({ streamId: 's', generation: 1, restartSequence: 9, restartOffset: 100, codecConfigId: 'c1' }).ok, true);
  assert.equal(r.checkpoint.lastAppliedSequence, before.lastAppliedSequence);
  assert.equal(r.checkpoint.lastAppliedEndOffset, before.lastAppliedEndOffset);
  assert.equal(r.checkpoint.discontinuity, null);
  assert.equal(r.checkpoint.resetPending, true);
  reject(r.offer(frame(9, 100, [12], false)), 'KEYFRAME_REQUIRED');
  const result = r.commit(frame(9, 100, [12], true));
  assert.equal(result.ok, true);
  assert.equal(r.checkpoint.lastAppliedSequence, 9);
  assert.equal(r.checkpoint.discontinuity.skippedFromSequence, 1);
  assert.equal(r.checkpoint.discontinuity.skippedThroughSequence, 8);
  assert.equal(r.checkpoint.discontinuity.previousAppliedEndOffset, 1);
  assert.equal(r.checkpoint.discontinuity.restartOffset, 100);
});

test('unsettled discontinuity cannot be replaced or erased', () => {
  const r = new ReceiverLedger({ streamId: 's' });
  r.commit(frame(0, 0, [1], true));
  r.resetAt({ streamId: 's', generation: 1, restartSequence: 4, restartOffset: 20, codecConfigId: 'c1' });
  reject(r.resetAt({ streamId: 's', generation: 1, restartSequence: 5, restartOffset: 22, codecConfigId: 'c1' }), 'RESET_NOT_SETTLED');
  r.commit(frame(4, 20, [5], true));
  reject(r.resetAt({ streamId: 's', generation: 1, restartSequence: 6, restartOffset: 22, codecConfigId: 'c1' }), 'RESET_NOT_SETTLED');
  reject(r.settleDiscontinuity({ streamId: 's', generation: 1, restartSequence: 3 }), 'NO_PENDING_DISCONTINUITY');
  assert.equal(r.settleDiscontinuity({ streamId: 's', generation: 1, restartSequence: 4 }).ok, true);
  assert.equal(r.checkpoint.discontinuity, null);
});

test('conflicting sequence with different bytes is not a harmless duplicate', () => {
  const r = new ReceiverLedger({ streamId: 's' });
  r.commit(frame(0, 0, [1], true));
  reject(r.offer(frame(0, 0, [7], true)), 'DUPLICATE_CONFLICT');
  assert.equal(r.checkpoint.lastAppliedSequence, 0);
});

test('expired receipt is refused, rather than accepting unverified old delivery', () => {
  const r = new ReceiverLedger({ streamId: 's', maxReceipts: 1 });
  r.commit(frame(0, 0, [1], true));
  r.commit(frame(1, 1, [2]));
  reject(r.offer(frame(0, 0, [1], true)), 'DUPLICATE_EXPIRED');
  assert.equal(r.offer(frame(1, 1, [2])).value.mode, 'duplicate');
});

test('generation fencing cancels pending reset with no artificial decode progress', () => {
  const r = new ReceiverLedger({ streamId: 's' });
  r.commit(frame(0, 0, [1], true));
  r.resetAt({ streamId: 's', generation: 1, restartSequence: 10, restartOffset: 100, codecConfigId: 'c1' });
  reject(r.commit(frame(10, 100, [1], false)), 'KEYFRAME_REQUIRED');
  assert.equal(r.checkpoint.lastAppliedSequence, 0);
  assert.equal(r.fence(2).ok, true);
  assert.equal(r.checkpoint.lastAppliedSequence, -1);
  assert.equal(r.checkpoint.discontinuity, null);
  assert.equal(r.checkpoint.resetPending, false);
});
