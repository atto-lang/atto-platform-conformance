import assert from 'node:assert/strict';

// The caller supplies a trace taken from an authenticated backend observer.
// This checks the event contract and makes no claim about trace provenance.
export function verifyPostAwaitPanic(events, { childId, supervisorId, incarnation }) {
  assert.ok(typeof childId === 'string' && childId.length > 0);
  assert.ok(typeof supervisorId === 'string' && supervisorId.length > 0);
  assert.notEqual(childId, supervisorId);
  assert.ok(Number.isSafeInteger(incarnation) && incarnation > 0);
  assert.ok(Array.isArray(events) && events.length <= 128);
  const one = (kind) => {
    const matching = events.filter(event => event.kind === kind);
    assert.equal(matching.length, 1, kind);
    return matching[0];
  };
  let previous = 0;
  for (const event of events) {
    assert.ok(event && typeof event === 'object' && !Array.isArray(event));
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
  const quiescent = one('supervisor_quiescent');
  for (const event of [suspended, released, resumed, panic, cleanup, notice, quiescent]) {
    assert.equal(event.childId, childId);
    assert.equal(event.incarnation, incarnation);
  }
  assert.ok(typeof suspended.waiterId === 'string' && suspended.waiterId.length > 0);
  assert.equal(released.waiterId, suspended.waiterId);
  assert.equal(resumed.waiterId, suspended.waiterId);
  assert.equal(quiescent.supervisorId, supervisorId);
  assert.equal(quiescent.pendingControl, 0);
  assert.equal(quiescent.pendingData, 0);
  assert.equal(events.at(-1), quiescent);
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
  const ordered = [released, resumed, panic, cleanup, notice, drain, quiescent];
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(ordered[i - 1].sequence < ordered[i].sequence);
  }
  for (const forbidden of ['child_caught', 'child_trapped', 'child_recovered']) {
    assert.ok(!events.some(event => event.kind === forbidden), forbidden);
  }
}
