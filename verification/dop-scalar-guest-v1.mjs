import { validateDopPositiveExecutionProfile } from './dop-execution-profile-v1.mjs';
// This checks the STRUCTURE of an evidence receipt, not its authenticity.
// A release gate must independently fetch the GitHub job and artifact records.
const sha1 = /^[0-9a-f]{40}$/;
const sha256 = /^[0-9a-f]{64}$/;
const backends = new Set(['java', 'llvm', 'wasm', 'forge', 'net']);
const states = new Set(['PASSED', 'FAILED', 'UNSUPPORTED', 'NOT_EXECUTED']);
const stages = new Set(['native-guest', 'managed-guest', 'browser-guest', 'nativeaot-guest']);

export function validateDopGuestReceipt(receipt, contract) {
  const errors = [];
  const need = (ok, reason) => { if (!ok) errors.push(reason); };
  need(receipt !== null && typeof receipt === 'object' && !Array.isArray(receipt), 'receipt-object');
  if (errors.length) return errors;
  need(contract?.contract === 'attolang.dop.scalar-guest/1', 'contract-version');
  need(receipt.contract === contract?.contract, 'receipt-contract-version');
  need(backends.has(receipt.backend), 'backend');
  need(states.has(receipt.status), 'status');
  need(receipt.caseId === 'primitive-columns-atto-guest', 'case-id');
  if (!states.has(receipt.status)) return errors;
  if (receipt.status === 'NOT_EXECUTED') {
    need(receipt.guestExecuted !== true, 'not-executed-cannot-claim-guest');
    need(!receipt.guestArtifactSha256, 'not-executed-cannot-claim-artifact');
    need(receipt.guestExitCode == null, 'not-executed-cannot-claim-exit');
    need(receipt.executionStage == null, 'not-executed-cannot-claim-stage');
    return errors;
  }

  need(sha1.test(receipt.sourceHeadSha ?? ''), 'source-head-sha');
  need(receipt.checkoutHeadSha === receipt.sourceHeadSha, 'exact-head-checkout');
  need(sha1.test(receipt.sourceTreeSha ?? ''), 'source-tree-sha');
  need(receipt.fixtureGitBlobSha === contract.fixture.gitBlobSha, 'fixture-git-blob-sha');
  need(sha256.test(receipt.compilerSha256 ?? ''), 'compiler-sha256');
  need(sha256.test(receipt.fixtureSha256 ?? ''), 'fixture-sha256');
  need(typeof receipt.command === 'string' && receipt.command.trim().length > 0, 'command');
  need(typeof receipt.toolchain === 'string' && receipt.toolchain.trim().length > 0, 'toolchain');
  need(Number.isSafeInteger(receipt.discoveredTests) && receipt.discoveredTests > 0, 'discovered-tests');
  need(Number.isSafeInteger(receipt.executedTests) && receipt.executedTests > 0, 'executed-tests');
  need(Number.isInteger(receipt.executedTests) && receipt.executedTests <= receipt.discoveredTests, 'test-count-bound');

  const job = receipt.ciJob;
  need(Number.isSafeInteger(job?.runId) && job.runId > 0, 'ci-run-id');
  need(Number.isSafeInteger(job?.runnerId) && job.runnerId > 0, 'runner-admission');
  if (receipt.status !== 'FAILED') need(job?.conclusion === 'success', 'ci-job-conclusion');
  need(Array.isArray(job?.steps) && job.steps.length > 0 && job.steps.length <= 1000, 'bounded-nonzero-steps');
  const observed = new Set();
  const stepOrder = new Map();
  const stepNumbers = new Set();
  if (Array.isArray(job?.steps)) {
    for (const step of job.steps) {
      need(typeof step?.id === 'string' && step.id.length > 0, 'step-id');
      need(!observed.has(step?.id), 'duplicate-step');
      observed.add(step?.id);
      stepOrder.set(step?.id, step?.number);
      need(receipt.status === 'FAILED'
        ? ['success', 'failure'].includes(step?.conclusion)
        : step?.conclusion === 'success', 'step-conclusion');
      need(Number.isSafeInteger(step?.number) && step.number > 0, 'step-number');
      need(!stepNumbers.has(step?.number), 'duplicate-step-number');
      stepNumbers.add(step?.number);
      need(typeof step?.startedAt === 'string' && !Number.isNaN(Date.parse(step.startedAt)), 'step-started');
      need(typeof step?.completedAt === 'string' && !Number.isNaN(Date.parse(step.completedAt)), 'step-completed');
      if (typeof step?.startedAt === 'string' && typeof step?.completedAt === 'string') {
        need(Date.parse(step.completedAt) >= Date.parse(step.startedAt), 'step-time-order');
      }
    }
  }
  need(observed.has('checkout-head'), 'checkout-step');
  need(observed.has('compile-guest'), 'compile-step');

  if (receipt.status === 'PASSED') {
    need(stages.has(receipt.executionStage), 'real-guest-stage');
    need(receipt.guestExecuted === true, 'guest-process-executed');
    need(receipt.guestExitCode === 0, 'guest-exit-zero');
    errors.push(...validateDopPositiveExecutionProfile(receipt));
    need(observed.has('execute-guest'), 'execute-guest-step');
    need(stepOrder.get('checkout-head') < stepOrder.get('compile-guest') &&
         stepOrder.get('compile-guest') < stepOrder.get('execute-guest'), 'guest-step-order');
    if (receipt.backend === 'llvm') {
      // A successful native AOT run must actually execute the checksum-poisoned
      // .atto guest. A host-only assertion or an unobserved negative is not parity.
      need(observed.has('execute-poisoned-guest'), 'llvm-poisoned-guest-step');
      need(stepOrder.get('execute-guest') < stepOrder.get('execute-poisoned-guest'),
        'llvm-poisoned-guest-order');
    }
  } else if (receipt.status === 'UNSUPPORTED') {
    need(observed.has('assert-rejection'), 'negative-diagnostic-step');
    need(stepOrder.get('checkout-head') < stepOrder.get('compile-guest') &&
         stepOrder.get('compile-guest') < stepOrder.get('assert-rejection'), 'rejection-step-order');
    need(typeof receipt.compilerDiagnostic === 'string' && receipt.compilerDiagnostic.trim().length > 0,
      'compiler-owned-diagnostic');
    need(receipt.guestExecuted === false, 'unsupported-executed-guest');
    need(!receipt.guestArtifactSha256, 'unsupported-must-not-emit-artifact');
    need(receipt.guestExitCode == null, 'unsupported-must-not-claim-exit');
    need(receipt.executionStage == null, 'unsupported-must-not-claim-stage');
  } else if (receipt.status === 'FAILED') {
    need(typeof receipt.failureReason === 'string' && receipt.failureReason.trim().length > 0,
      'failure-reason');
    need(job?.conclusion === 'failure', 'failed-job-conclusion');
    need(Array.isArray(job?.steps) && job.steps.some(step => step?.conclusion === 'failure'),
      'observed-failed-step');
  }
  return errors;
}
