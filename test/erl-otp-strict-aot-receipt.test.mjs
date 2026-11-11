import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReceipt } from '../bin/verify-erl-otp-aot-receipt.mjs';

const hex40 = 'a'.repeat(40), hex64 = 'b'.repeat(64);
function candidate() {
  return {
    contract: 'attolang-erlang-otp-strict-aot-v1',
    backend: 'llvm',
    feature: 'typed_equality',
    status: 'VERIFIED',
    evidenceClass: 'compiler-guest',
    compiler: { repository: 'ores-truffle-oreslang/oreslang-source.llvm', headSha: hex40, treeSha: hex40, binarySha256: hex64 },
    fixture: { id: 'eq.same_int', sha256: hex64 },
    artifact: { sha256: hex64 },
    execution: {
      runId: 42, jobId: 43, jobAttempt: 1, executedSteps: 6,
      compiledGuest: true, executedGuest: true, mode: 'strict-aot',
      jitUsed: false, interpreterFallbackUsed: false, runtimeGuestCompilerUsed: false,
      reflectionDispatchUsed: false, aotFallbackMutationRejected: true, negativeDiagnosticsPassed: true,
      runUrl: 'https://github.com/example/repo/actions/runs/42',
      independentReviewUrl: 'https://github.com/example/repo/pull/4#pullrequestreview-55',
    }
  };
}
test('receipt checker never claims independent attestation', () => {
  const result = validateReceipt(candidate());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.classification, 'STRUCTURAL_ONLY_NOT_INDEPENDENTLY_ATTESTED');
});
test('rejects zero-step, host-only, missing AOT/negative proof and invalid pinning', () => {
  const mutations = [
    r => { r.execution.executedSteps = 0; },
    r => { r.execution.executedSteps = null; },
    r => { r.evidenceClass = 'host-only'; },
    r => { r.compiler.headSha = 'bad'; },
    r => { r.compiler.treeSha = ''; },
    r => { r.compiler.binarySha256 = ''; },
    r => { r.execution.executedGuest = false; },
    r => { r.execution.compiledGuest = false; },
    r => { r.execution.interpreterFallbackUsed = true; },
    r => { delete r.execution.jitUsed; },
    r => { r.execution.runtimeGuestCompilerUsed = true; },
    r => { r.execution.reflectionDispatchUsed = true; },
    r => { r.execution.aotFallbackMutationRejected = false; },
    r => { r.execution.negativeDiagnosticsPassed = false; },
    r => { r.execution.runId = 0; },
    r => { r.execution.jobAttempt = null; },
    r => { r.execution.runUrl = 'https://github.com/example/repo/actions/runs/41'; },
    r => { r.execution.independentReviewUrl = ''; },
    r => { r.backend = 'js'; },
    r => { r.status = 'NOT_EXECUTED'; },
  ];
  for (const mutate of mutations) {
    const r = candidate(); mutate(r);
    const result = validateReceipt(r);
    assert.equal(result.ok, false, mutate.toString());
    assert.ok(result.errors.length > 0);
  }
});
test('null, array and absent receipts fail closed', () => {
  for (const value of [null, undefined, [], 'PASS', 1]) assert.equal(validateReceipt(value).ok, false);
});
