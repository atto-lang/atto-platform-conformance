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
  if (!states.has(receipt.status) || receipt.status === 'NOT_EXECUTED') {
    need(!receipt.guestExecuted, 'not-executed-cannot-claim-guest');
    need(!receipt.guestArtifactSha256, 'not-executed-cannot-claim-artifact');
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
  need(Number.isInteger(receipt.discoveredTests) && receipt.discoveredTests > 0, 'discovered-tests');
  need(Number.isInteger(receipt.executedTests) && receipt.executedTests > 0, 'executed-tests');
  need(Number.isInteger(receipt.executedTests) && receipt.executedTests <= receipt.discoveredTests, 'test-count-bound');

  const job = receipt.ciJob;
  need(Number.isInteger(job?.runId) && job.runId > 0, 'ci-run-id');
  need(Number.isInteger(job?.runnerId) && job.runnerId > 0, 'runner-admission');
  if (receipt.status !== 'FAILED') need(job?.conclusion === 'success', 'ci-job-conclusion');
  need(Array.isArray(job?.steps) && job.steps.length > 0, 'nonzero-steps');
  const observed = new Set();
  const stepNumbers = new Set();
  if (Array.isArray(job?.steps)) {
    for (const step of job.steps) {
      need(typeof step?.id === 'string' && step.id.length > 0, 'step-id');
      need(!observed.has(step?.id), 'duplicate-step');
      observed.add(step?.id);
      need(receipt.status === 'FAILED'
        ? ['success', 'failure'].includes(step?.conclusion)
        : step?.conclusion === 'success', 'step-conclusion');
      need(Number.isInteger(step?.number) && step.number > 0, 'step-number');
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
    need(sha256.test(receipt.guestArtifactSha256 ?? ''), 'guest-artifact-sha256');
    need(observed.has('execute-guest'), 'execute-guest-step');
  } else if (receipt.status === 'UNSUPPORTED') {
    need(observed.has('assert-rejection'), 'negative-diagnostic-step');
    need(typeof receipt.compilerDiagnostic === 'string' && receipt.compilerDiagnostic.trim().length > 0,
      'compiler-owned-diagnostic');
    need(receipt.guestExecuted !== true, 'unsupported-executed-guest');
    need(!receipt.guestArtifactSha256, 'unsupported-must-not-emit-artifact');
  } else if (receipt.status === 'FAILED') {
    need(typeof receipt.failureReason === 'string' && receipt.failureReason.trim().length > 0,
      'failure-reason');
  }
  return errors;
}
