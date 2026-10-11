import test from 'node:test';
import assert from 'node:assert/strict';
import { explore } from '../formal/supervision/explore.mjs';

test('single supervisor serializes two children across STOP and RESTART', () => {
  const result = explore({
    owners: [0, 0], supervisors: 1, maxGeneration: 2, maxTurns: 2
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.states, 1228, 'shared CONTROL trace coverage changed');
  assert.equal(result.transitions, 2212);
  for (const action of ['SpawnReplacement', 'AdmitReplacement',
                        'CleanupReplacement', 'AbortRestart', 'CommitRestart',
                        'StartHostEffect', 'Reconcile', 'CloseSupervisor'])
    assert.ok(result.actions[action] > 0, 'missing transition: ' + action);
});

test('two supervisors may own independent CONTROL turns', () => {
  const result = explore({
    owners: [0, 1], supervisors: 2, maxGeneration: 2, maxTurns: 2
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.states, 6400, 'independent CONTROL trace coverage changed');
  assert.equal(result.transitions, 17120);
  assert.ok(result.actions.CommitRestart > 0);
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

test('premature RESTART abort of a live replacement has a counterexample', () => {
  const result = explore({
    owners: [0], supervisors: 1, maxGeneration: 2,
    maxTurns: 2, unsafeAbortMutant: true
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes('NoOrphanReplacement'));
  assert.deepEqual(result.trace, [
    'Init', 'Cleanup(0)', 'Finalize(0)', 'AcquireControl(0)',
    'ReserveRestart(0)', 'SpawnReplacement(0)',
    'UNSAFE_AbortLiveReplacement(0)'
  ]);
});

test('premature RESTART commit without exact-generation admission is rejected', () => {
  const result = explore({
    owners: [0], supervisors: 1, maxGeneration: 2, maxTurns: 2,
    unsafeCommitMutant: true
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes('NoUnreadyActiveIncarnation'));
  assert.deepEqual(result.trace, [
    'Init', 'Cleanup(0)', 'Finalize(0)', 'AcquireControl(0)',
    'ReserveRestart(0)', 'UNSAFE_CommitUnreadyReplacement(0)'
  ]);
});

test('invalid exploration bounds cannot produce vacuous green proofs', () => {
  assert.throws(() => explore({ maxGeneration: 0 }), /invalid finite/);
  assert.throws(() => explore({ maxTurns: -1 }), /invalid finite/);
  assert.throws(() => explore({ supervisors: 0 }), /invalid finite/);
  assert.throws(() => explore({ maxStates: 0 }), /invalid finite/);
});

test('foreign or invalid child/supervisor ownership is rejected', () => {
  assert.throws(() => explore({ owners: [1], supervisors: 1 }), /invalid owner/);
  assert.throws(() => explore({ owners: [], supervisors: 1 }), /invalid owner/);
});
