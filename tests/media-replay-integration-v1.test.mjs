import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplayWindow } from '../lib/media-replay-v1.mjs';
import { ReceiverLedger } from '../lib/media-replay-receiver-v1.mjs';

const id = { streamId: 'integrated', generation: 1 };
const frame = (packet) => ({ ...id, ...packet });
const make = () => ({ sender: new ReplayWindow({ ...id, capacityBytes: 32 }), receiver: new ReceiverLedger(id) });
const reject = (value, code) => assert.deepEqual(value, { ok: false, error: { code } });
function append(sender, n, randomAccess = false) {
  assert.equal(sender.append({ sequence: n, offset: n, bytes: Uint8Array.from([n]), codecConfigId: 'codec-1', randomAccess }).ok, true);
}
function applied(receiver, packet) {
  const r = receiver.commit(frame(packet));
  assert.equal(r.ok, true);
  return r.value.checkpoint;
}

test('network loss replays missing data; ACK reclaims memory after apply', () => {
  const { sender, receiver } = make();
  for (let i = 0; i < 5; i++) append(sender, i, i === 0);
  const first = sender.resume({ ...id, lastAppliedSequence: -1, lastAppliedEndOffset: 0, codecConfigId: 'codec-1' });
  assert.equal(first.ok, true);
  const cp0 = applied(receiver, first.value.chunks[0]);
  assert.equal(sender.acknowledge({ ...id, sequence: cp0.lastAppliedSequence, endOffset: cp0.lastAppliedEndOffset }).ok, true);
  const afterLoss = sender.resume({ ...id, ...cp0 });
  assert.equal(afterLoss.value.mode, 'replay');
  assert.deepEqual(afterLoss.value.chunks.map(c => c.sequence), [1, 2, 3, 4]);
  for (const packet of afterLoss.value.chunks) applied(receiver, packet);
  assert.equal(receiver.commit(frame(afterLoss.value.chunks[3])).value.mode, 'duplicate');
  const finalCp = receiver.checkpoint;
  assert.equal(sender.acknowledge({ ...id, sequence: finalCp.lastAppliedSequence, endOffset: finalCp.lastAppliedEndOffset }).ok, true);
  assert.equal(sender.status.usedBytes, 0);
});

test('decoder loss yields explicit skip receipt, not cumulative decoded success', () => {
  const { sender, receiver } = make();
  for (let i = 0; i < 6; i++) append(sender, i, i === 0 || i === 4);
  const packets = sender.resume({ ...id, lastAppliedSequence: -1, lastAppliedEndOffset: 0, codecConfigId: 'codec-1' }).value.chunks;
  applied(receiver, packets[0]);
  assert.equal(sender.acknowledge({ ...id, sequence: 0, endOffset: 1 }).ok, true);
  assert.equal(receiver.resetAt({ ...id, restartSequence: 4, restartOffset: 4, codecConfigId: 'codec-1' }).ok, true);
  assert.equal(receiver.checkpoint.lastAppliedSequence, 0);
  applied(receiver, packets[4]);
  const gap = receiver.checkpoint.discontinuity;
  assert.equal(gap.skippedFromSequence, 1);
  assert.equal(gap.skippedThroughSequence, 3);
  const result = sender.acknowledgeDiscontinuity({ ...id, ...gap, sequence: 4, endOffset: 5 });
  assert.equal(result.ok, true);
  assert.equal(result.value.disposition, 'discontinuous');
  assert.equal(sender.status.lastDiscontinuity.skippedThroughSequence, 3);
  assert.equal(sender.status.lastAckSequence, 4);
  assert.equal(sender.status.usedBytes, 1);
  assert.equal(receiver.settleDiscontinuity({ ...id, restartSequence: 4 }).ok, true);
  applied(receiver, packets[5]);
  assert.equal(sender.acknowledge({ ...id, sequence: 5, endOffset: 6 }).ok, true);
  assert.equal(sender.status.usedBytes, 0);
});

test('forged restart information cannot release unacknowledged storage', () => {
  const { sender } = make();
  for (let i = 0; i < 5; i++) append(sender, i, i === 0 || i === 4);
  sender.acknowledge({ ...id, sequence: 0, endOffset: 1 });
  const gap = { previousAppliedSequence: 0, previousAppliedEndOffset: 1,
    skippedFromSequence: 1, skippedThroughSequence: 2, restartSequence: 3, restartOffset: 3,
    sequence: 4, endOffset: 5 };
  reject(sender.acknowledgeDiscontinuity({ ...id, ...gap }), 'UNVERIFIED_RESTART');
  reject(sender.acknowledgeDiscontinuity({ ...id, ...gap, restartSequence: 4 }), 'DISCONTINUITY_MISMATCH');
  reject(sender.acknowledgeDiscontinuity({ ...id, ...gap, generation: 2 }), 'STALE_STREAM_GENERATION');
  assert.equal(sender.status.lastAckSequence, 0);
  assert.equal(sender.status.usedBytes, 4);
  assert.equal(sender.status.lastDiscontinuity, null);
});

test('reset receipt cannot be replayed twice or across generations', () => {
  const { sender } = make();
  for (let i = 0; i < 4; i++) append(sender, i, i === 0 || i === 2);
  sender.acknowledge({ ...id, sequence: 0, endOffset: 1 });
  const gap = { previousAppliedSequence: 0, previousAppliedEndOffset: 1,
    skippedFromSequence: 1, skippedThroughSequence: 1, restartSequence: 2, restartOffset: 2, sequence: 3, endOffset: 4 };
  assert.equal(sender.acknowledgeDiscontinuity({ ...id, ...gap }).ok, true);
  reject(sender.acknowledgeDiscontinuity({ ...id, ...gap }), 'DISCONTINUITY_MISMATCH');
  sender.fence(2);
  reject(sender.acknowledgeDiscontinuity({ ...id, ...gap }), 'STALE_STREAM_GENERATION');
  assert.equal(sender.status.lastDiscontinuity, null);
});
