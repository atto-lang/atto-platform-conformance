import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectContract, inspectReceipt, PINNED, BACKENDS } from '../bin/verify-atto-stdlib-evidence.mjs';

const contract = JSON.parse(readFileSync(new URL('../contracts/atto-core-stdlib-evidence-v1.json', import.meta.url), 'utf8'));
function inventory() {
  return { schema: 'attolang.core-stdlib-receipt.v1', parity_verified: false,
    evaluations: Object.entries(PINNED).flatMap(([module, git_blob_sha]) =>
      BACKENDS.map(backend => ({module, backend, git_blob_sha, status: 'NOT_EXECUTED',
        steps: 0, guest_executions: 0, negative_cases: 0, compiler_head: null, run_url: null}))) };
}
test('contract is source-only, eight modules, five backends', () => {
  assert.deepEqual(inspectContract(contract), {modules:8, backends:5, status:'SOURCE_ONLY_NOT_EXECUTED'});
});
test('complete unexecuted inventory cannot be considered verified', () => {
  assert.equal(inspectReceipt(inventory()).status, 'CANDIDATE_SCHEMA_ONLY_NOT_VERIFIED');
});
test('changed SHA rejected', () => {
  const x=structuredClone(contract); x.modules[0].git_blob_sha='a'.repeat(40);
  assert.throws(()=>inspectContract(x));
});
test('missing module rejected', () => {
  const x=structuredClone(contract); x.modules.pop();
  assert.throws(()=>inspectContract(x));
});
test('policy relaxation rejected', () => {
  const x=structuredClone(contract); x.policy.independent_review_required=false;
  assert.throws(()=>inspectContract(x));
});
test('partial backend set rejected', () => {
  const x=inventory(); x.evaluations.pop();
  assert.throws(()=>inspectReceipt(x));
});
test('duplicated backend entries rejected', () => {
  const x=inventory(); x.evaluations[0]=structuredClone(x.evaluations[1]);
  assert.throws(()=>inspectReceipt(x));
});
test('incorrect module identity rejected', () => {
  const x=inventory(); x.evaluations[0].git_blob_sha='b'.repeat(40);
  assert.throws(()=>inspectReceipt(x));
});
test('zero-step record with guest count rejected', () => {
  const x=inventory(); x.evaluations[0].guest_executions=1;
  assert.throws(()=>inspectReceipt(x));
});
test('missing negative compiler evidence rejected', () => {
  const x=inventory(); x.evaluations[0].status='EXECUTED_CANDIDATE';
  assert.throws(()=>inspectReceipt(x));
});
test('parity assertions are not accepted as unauthenticated', () => {
  const x=inventory(); x.parity_verified=true;
  assert.throws(()=>inspectReceipt(x));
});
