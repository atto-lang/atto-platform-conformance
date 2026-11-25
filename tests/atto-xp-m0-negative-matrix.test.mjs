/* Source-only matrix shape checks. These tests do NOT execute native negatives. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const matrix = JSON.parse(readFileSync(new URL('../contracts/atto-xp-m0-negative-matrix-v1.json', import.meta.url), 'utf8'));
const stages = new Set(['reference-model','abi-link','atto-guest','simulator','physical-device']);
const layers = new Set(['receipt','native-host','adapter','device']);

test('M0 matrix is versioned, scoped and non-promoting', () => {
  assert.equal(matrix.schemaVersion, 1);
  assert.equal(matrix.contractRef,'attolang.atto-xp.native-ui/1');
  assert.equal(matrix.status,'PROPOSED_NOT_EXECUTED');
  assert.equal(matrix.failClosed,true);
  assert.equal(matrix.minimumGate,'all-cases-exact-head-stepful-independent-review');
  assert.ok(matrix.cases.length >= 30);
});

test('every negative fixture is unique, has an oracle and remains unexecuted', () => {
  const seen = new Set();
  for (const c of matrix.cases) {
    assert.match(c.id,/^[HUCFRE][0-9]{2}$/);
    assert.ok(!seen.has(c.id), `duplicate fixture ${c.id}`);
    seen.add(c.id);
    assert.ok(layers.has(c.layer),c.id);
    assert.ok(stages.has(c.minimumStage),c.id);
    assert.match(c.attack,/^[a-z][a-z0-9-]+$/,c.id);
    assert.match(c.expectedError,/^[A-Z][A-Z_]+$/,c.id);
    assert.equal(c.executionStatus,'NOT_EXECUTED',`${c.id} needs real native execution`);
  }
});

test('M0 coverage includes lifetime, UI thread, actor grants, FFI and receipts', () => {
  const attacks = new Set(matrix.cases.map(c => c.attack));
  for (const name of [
    'stale-handle','aba-slot-reuse','cross-app-handle','cross-scene-handle',
    'cross-actor-owner','generation-wrap-quarantine','callback-after-scene-dispose',
    'wrong-ui-thread-view-mutation','synchronous-reentrant-guest-callback',
    'invalid-final-operation-no-partial-commit','stale-expected-revision',
    'batch-byte-overflow','reliable-event-saturation-cancel',
    'os-permission-denied','actor-capability-missing','permission-revoked-before-dispatch',
    'jni-local-ref-after-return','swift-retain-release-double-free',
    'native-pointer-cross-actor-channel','simulator-as-physical-claim',
    'zero-step-success-claim','duplicate-key-claims',
  ]) assert.ok(attacks.has(name),`missing negative ${name}`);
});
