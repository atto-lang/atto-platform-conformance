// Shape validation only; independently fetched GitHub run/job/artifact evidence
// is mandatory before marking a backend PASSED. NOT a source execution proof.
const sha1 = /^[0-9a-f]{40}$/;
const sha256 = /^[0-9a-f]{64}$/;
const backends = new Set(['java', 'llvm', 'net', 'wasm', 'forge']);
const ids = new Set(['swap-reuse', 'removed-index-trap', 'immutable-column-swap']);
const statuses = new Set(['NOT_EXECUTED', 'PASSED', 'FAILED', 'UNSUPPORTED']);
const negativeId = 'removed-index-trap';
const stepsRequired = ['checkout-head', 'verify-fixture', 'compile-guest', 'execute-guest'];

const javaGuestCases = new Set([
  'productionLexerAndRestrictedMirRunCanonicalSwapReuse',
  'immutableColumnRemainsAttachedToSurvivorAfterSwapDelete',
  'canonicalFormerDenseIndexTrapsAfterSwapErase',
  'checkedMutableFieldStoreAndImmutableColumnRejection',
  'capacityAndLogicalLengthAreDistinctCheckedProperties',
  'strictAdmissionRejectsEffectsAndHiddenUserCode',
  'normalGuestCompilerMustRemainFailClosed'
]);
const javaTestClass = 'dev.oreslang.compiler.DopInvertedGuestI64V1Test';


// Manifest input is untrusted: a caller may not redefine the three canonical
// Git blob identities by submitting a self-consistent fake manifest+receipt.
const canonicalBlobs = Object.freeze({
  'swap-reuse': '8f5599a9e0b11ded2929110b4936441fceb2ef21',
  'removed-index-trap': 'c3c87cfd2515707932734e183bb5768436526a96',
  'immutable-column-swap': '863b1f20137656a277fc7bc04415a6f001f76512'
});

// Date.parse silently normalizes 2026-02-30 to March 2. Check RFC3339
// calendar validity, leap days, and timezone offsets before timestamp order.
function strictTimestamp(value) {
  if (typeof value !== 'string') return null;
  const m = /^([1-9][0-9]{3})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])(?:\.([0-9]{1,9}))?(Z|[+-](?:0[0-9]|1[0-9]|2[0-3]):[0-5][0-9])$/.exec(value);
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > days[month - 1]) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}


export function validateInvertedGuestReceipt(receipt, manifest) {
  const errors = [];
  const need = (ok, reason) => { if (!ok) errors.push(reason); };
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return ['receipt-object'];
  need(manifest?.contract === 'atto-dop-inverted-two-i64-guest-v1', 'contract-version');
  need(receipt.contract === manifest?.contract, 'receipt-version');
  need(backends.has(receipt.backend), 'backend');
  need(ids.has(receipt.caseId), 'case-id');
  need(statuses.has(receipt.status), 'status');
  // Exactly three canonical vectors, each once, are part of contract v1.
  // Avoid .find() on arbitrary manifest.vectors: malformed JSON must reject,
  // not throw or silently substitute a different blob.
  const vectors = Array.isArray(manifest?.vectors) ? manifest.vectors : [];
  const seenVectors = new Set();
  need(vectors.length === ids.size, 'manifest-vector-inventory');
  for (const entry of vectors) {
    need(entry !== null && typeof entry === 'object' && !Array.isArray(entry),
      'manifest-vector-object');
    const id = entry?.id;
    need(typeof id === 'string' && Object.hasOwn(canonicalBlobs, id),
      'manifest-vector-id');
    need(!seenVectors.has(id), 'manifest-vector-duplicate');
    seenVectors.add(id);
    need(entry?.blobSha1 === canonicalBlobs[id], 'manifest-canonical-source-blob');
  }
  const vector = vectors.find(x => x?.id === receipt.caseId);
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
    const started = strictTimestamp(step?.startedAt);
    const completed = strictTimestamp(step?.completedAt);
    need(started !== null, 'step-started');
    need(completed !== null, 'step-completed');
    need(started !== null && completed !== null && completed >= started,
      'step-time-order');
  }
  // A job cannot execute overlapping numbered steps in the same runner.
  // Reordering a forged receipt array or claiming concurrent checkout/compile
  // steps is not permitted even if the step names are all present.
  const orderedSteps = [...steps].sort((a, b) => (a?.number ?? 0) - (b?.number ?? 0));
  for (let i = 1; i < orderedSteps.length; i++) {
    const preceding = strictTimestamp(orderedSteps[i - 1]?.completedAt);
    const following = strictTimestamp(orderedSteps[i]?.startedAt);
    need(preceding !== null && following !== null && following >= preceding,
      'sequential-job-step-times');
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
      need(sha256.test(receipt.junitReportSha256 ?? ''), 'java-junit-report-sha256');
      need(receipt.junitReportClass === javaTestClass, 'java-junit-report-class');
      need(Number.isSafeInteger(receipt.executedTests) &&
        receipt.executedTests >= javaGuestCases.size, 'java-seven-guest-tests');
      need(Array.isArray(receipt.javaGuestCases) &&
        receipt.javaGuestCases.length === javaGuestCases.size &&
        new Set(receipt.javaGuestCases).size === javaGuestCases.size &&
        receipt.javaGuestCases.every(testName => javaGuestCases.has(testName)),
        'java-guest-case-inventory');
      const postSource = steps.find(step => step?.name === 'verify-post-execution-source');
      const execute = steps.find(step => step?.name === 'execute-guest');
      need(Boolean(postSource) && postSource?.conclusion === 'success' &&
        Number.isSafeInteger(postSource?.number) &&
        Number.isSafeInteger(execute?.number) && postSource.number > execute.number,
        'java-post-execution-source-verification');
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
