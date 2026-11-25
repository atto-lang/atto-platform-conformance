// Shape validation only; independently fetched GitHub run/job/artifact evidence
// is mandatory before marking a backend PASSED. NOT a source execution proof.
const sha1 = /^[0-9a-f]{40}$/;
const sha256 = /^[0-9a-f]{64}$/;
const backends = new Set(['java', 'llvm', 'net', 'wasm', 'forge']);
const ids = new Set(['swap-reuse', 'removed-index-trap', 'immutable-column-swap']);
const statuses = new Set(['NOT_EXECUTED', 'PASSED', 'FAILED', 'UNSUPPORTED']);
const negativeId = 'removed-index-trap';
const stepsRequired = ['checkout-head', 'verify-fixture', 'compile-guest', 'execute-guest'];

export function validateInvertedGuestReceipt(receipt, manifest) {
  const errors = [];
  const need = (ok, reason) => { if (!ok) errors.push(reason); };
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return ['receipt-object'];
  need(manifest?.contract === 'atto-dop-inverted-two-i64-guest-v1', 'contract-version');
  need(receipt.contract === manifest?.contract, 'receipt-version');
  need(backends.has(receipt.backend), 'backend');
  need(ids.has(receipt.caseId), 'case-id');
  need(statuses.has(receipt.status), 'status');
  const vector = manifest?.vectors?.find(x => x.id === receipt.caseId);
  need(Boolean(vector), 'manifest-vector');
  if (receipt.status === 'NOT_EXECUTED') {
    need(receipt.guestExecuted !== true, 'not-executed-guest');
    need(receipt.guestResult == null, 'not-executed-result');
    need(receipt.guestArtifactSha256 == null, 'not-executed-artifact');
    need(receipt.ciJob == null, 'not-executed-job');
    return errors;
  }
  need(sha1.test(receipt.sourceHeadSha ?? ''), 'source-head');
  need(receipt.checkoutHeadSha === receipt.sourceHeadSha, 'exact-head');
  need(sha1.test(receipt.sourceTreeSha ?? ''), 'source-tree');
  need(receipt.fixtureGitBlobSha === vector?.blobSha1, 'canonical-fixture-blob');
  need(sha256.test(receipt.fixtureSha256 ?? ''), 'fixture-content-sha256');
  need(sha256.test(receipt.compilerSha256 ?? ''), 'compiler-sha256');
  need(typeof receipt.toolchain === 'string' && receipt.toolchain.trim().length > 0, 'toolchain');
  need(typeof receipt.command === 'string' && receipt.command.trim().length > 0, 'command');
  need(Number.isSafeInteger(receipt.executedTests) && receipt.executedTests > 0, 'executed-tests');
  need(Number.isSafeInteger(receipt.discoveredTests) && receipt.discoveredTests >= receipt.executedTests, 'discovered-tests');
  const job = receipt.ciJob;
  need(Number.isSafeInteger(job?.runId) && job.runId > 0, 'run-id');
  need(Number.isSafeInteger(job?.jobId) && job.jobId > 0, 'job-id');
  need(Number.isSafeInteger(job?.attempt) && job.attempt > 0, 'run-attempt');
  need(Number.isSafeInteger(job?.runnerId) && job.runnerId > 0, 'runner-admission');
  need(Array.isArray(job?.steps) && job.steps.length >= stepsRequired.length && job.steps.length <= 1000,
    'nonzero-executed-steps');
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const seen = new Set(), nums = new Set();
  for (const step of steps) {
    need(typeof step?.name === 'string' && step.name.length > 0 && !seen.has(step.name), 'unique-step-name');
    seen.add(step?.name);
    need(Number.isSafeInteger(step?.number) && step.number > 0 && !nums.has(step.number), 'unique-step-number');
    nums.add(step?.number);
    need(['success', 'failure'].includes(step?.conclusion), 'step-conclusion');
    need(typeof step?.startedAt === 'string' && !Number.isNaN(Date.parse(step.startedAt)), 'step-started');
    need(typeof step?.completedAt === 'string' && !Number.isNaN(Date.parse(step.completedAt)), 'step-completed');
    need(Date.parse(step?.completedAt) >= Date.parse(step?.startedAt), 'step-time-order');
  }
  if (receipt.status === 'PASSED') {
    need(job?.conclusion === 'success', 'successful-job');
    need(steps.every(step => step?.conclusion === 'success'), 'successful-steps');
    const order = stepsRequired.map(id => steps.find(x => x?.name === id)?.number);
    need(order.every(x => Number.isSafeInteger(x)) && order.every((x,i) => i === 0 || x > order[i-1]),
      'ordered-source-compile-execute-steps');
    need(receipt.guestExecuted === true, 'guest-process-executed');
    need(receipt.backend === 'java' || receipt.backend === 'llvm', 'unimplemented-backend-positive');
    if (receipt.backend === 'java') {
      need(receipt.executionProfile === 'restricted-interpreter', 'java-profile');
      need(receipt.executionStage === 'managed-guest', 'java-stage');
      need(receipt.guestArtifactSha256 == null, 'java-must-not-claim-native-image');
      need(sha256.test(receipt.runtimeClassTreeSha256 ?? ''), 'java-runtime-classes');
    } else if (receipt.backend === 'llvm') {
      need(receipt.executionProfile === 'aot', 'llvm-profile');
      need(receipt.executionStage === 'native-guest', 'llvm-stage');
      need(sha256.test(receipt.guestArtifactSha256 ?? ''), 'llvm-native-artifact');
      need(receipt.runtimeClassTreeSha256 == null, 'llvm-no-java-classes');
    }
    if (receipt.caseId !== negativeId) {
      need(receipt.guestResult?.kind === 'return' && receipt.guestResult?.value === 42,
        'positive-exit-42');
      need(receipt.guestResult?.signal == null && receipt.guestResult?.trap == null, 'positive-no-trap');
    } else if (receipt.caseId === negativeId) {
      const expected = receipt.backend === 'java'
        ? receipt.guestResult?.kind === 'language-trap' && receipt.guestResult?.trap === 'DOP_INVERTED_BOUNDS_TRAP'
        : receipt.guestResult?.kind === 'native-signal' &&
          ['SIGILL','SIGTRAP'].includes(receipt.guestResult?.signal);
      need(expected, 'real-checked-bounds-failure');
      need(receipt.guestResult?.value == null, 'negative-no-return-value');
    }
  } else if (receipt.status === 'FAILED') {
    need(job?.conclusion === 'failure', 'failure-job');
    need(steps.some(s => s?.conclusion === 'failure'), 'observed-failure-step');
    need(typeof receipt.failureReason === 'string' && receipt.failureReason.length > 0, 'failure-reason');
  } else if (receipt.status === 'UNSUPPORTED') {
    need(receipt.guestExecuted === false, 'unsupported-not-executed');
    need(receipt.guestArtifactSha256 == null, 'unsupported-no-artifact');
    need(receipt.guestResult == null, 'unsupported-no-result');
    need(seen.has('assert-rejection'), 'compiler-rejection-step');
    need(typeof receipt.compilerDiagnostic === 'string' && receipt.compilerDiagnostic.length > 0,
      'compiler-diagnostic');
  }
  return errors;
}
