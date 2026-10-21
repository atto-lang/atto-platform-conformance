import test from 'node:test';
import assert from 'node:assert/strict';

// BOUNDED ABSTRACT REFERENCE MODEL ONLY: not an Oreslang compiler/runtime test.
const NONE = Object.freeze({kind: 'none'});
const some = value => ({kind: 'some', value});
const terminal = (kind, value) => ({kind, value});

function trap(outcome) {
  if (outcome.kind === 'return') return some(outcome.value);
  if (outcome.kind === 'throw') return NONE;
  return outcome; // Raise, panic, cancellation and host termination bypass trap.
}
function directDeferredRecover(outcome, direct, consumed = false) {
  if (direct && !consumed && ['throw', 'raise'].includes(outcome.kind)) {
    return {consumed: true, recovered: outcome};
  }
  return {consumed: false, outgoing: outcome};
}
const RANK = Object.freeze({throw: 1, raise: 2, panic: 3, cancellation: 4, hostFatal: 5});
function cleanupPrecedence(primary, cleanup) {
  return RANK[primary.kind] >= RANK[cleanup.kind]
    ? {primary, suppressed: [cleanup]}
    : {primary: cleanup, suppressed: [primary]};
}

const start = () => ({phase: 'new', cancelRequested: false, resultSettled: false,
  cleanupCount: 0, physicalExit: false, done: false});
const ACTIONS = ['launch', 'requestCancel', 'checkpoint', 'resume', 'finish', 'unwind', 'carrierExit'];
function advance(original, action) {
  const s = {...original};
  if (action === 'launch' && s.phase === 'new') s.phase = s.cancelRequested ? 'cleanup' : 'running';
  if (action === 'requestCancel' && !s.done) {
    s.cancelRequested = true;
    if (s.phase === 'new') s.phase = 'cleanup';
  }
  if (action === 'checkpoint' && (s.phase === 'running' || s.phase === 'suspended')) {
    s.phase = s.cancelRequested ? 'cleanup' : 'suspended';
  }
  if (action === 'resume' && s.phase === 'suspended') s.phase = s.cancelRequested ? 'cleanup' : 'running';
  if (action === 'finish' && s.phase === 'running') s.phase = 'cleanup';
  if (action === 'unwind' && s.phase === 'cleanup') {
    s.cleanupCount += 1;
    s.resultSettled = true;
    s.phase = 'cleaned';
  }
  if (action === 'carrierExit' && s.phase === 'cleaned') {
    s.physicalExit = true;
    s.done = true;
    s.phase = 'quiescent';
  }
  return s;
}
function assertTaskInvariants(s) {
  assert.ok(s.cleanupCount >= 0 && s.cleanupCount <= 1, 'cleanup exactly once');
  assert.equal(s.done, s.phase === 'quiescent', 'quiescence distinguishes logical completion');
  if (s.done) {
    assert.equal(s.cleanupCount, 1, 'done after cleanup');
    assert.equal(s.resultSettled, true, 'done after result settled');
    assert.equal(s.physicalExit, true, 'done after physical carrier exit');
  }
  if (s.physicalExit) assert.equal(s.done, true);
}
function scopeDone(sealed, children) {
  return sealed && children.every(child => child.done);
}
function checkRefinementBounds(min, max) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < 0 || min > max) {
    throw new RangeError('unsatisfiable or invalid string length interval');
  }
  return {min, max};
}

// Keep products as ONE value. A tuple/record is not trap's error channel.
test('trap retains distinct option layers and opaque product values', () => {
  const absent = NONE;
  assert.deepEqual(trap(terminal('return', absent)), some(NONE));
  assert.deepEqual(trap(terminal('throw', {message: 'ordinary'})), NONE);
  assert.deepEqual(trap(terminal('return', {kind: 'err', value: 'not thrown'})),
    some({kind: 'err', value: 'not thrown'}));
  const tuple = [7, absent];
  const record = {first: 7, second: absent};
  assert.deepEqual(trap(terminal('return', tuple)), some(tuple));
  assert.deepEqual(trap(terminal('return', record)), some(record));
  for (const kind of ['raise', 'panic', 'cancellation', 'hostFatal']) {
    const cause = terminal(kind, {code: kind});
    assert.equal(trap(cause), cause, `${kind} must bypass trap`);
  }
});
test('recover requires direct deferred same-invocation throw/raise, never panic/cancel', () => {
  for (const kind of ['throw', 'raise']) {
    const e = terminal(kind, 'reason');
    assert.deepEqual(directDeferredRecover(e, true), {consumed: true, recovered: e});
    assert.deepEqual(directDeferredRecover(e, false), {consumed: false, outgoing: e});
    assert.deepEqual(directDeferredRecover(e, true, true), {consumed: false, outgoing: e});
  }
  for (const kind of ['panic', 'cancellation', 'hostFatal']) {
    const e = terminal(kind, 'reason');
    assert.deepEqual(directDeferredRecover(e, true), {consumed: false, outgoing: e});
  }
});
test('cleanup cannot downgrade stronger failures', () => {
  for (const a of Object.keys(RANK)) {
    for (const b of Object.keys(RANK)) {
      const result = cleanupPrecedence(terminal(a), terminal(b));
      assert.equal(RANK[result.primary.kind], Math.max(RANK[a], RANK[b]));
      assert.equal(result.suppressed.length, 1);
    }
  }
});
test('bounded exhaustive task-state exploration never publishes early done or double cleanup', () => {
  let frontier = new Map([['initial', start()]]);
  for (let depth = 0; depth < 10; depth++) {
    const next = new Map();
    for (const state of frontier.values()) {
      assertTaskInvariants(state);
      for (const action of ACTIONS) {
        const step = advance(state, action);
        assertTaskInvariants(step);
        next.set(JSON.stringify(step), step);
      }
    }
    frontier = next;
  }
  assert.ok(frontier.size > 0);
  const stopped = ['launch', 'requestCancel', 'checkpoint', 'unwind', 'carrierExit']
    .reduce(advance, start());
  assert.equal(stopped.done, true);
  assert.equal(stopped.cleanupCount, 1);
  assert.equal(advance(stopped, 'unwind').cleanupCount, 1);
});
test('unsafe mutants are caught: early done, skipped cleanup, duplicate cleanup', () => {
  assert.throws(() => assertTaskInvariants({...start(), done: true}), /quiescence/);
  assert.throws(() => assertTaskInvariants({...start(), phase: 'quiescent', done: true,
    resultSettled: true, physicalExit: true}), /cleanup/);
  assert.throws(() => assertTaskInvariants({...start(), cleanupCount: 2}), /cleanup/);
  assert.equal(scopeDone(true, [{done: true}, {done: false}]), false);
  assert.equal(scopeDone(false, [{done: true}]), false);
  assert.equal(scopeDone(true, [{done: true}, {done: true}]), true);
});
test('refinement interval rejects impossible declaration and dynamic schema', () => {
  assert.deepEqual(checkRefinementBounds(4, 7), {min: 4, max: 7});
  assert.throws(() => checkRefinementBounds(4, 3), /unsatisfiable/);
  assert.throws(() => checkRefinementBounds(-1, 7), /unsatisfiable/);
  assert.throws(() => checkRefinementBounds(4, Infinity), /unsatisfiable/);
});
