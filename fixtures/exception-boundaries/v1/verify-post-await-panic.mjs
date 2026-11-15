import assert from 'node:assert/strict';

// The caller supplies a trace taken from an authenticated backend observer.
// This checks the event contract and makes no claim about trace provenance.
export function verifyPostAwaitPanic(events, { childId, supervisorId, incarnation }) {
  assert.ok(childId && supervisorId && childId !== supervisorId);
  assert.ok(Number.isSafeInteger(incarnation) && incarnation > 0);
  assert.ok(Array.isArray(events) && events.length <= 128);
  const one = (kind) => {
    const matching = events.filter(event => event.kind === kind);
    assert.equal(matching.length, 1, kind);
    return matching[0];
  };
  let previous = 0;
  for (const event of events) {
    assert.ok(Number.isSafeInteger(event.sequence) && event.sequence > previous);
    previous = event.sequence;
  }
  const suspended = one('child_suspended');
  const full = one('supervisor_data_rejected_full');
  const released = one('await_gate_released');
  const resumed = one('child_resumed');
  const panic = one('child_panicked');
  const cleanup = one('child_cleanup_completed');
  const notice = one('supervisor_notice_handled');
  const drain = one('supervisor_data_drained');
  for (const event of [suspended, resumed, panic, cleanup, notice]) {
    assert.equal(event.childId, childId);
    assert.equal(event.incarnation, incarnation);
  }
  assert.equal(full.supervisorId, supervisorId);
  assert.equal(drain.supervisorId, supervisorId);
  assert.equal(notice.supervisorId, supervisorId);
  assert.equal(notice.lane, 'CONTROL');
  assert.equal(notice.failureKind, 'panic');
  assert.ok(Number.isSafeInteger(full.queueCapacity) && full.queueCapacity > 0);
  assert.equal(full.queuedData, full.queueCapacity);
  assert.equal(notice.queuedData, full.queueCapacity);
  assert.ok(suspended.sequence < released.sequence);
  assert.ok(full.sequence < released.sequence);
  const ordered = [released, resumed, panic, cleanup, notice, drain];
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(ordered[i - 1].sequence < ordered[i].sequence);
  }
  for (const forbidden of ['child_caught', 'child_trapped', 'child_recovered']) {
    assert.ok(!events.some(event => event.kind === forbidden), forbidden);
  }
}
