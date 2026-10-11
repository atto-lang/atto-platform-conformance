import test from 'node:test';
import assert from 'node:assert/strict';
import { explore } from '../formal/supervision/explore.mjs';

test('single supervisor serializes two children across STOP and RESTART', () => {
  const result = explore({
    owners: [0, 0], supervisors: 1, maxGeneration: 2, maxTurns: 2
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.states >= 500, 'exploration unexpectedly lost interleavings');
});

test('two supervisors may own independent CONTROL turns', () => {
  const result = explore({
    owners: [0, 1], supervisors: 2, maxGeneration: 2, maxTurns: 2
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.states >= 2000, 'multi-supervisor exploration shrank unexpectedly');
});

test('one-generation boundary also holds', () => {
  const result = explore({
    owners: [0, 0], supervisors: 1, maxGeneration: 1, maxTurns: 2
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('intentional duplicate host effect produces concrete counterexample', () => {
  const result = explore({
    owners: [0], supervisors: 1, maxGeneration: 2,
    maxTurns: 2, mutant: true
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes('NoDuplicateEffects'));
  assert.deepEqual(result.trace, [
    'Init', 'Cleanup(0)', 'Finalize(0)', 'AcquireControl(0)',
    'ReserveStop(0)', 'StartHostEffect(0)', 'UNSAFE_HostReplay(0)'
  ]);
});

test('foreign or invalid child/supervisor ownership is rejected', () => {
  assert.throws(() => explore({ owners: [1], supervisors: 1 }), /invalid owner/);
  assert.throws(() => explore({ owners: [], supervisors: 1 }), /invalid owner/);
});
