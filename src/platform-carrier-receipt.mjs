/**
 * Source-free, read-only classification of an independently supplied source
 * Git-tree pin and carrier job metadata. This is NOT an export authorization,
 * authenticated runner attestation, or compiler/backend parity proof.
 *
 * All inputs must be JSON data, never arbitrary live Proxy/getter objects.
 * Caller must verify the source pin against the immutable source Git commit
 * and compare executed job logs independently. No APIs, files or network.
 */
const SHA40 = /^[0-9a-f]{40}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9_.:/ -]{0,79}$/;
const KINDS = new Set(['test', 'source_identity_canary', 'governance']);
const CONCLUSIONS = new Set(['success', 'failure', 'skipped', 'cancelled', 'timed_out', 'neutral', 'action_required', null]);
const STATUSES = new Set(['queued', 'in_progress', 'completed']);
const HEADERS = ['repository_id', 'commit_sha', 'tree_sha', 'visibility'];
const RECEIPT_FIELDS = [...HEADERS, 'workflows'];
const JOB_FIELDS = ['name', 'kind', 'status', 'conclusion', 'executed_steps'];

function objectWithExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => keys.includes(key));
}
function validHead(value, keys) {
  return objectWithExactKeys(value, keys) &&
    Number.isSafeInteger(value.repository_id) && value.repository_id > 0 &&
    typeof value.commit_sha === 'string' && SHA40.test(value.commit_sha) &&
    typeof value.tree_sha === 'string' && SHA40.test(value.tree_sha) &&
    ['private','public'].includes(value.visibility);
}
function validate(sourcePin, carrierReceipt) {
  if (!validHead(sourcePin, HEADERS) || !validHead(carrierReceipt, RECEIPT_FIELDS))
    throw new TypeError('invalid exact-head source pin or carrier receipt');
  const runs = carrierReceipt.workflows;
  if (!Array.isArray(runs) || Object.getPrototypeOf(runs) !== Array.prototype ||
      runs.length === 0 || runs.length > 64)
    throw new TypeError('bounded workflow evidence required');
  const names = new Set();
  for (const run of runs) {
    if (!objectWithExactKeys(run, JOB_FIELDS) ||
        typeof run.name !== 'string' || !LABEL.test(run.name) ||
        !KINDS.has(run.kind) || !STATUSES.has(run.status) ||
        !CONCLUSIONS.has(run.conclusion) ||
        (run.status !== 'completed' && run.conclusion !== null) ||
        (run.status === 'completed' && run.conclusion === null) ||
        !Number.isSafeInteger(run.executed_steps) || run.executed_steps < 0 ||
        run.executed_steps > 500)
      throw new TypeError('invalid or unbounded workflow record');
    const folded = run.name.toLowerCase();
    if (names.has(folded)) throw new TypeError('duplicate workflow identity');
    names.add(folded);
  }
}

/**
 * Returns an audit *classification*, never a successful release decision.
 * The `reported_*` fields are just claims in the provided metadata; they
 * must not be promoted to verified CI status without independent logs.
 */
export function inspectCarrierReceipt(sourcePin, carrierReceipt) {
  validate(sourcePin, carrierReceipt);
  const base = {
    authorizes_source_transfer: false,
    authorizes_merge: false,
    certifies_source_free: false,
    authenticated_ci: false,
    proves_guest_backend_parity: false,
  };
  const workflows = carrierReceipt.workflows;
  const tests = workflows.filter(job => job.kind === 'test');
  const identity = workflows.filter(job => job.kind === 'source_identity_canary');
  const relevant = workflows.filter(job => job.kind !== 'source_identity_canary');
  const canaryFailures = identity.filter(job => job.status === 'completed' && job.conclusion !== 'success').length;
  const metadata = {
    ...base,
    reported_workflow_count: workflows.length,
    reported_test_count: tests.length,
    reported_nonportable_canary_failures: canaryFailures,
    reported_all_workflows_successful: workflows.every(job => job.status === 'completed' && job.conclusion === 'success' && job.executed_steps > 0),
    reported_relevant_workflows_successful: relevant.length > 0 && relevant.every(job => job.status === 'completed' && job.conclusion === 'success' && job.executed_steps > 0),
    reported_tests_successful: tests.length > 0 && tests.every(job => job.status === 'completed' && job.conclusion === 'success' && job.executed_steps > 0),
  };
  const result = (classification, reason) => Object.freeze({...metadata, classification, reason});
  if (sourcePin.visibility === 'private' && carrierReceipt.visibility !== 'private')
    return result('PUBLIC_CARRIER_RISK', 'private source metadata points at a public destination; retain incident hold');
  if (sourcePin.tree_sha !== carrierReceipt.tree_sha)
    return result('TREE_MISMATCH', 'reported Git tree identities differ');
  if (sourcePin.repository_id === carrierReceipt.repository_id &&
      sourcePin.commit_sha !== carrierReceipt.commit_sha)
    return result('SOURCE_COMMIT_MISMATCH', 'same repository identity but different source commit');
  if (tests.length === 0)
    return result('NO_EXECUTABLE_TESTS', 'no substantive test workflow is reported');
  if (relevant.some(job => job.status !== 'completed' || job.executed_steps === 0 ||
      ['skipped','cancelled','neutral','action_required'].includes(job.conclusion)))
    return result('INCOMPLETE_EVIDENCE', 'relevant jobs absent, skipped, unexecuted or unfinished');
  if (relevant.some(job => job.conclusion !== 'success'))
    return result('REPORTED_TEST_FAILURE', 'at least one relevant workflow is reported failed');
  if (identity.some(job => job.status !== 'completed' || job.executed_steps === 0))
    return result('INCOMPLETE_IDENTITY_CANARY', 'identity canary did not execute to completion');
  if (canaryFailures)
    return result('REPORTED_TESTS_PASS_WITH_NONPORTABLE_CANARY',
      'source identity canary failure is not a test pass; overall workflow suite is not green');
  return result('REPORTED_TESTS_PASS_SECURITY_HOLD',
    'metadata reports tests passed, but independent log review and source-transfer authorization remain required');
}
