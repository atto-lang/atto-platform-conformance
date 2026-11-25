import test from 'node:test';
import assert from 'node:assert/strict';
import {HandoffModel} from '../src/safepoint-policy.mjs';

test('cancellation during physical unwind finalizes only after carrier exit', () => {
  const state = new HandoffModel();
  state.commitEffect();
  state.requestCooperate();
  state.cancel();
  state.cancel();
  assert.equal(state.state, 'CANCEL_PENDING');
  assert.equal(state.carrierActive, true);
  assert.equal(state.finalizers, 0);
  assert.throws(() => state.resume(), /overlapping resume/);
  assert.throws(() => state.commitEffect(), /not running/);
  state.carrierExited();
  assert.equal(state.state, 'CANCELLED');
  assert.equal(state.finalizers, 1);
  assert.equal(state.sideEffects, 1);
  assert.equal(state.completions, 0);
  state.cancel();
  assert.equal(state.finalizers, 1);
  assert.throws(() => state.carrierExited(), /invalid physical exit/);
});

test('a runnable handoff can be cancelled without reacquiring its carrier', () => {
  const state = new HandoffModel();
  state.requestCooperate();
  state.carrierExited();
  assert.equal(state.state, 'RUNNABLE');
  state.cancel();
  state.cancel();
  assert.equal(state.state, 'CANCELLED');
  assert.equal(state.carrierActive, false);
  assert.equal(state.finalizers, 1);
  assert.equal(state.epochs, 0);
  assert.throws(() => state.resume(), /overlapping resume/);
});
