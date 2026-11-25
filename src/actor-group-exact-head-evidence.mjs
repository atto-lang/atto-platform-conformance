/**
 * ActorGroup source-guest evidence structural preflight, v1.
 * Pure/read-only. Receipts supplied to this function are NOT independently
 * authenticated GitHub CI evidence; passing never certifies a backend.
 */
export const REQUIRED_CASES = Object.freeze([
  'AG001_multi_group_join',
  'AG002_leave_a_preserves_b',
  'AG003_membership_not_lifecycle_owner',
  'AG004_rotated_permit_rejected_even_for_member',
  'AG005_foreign_runtime_or_isolate_denied',
  'AG006_stale_actor_generation_denied',
  'AG007_close_join_and_stop_race',
  'AG008_duplicate_join_no_quota_charge',
  'AG009_opaque_capability_mailbox_rejected',
  'AG010_join_self_and_manager_authorization',
  'AG011_group_close_does_not_stop_member',
  'AG012_forged_scalar_identity_denied'
]);

const BACKENDS = Object.freeze({
  java: 'ores-truffle-oreslang/oreslang-source.java',
  llvm: 'ores-truffle-oreslang/oreslang-source.llvm',
  wasm: 'ores-truffle-oreslang/oreslang-source.wasm',
  forge: 'ores-truffle-oreslang/oreslang-source.forge',
  net: 'ores-truffle-oreslang/oreslang-source.net'
});
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const posInt = n => Number.isSafeInteger(n) && n > 0;
const dateMillis = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(value) ? Date.parse(value) : NaN;
const result = (status, reason) => Object.freeze({status, reason, certified:false});

/**
 * @param {object} input
 * @param {'java'|'llvm'|'wasm'|'forge'|'net'} input.backend
 * @param {string} input.expected_head_sha Must be obtained outside receipt from the PR's actual head.
 * @param {object|null} input.receipt Caller-supplied snapshot of GitHub metadata and tests.
 * @param {string} [input.now] ISO 8601 time, supplied by caller (no clock needed).
 * @returns {{status:string,reason:string,certified:false}}
 */
export function assessActorGroupEvidence({backend, expected_head_sha, receipt, now} = {}) {
  if (!Object.hasOwn(BACKENDS, backend)) return result('INVALID', 'UNKNOWN_BACKEND');
  if (!SHA.test(expected_head_sha ?? '')) return result('INVALID', 'EXPECTED_HEAD_INVALID');
  if (receipt == null) return result('MISSING', 'NO_RECEIPT');
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return result('INVALID', 'RECEIPT_INVALID');
  if (receipt.repository !== BACKENDS[backend] || receipt.backend !== backend)
    return result('NOT_CERTIFIED', 'WRONG_REPOSITORY_OR_BACKEND');
  if (receipt.head_sha !== expected_head_sha) return result('NOT_CERTIFIED', 'STALE_OR_WRONG_HEAD');

  switch (receipt.execution_kind) {
    case 'host_only': return result('HOST_ONLY', 'NO_SOURCE_GUEST_EXECUTION');
    case 'parser_only': return result('PARSER_ONLY', 'NO_SOURCE_GUEST_EXECUTION');
    case 'negative_no_ir': return result('FAIL_CLOSED_ONLY', 'NEGATIVE_ADMISSION_IS_NOT_POSITIVE_EXECUTION');
    case 'compiled_guest': break;
    default: return result('NOT_CERTIFIED', 'UNKNOWN_EXECUTION_KIND');
  }

  const run = receipt.run;
  const job = receipt.job;
  if (!run || !job || !posInt(run.id) || !posInt(job.id) || job.run_id !== run.id ||
      run.head_sha !== expected_head_sha || job.head_sha !== expected_head_sha ||
      run.repository !== receipt.repository || run.event !== 'pull_request')
    return result('NOT_CERTIFIED', 'UNBOUND_RUN_OR_JOB');
  // GitHub can report a failed run/job without ever admitting a runner.
  // No recorded steps takes precedence over the failure conclusion.
  if (!Array.isArray(job.steps) || job.steps.length === 0)
    return result('NOT_EXECUTED', 'ZERO_RECORDED_STEPS');
  if (run.conclusion === 'failure' || job.conclusion === 'failure') return result('FAILED', 'RUN_OR_JOB_FAILED');
  if (run.conclusion !== 'success' || job.conclusion !== 'success')
    return result('NOT_CERTIFIED', 'RUN_OR_JOB_NOT_SUCCESSFUL');
  if (job.steps.some(s => s?.conclusion === 'failure')) return result('FAILED', 'STEP_FAILED');
  if (job.steps.some(s => s?.conclusion !== 'success' || !s.started_at || !s.completed_at ||
    !Number.isFinite(dateMillis(s.started_at)) || !Number.isFinite(dateMillis(s.completed_at)) ||
    dateMillis(s.started_at) > dateMillis(s.completed_at)))
    return result('NOT_CERTIFIED', 'INCOMPLETE_STEP_RECEIPT');
  const phases = new Set(job.steps.map(s => s.phase));
  for (const phase of ['compile_guest', 'execute_guest', 'assert_contract']) {
    if (!phases.has(phase)) return result('NOT_CERTIFIED', `MISSING_${phase.toUpperCase()}`);
  }
  const assertions = receipt.assertions;
  if (!Array.isArray(assertions) || new Set(assertions).size !== assertions.length ||
      REQUIRED_CASES.some(x => !assertions.includes(x)))
    return result('NOT_CERTIFIED', 'MISSING_OR_DUPLICATE_CONTRACT_ASSERTIONS');
  if (!SHA.test(receipt.source_tree_sha ?? '') || !SHA256.test(receipt.artifact_sha256 ?? ''))
    return result('NOT_CERTIFIED', 'MISSING_PROVENANCE_DIGESTS');
  const recorded = dateMillis(run.completed_at);
  const current = dateMillis(now);
  if (!Number.isFinite(recorded) || !Number.isFinite(current) ||
      recorded > current || current - recorded > 48 * 60 * 60 * 1000)
    return result('NOT_CERTIFIED', 'STALE_OR_UNDATED_RUN');

  // GitHub metadata and artifact contents must still be independently fetched,
  // cross-checked against the PR's real head and read/verified on an allowed runner.
  return result('EVIDENCE_CANDIDATE', 'REQUIRES_INDEPENDENT_PROVENANCE_AND_LOG_VERIFICATION');
}
