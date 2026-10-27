import test from 'node:test';
import assert from 'node:assert/strict';
import {explore, checkRealtimeFinite} from './three-guarantees-bounded.mjs';

test('normal model preserves all generation/session invariants over reachable states', () => {
  const result = explore();
  assert.equal(result.status, 'checked_finite_model', JSON.stringify(result));
  assert.equal(result.states, 1017);
});
test('mutant: publishing an unvalidated generation is rejected', () => {
  const result = explore('publish');
  assert.equal(result.status, 'counterexample', JSON.stringify(result));
  assert.equal(result.fault, 'unvalidated_image_published');
  assert.ok(result.path.some(x => x.startsWith('BAD_commit_unvalidated')));
});

test('mutant: premature old-image purge has a real shortest counterexample', () => {
  const result = explore('purge');
  assert.equal(result.status, 'counterexample', JSON.stringify(result));
  assert.match(result.fault, /dangling_session_pin/);
  assert.ok(result.path.some(x => x.startsWith('BAD_retire')));
});
test('mutant: timeout cannot resurrect a consumed phase capability', () => {
  const result = explore('resurrect');
  assert.equal(result.status, 'counterexample', JSON.stringify(result));
  assert.match(result.fault, /old_phase_resurrected/);
  assert.ok(result.path.some(x => x.startsWith('BAD_timeout')));
});
test('all 37,908 finite real-time vectors preserve admission soundness', () => {
  const result = checkRealtimeFinite();
  assert.equal(result.status, 'checked_finite_model', JSON.stringify(result));
  assert.equal(result.checked, 37908);
});
test('mutant: removing cleanup from response-time bound produces counterexample', () => {
  const result = checkRealtimeFinite('omit_cleanup');
  assert.equal(result.status, 'counterexample', JSON.stringify(result));
  assert.ok(result.inputs.cleanup > 0);
});
