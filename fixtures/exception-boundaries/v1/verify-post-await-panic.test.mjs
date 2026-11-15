import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyPostAwaitPanic } from './verify-post-await-panic.mjs';

const ids = { childId: 'worker', supervisorId: 'root', incarnation: 2 };
const trace = () => [
  { ...ids, kind: 'child_suspended', waiterId: 'gate-1' },
  { ...ids, kind: 'supervisor_data_rejected_full', queueCapacity: 2, queuedData: 2 },
  { ...ids, kind: 'await_gate_released', waiterId: 'gate-1' },
  { ...ids, kind: 'child_resumed', waiterId: 'gate-1' },
  { ...ids, kind: 'child_panicked' },
  { ...ids, kind: 'child_cleanup_completed' },
  { ...ids, kind: 'supervisor_notice_handled', lane: 'CONTROL', failureKind: 'panic', queuedData: 2 },
  { ...ids, kind: 'supervisor_data_drained' },
  { ...ids, kind: 'supervisor_quiescent', pendingControl: 0, pendingData: 0 },
].map((event, i) => ({ ...event, sequence: i + 1 }));

test('accepts a suspended child and one CONTROL notice ahead of DATA drain', () => {
  verifyPostAwaitPanic(trace(), ids);
});

for (const [name, mutate] of [
  ['missing suspension', events => events.shift()],
  ['unrelated gate release', events => { events[2].waiterId = 'other-gate'; }],
  ['different waiter resumes', events => { events[3].waiterId = 'other-gate'; }],
  ['gate release for another incarnation', events => { events[2].incarnation = 1; }],
  ['truncated observation', events => events.pop()],
  ['quiescence with pending CONTROL', events => { events[8].pendingControl = 1; }],
  ['events after quiescence', events => events.push({ kind: 'other_event', sequence: 10 })],
  ['malformed event', events => { events[2] = null; }],
  ['spare DATA capacity', events => { events[1].queuedData = 1; }],
  ['DATA capacity freed before notice', events => { events[6].queuedData = 1; }],
  ['duplicate notice', events => events.push({ ...events[6], sequence: 10 })],
  ['duplicate cleanup', events => events.push({ ...events[5], sequence: 10 })],
  ['recovery intercepts panic', events => events.push({ kind: 'child_recovered', sequence: 10 })],
  ['notice runs on DATA lane', events => { events[6].lane = 'DATA'; }],
  ['stale incarnation', events => { events[6].incarnation = 1; }],
  ['wrong parent', events => { events[6].supervisorId = 'another-root'; }],
  ['cleanup completes after notice', events => {
    [events[5], events[6]] = [events[6], events[5]];
    events[5].sequence = 6;
    events[6].sequence = 7;
  }],
  ['DATA drains ahead of CONTROL', events => {
    [events[6], events[7]] = [events[7], events[6]];
    events[6].sequence = 7;
    events[7].sequence = 8;
  }],
]) {
  test('rejects ' + name, () => {
    const events = trace();
    mutate(events);
    assert.throws(() => verifyPostAwaitPanic(events, ids), assert.AssertionError);
  });
}
