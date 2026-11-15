import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyPostAwaitPanic } from './verify-post-await-panic.mjs';

const ids = { childId: 'worker', supervisorId: 'root', incarnation: 2 };
const trace = () => [
  { ...ids, kind: 'child_suspended' },
  { ...ids, kind: 'supervisor_data_rejected_full', queueCapacity: 2, queuedData: 2 },
  { kind: 'await_gate_released' },
  { ...ids, kind: 'child_resumed' },
  { ...ids, kind: 'child_panicked' },
  { ...ids, kind: 'child_cleanup_completed' },
  { ...ids, kind: 'supervisor_notice_handled', lane: 'CONTROL', failureKind: 'panic', queuedData: 2 },
  { ...ids, kind: 'supervisor_data_drained' },
].map((event, i) => ({ ...event, sequence: i + 1 }));

test('accepts a suspended child and one CONTROL notice ahead of DATA drain', () => {
  verifyPostAwaitPanic(trace(), ids);
});

for (const [name, mutate] of [
  ['missing suspension', events => events.shift()],
  ['spare DATA capacity', events => { events[1].queuedData = 1; }],
  ['DATA capacity freed before notice', events => { events[6].queuedData = 1; }],
  ['duplicate notice', events => events.push({ ...events[6], sequence: 9 })],
  ['duplicate cleanup', events => events.push({ ...events[5], sequence: 9 })],
  ['recovery intercepts panic', events => events.push({ kind: 'child_recovered', sequence: 9 })],
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
