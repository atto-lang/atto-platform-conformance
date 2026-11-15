import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTryWritechHistory, checkTryWritechLinearizability as check,
  tryWritechTransition} from '../src/try-writech-linearizability-v1.mjs';
const schema = 'oreslang.try_writech_linearizability.v1';
const h = (events, capacity = 1) => ({schema, capacity, events});
const e = (id, op, invoke, complete, result, payload) => ({id, op, invoke, complete,
  ...(payload === undefined ? {} : {payload}), result});
const w = (id, invoke, complete, result, payload) => e(id, 'write', invoke, complete, result, payload);
const r = (id, invoke, complete, result) => e(id, 'read', invoke, complete, result);
const c = (id, invoke, complete, result = 'CLOSED') => e(id, 'close', invoke, complete, result);
const good = history => assert.equal(check(history).status, 'LINEARIZABLE');
const bad = history => assert.equal(check(history).status, 'NOT_LINEARIZABLE');

test('accept one owned payload, reject full without losing its identity, retry after read', () => {
  good(h([w('a', 1, 2, 'ACCEPTED', 'one'), w('b', 3, 4, 'FULL:two', 'two'),
    r('r', 5, 6, 'VALUE:one'), w('retry', 7, 8, 'ACCEPTED', 'two')]));
  bad(h([w('a', 1, 2, 'ACCEPTED', 'one'), w('b', 3, 4, 'ACCEPTED', 'two')]));
});

test('close races: only a write committed before close may succeed', () => {
  good(h([w('a', 1, 4, 'ACCEPTED', 'one'), c('close', 2, 3)]));
  bad(h([c('close', 1, 2), w('a', 3, 4, 'ACCEPTED', 'one')]));
  good(h([c('close', 1, 2), w('a', 3, 4, 'CLOSED:one', 'one')]));
});

test('read after close drains committed values, then reports closed separately from None', () => {
  good(h([w('a', 1, 2, 'ACCEPTED', 'one'), c('close', 3, 4),
    r('drain', 5, 6, 'VALUE:one'), r('empty', 7, 8, 'CHANNEL_CLOSED')]));
  good(h([r('none', 1, 2, 'NONE')]));
  bad(h([c('close', 1, 2), r('none', 3, 4, 'NONE')]));
});

test('overlapping writes at capacity one admit at most one', () => {
  good(h([w('a', 1, 4, 'ACCEPTED', 'one'), w('b', 2, 3, 'FULL:two', 'two')]));
  bad(h([w('a', 1, 4, 'ACCEPTED', 'one'), w('b', 2, 3, 'ACCEPTED', 'two')]));
});

test('the same payload cannot be admitted twice while queued; receiver can resend', () => {
  bad(h([w('a', 1, 2, 'ACCEPTED', 'one'), w('b', 3, 4, 'FULL:one', 'one')]));
  good(h([w('a', 1, 2, 'ACCEPTED', 'one'), r('r', 3, 4, 'VALUE:one'),
    w('b', 5, 6, 'ACCEPTED', 'one')]));
  good(h([w('a', 1, 2, 'ACCEPTED', 'one'), r('r', 3, 4, 'VALUE:one'),
    w('b', 5, 6, 'ACCEPTED', 'two')]));
});

test('bounded search reports INCONCLUSIVE, never a false negative or guest PASS', () => {
  const history = h([w('a', 1, 6, 'ACCEPTED', 'one'),
    w('b', 2, 7, 'FULL:two', 'two'), r('r', 3, 8, 'VALUE:one')]);
  assert.equal(check(history, {maxStates: 1}).status, 'INCONCLUSIVE');
  const out = check(history);
  assert.equal(out.status, 'LINEARIZABLE');
  assert.equal(out.compiledGuestExecuted, false);
  assert.equal(out.nativeParityCertified, false);
});

test('malformed inputs, getters and unsupported rendezvous fail closed', () => {
  const base = () => h([w('a', 1, 2, 'ACCEPTED', 'one')]);
  for (const mutate of [
    x => x.schema = 'wrong', x => x.capacity = 0,
    x => x.events[0].op = 'suspend', x => x.events[0].payload = '../oops',
    x => x.events[0].result = 'ACCEPTED\nFAKE_PASS',
    x => x.events[0].secret = true,
    x => x.events[0].complete = 1,
    x => x.events.push(w('a', 3, 4, 'ACCEPTED', 'two')),
    x => Object.defineProperty(x.events[0], 'result', {get: () => 'ACCEPTED'}),
    x => x.events.push(r('read', 1, 3, 'NONE')),
    x => x.events[0].result = 'FULL:wrong',
    x => x.events = new Proxy(x.events, {get: () => {throw new Error('proxy trap should not run');}})
  ]) {
    const x = base(); mutate(x);
    assert.throws(() => validateTryWritechHistory(x), /INVALID_TRY_WRITECH_HISTORY/);
  }
  assert.throws(() => check(base(), {maxStates: 0}), /INVALID_TRY_WRITECH_HISTORY/);
});

test('reference write/read/close transitions are deterministically reproducible', () => {
  const ops = [
    {op: 'write', payload: 'one'}, {op: 'write', payload: 'two'},
    {op: 'read'}, {op: 'close'}
  ];
  let cases = 0;
  const visit = (state, events, used) => {
    if (events.length) { good(h(events)); cases++; }
    if (events.length === 4) return;
    for (let i = 0; i < ops.length; i++) {
      if (used.has(i)) continue;
      const op = ops[i];
      const {state: next, result} = tryWritechTransition(state, op, 1);
      const t = events.length * 2 + 1;
      if (result === 'INVALID_OWNERSHIP') continue;
      visit(next, [...events, e('op' + i, op.op, t, t + 1, result, op.payload)],
        new Set([...used, i]));
    }
  };
  visit({open: true, queue: [], ownership: {}}, [], new Set());
  assert.equal(cases, 64); // 4P1 + 4P2 + 4P3 + 4P4
});
