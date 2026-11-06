// Untrusted offline snapshot auditor. This NEVER authorizes a merge, release or private-source transfer.
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const REPO = /^ores-truffle-oreslang\/[a-z0-9][a-z0-9._-]*$/;
const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const CONTEXT = /^[A-Za-z0-9][A-Za-z0-9 _./:-]{0,127}$/;
const DIAGNOSTIC = /^[A-Z][A-Z0-9_]{1,127}$/;
const HEX = /^(?:[0-9a-f]{2})*$/;
const RESERVED_REVIEWERS = new Set(['the1mills', 'oresoftware']);
const IGNORE = new Set(['set up job', 'complete job', 'post job cleanup', 'initialize containers',
  'prepare all required actions', 'post checkout', 'checkout']);
const positive = n => Number.isSafeInteger(n) && n > 0;
const isRecord = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const uniq = a => new Set(a).size === a.length;
const validSha = s => typeof s === 'string' && SHA.test(s);
const validHash = s => typeof s === 'string' && HASH.test(s);
const validHex = s => typeof s === 'string' && s.length <= 131072 && HEX.test(s);
const normalized = s => s.trim().replace(/\s+/gu, ' ').toLowerCase();

function meaningful(steps) {
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > 512) return false;
  // No setup, checkout, metadata integrity or post-job housekeeping counts as execution.
  return steps.some(step => {
    if (!isRecord(step) || step.conclusion !== 'success' || typeof step.name !== 'string') return false;
    const name = normalized(step.name);
    if (!name || IGNORE.has(name) || name.startsWith('post ') ||
      /^(run )?actions\/(checkout|setup-|cache|upload-artifact|download-artifact)@/.test(name) ||
      /^verify exact (pr|source|checkout|head)/.test(name) ||
      /^verify (source|git|checkout) (sha|commit|head|tree)/.test(name)) return false;
    return true;
  });
}
function specValid(t) {
  if (!isRecord(t) || !ID.test(t.id ?? '') || !validSha(t.fixture_sha)) return false;
  if (!['host', 'compiler-guest', 'negative'].includes(t.kind) || !isRecord(t.expect)) return false;
  if (t.kind === 'negative') return DIAGNOSTIC.test(t.expect.diagnostic_category ?? '') &&
    ['frontend','typechecker'].includes(t.expect.phase);
  return Number.isSafeInteger(t.expect.exit_code) && t.expect.exit_code >= 0 &&
    t.expect.exit_code <= 255 && validHex(t.expect.stdout_hex);
}
function testMatches(result, expected) {
  if (!isRecord(result) || result.id !== expected.id || result.kind !== expected.kind ||
    result.fixture_sha !== expected.fixture_sha || result.status !== 'PASS' ||
    !isRecord(result.observed)) return false;
  if (expected.kind === 'negative')
    return result.observed.diagnostic_category === expected.expect.diagnostic_category &&
      result.observed.phase === expected.expect.phase &&
      Number.isSafeInteger(result.observed.exit_code) && result.observed.exit_code !== 0 &&
      result.observed.crashed === false;
  return result.observed.exit_code === expected.expect.exit_code &&
    result.observed.stdout_hex === expected.expect.stdout_hex &&
    result.observed.crashed === false;
}
function runValid(run, entry, check) {
  if (!isRecord(run) || run.scope !== 'landed-main' || run.repo !== entry.repo ||
    run.commit_sha !== entry.merge_sha || run.tree_sha !== entry.landed_tree_sha ||
    run.workflow_sha !== check.workflow_sha || run.context !== check.context ||
    run.app_id !== check.app_id || run.status !== 'completed' ||
    run.conclusion !== 'success' || !validHash(run.artifact_sha256) ||
    !positive(run.run_id) || !positive(run.run_attempt) || !positive(run.job_id) ||
    !positive(run.runner_id) || !meaningful(run.steps) ||
    !Array.isArray(run.tests) || run.tests.length === 0 || run.tests.length > 256 ||
    !uniq(run.tests.map(t => t?.id))) return false;
  const expected = entry.required_tests;
  return run.tests.every(t => {
    const spec = expected.find(x => x.id === t?.id);
    return spec && testMatches(t, spec);
  });
}
function independentReview(a, entry) {
  return isRecord(a) && a.state === 'APPROVED' && a.kind === 'independent_postmerge_attestation' &&
    validHash(a.attestation_sha256) && a.repo === entry.repo &&
    a.reviewed_commit_sha === entry.merge_sha && a.reviewed_tree_sha === entry.landed_tree_sha &&
    typeof a.login === 'string' && a.login.trim() === a.login && a.login.length > 0 &&
    !RESERVED_REVIEWERS.has(a.login.toLowerCase()) && typeof entry.author === 'string' && a.login.toLowerCase() !== entry.author.toLowerCase();
}
export function auditEntry(entry) {
  const blockers = [];
  const add = (kind, reason) => blockers.push({kind, reason});
  if (!isRecord(entry) || !REPO.test(entry.repo ?? '') ||
    !positive(entry.pr) || !validSha(entry.pr_head_sha) ||
    !validSha(entry.merge_sha) || !validSha(entry.landed_tree_sha) ||
    entry.pr_head_sha === entry.merge_sha || entry.merged !== true || entry.base_ref !== 'main' ||
    typeof entry.author !== 'string' || !entry.author.trim() ||
    typeof entry.requires_guest !== 'boolean') {
    add('identity','missing_or_invalid_merged_pr_identity');
  }
  if (!isRecord(entry)) return blockers;
  const o = entry.main_observation;
  if (!isRecord(o) || !validSha(o.head_sha) ||
    !['identical','ahead'].includes(o.compare_status) || o.behind_by !== 0 ||
    (o.compare_status === 'identical' && o.head_sha !== entry.merge_sha) ||
    (o.compare_status === 'ahead' && o.head_sha === entry.merge_sha))
    add('ancestry','landed_commit_not_observed_on_main');
  const p = entry.protection;
  if (!isRecord(p) || p.protected !== true || !positive(p.required_approvals) ||
    p.codeowners !== true || p.dismiss_stale !== true || p.strict_checks !== true ||
    p.enforce_admins !== true || p.bypass_count !== 0 ||
    p.force_pushes_allowed !== false || p.deletions_allowed !== false)
    add('protection','protected_main_policy_not_verified');
  if (!Array.isArray(entry.approvals) || !entry.approvals.some(a => independentReview(a, entry)))
    add('review','independent_landed_sha_approval_missing');

  const expected = entry.required_tests;
  const validSpecs = Array.isArray(expected) && expected.length >= 2 && expected.length <= 128 &&
    expected.every(specValid) && uniq(expected.map(t => t.id)) &&
    expected.some(t => t.kind === 'negative') &&
    expected.some(t => t.kind === (entry.requires_guest === true ? 'compiler-guest' : 'host'));
  if (!validSpecs) add('test','complete_positive_negative_fixture_contract_missing');

  const checks = entry.required_checks;
  const runs = entry.source_owned_runs;
  const validChecks = Array.isArray(checks) && checks.length > 0 && checks.length <= 32 &&
    checks.every(c => isRecord(c) && typeof c.context === 'string' && CONTEXT.test(c.context) &&
      c.context.trim() === c.context &&
      positive(c.app_id) && validSha(c.workflow_sha)) &&
    uniq(checks.map(c => c.context));
  const validRuns = validSpecs && validChecks && Array.isArray(runs) && runs.length > 0 && runs.length <= 128 &&
    uniq(runs.map(r => String(r?.run_id) + ':' + String(r?.run_attempt) + ':' + String(r?.job_id))) &&
    runs.every(r => checks.some(c => runValid(r, entry, c)));
  if (!validRuns || checks.some(c => !runs.some(r => runValid(r, entry, c))))
    add('ci','required_source_owned_exact_landed_stepful_tests_missing');
  if (validSpecs && validRuns) {
    const passed = new Set(runs.filter(r => checks.some(c => runValid(r, entry, c)))
      .flatMap(r => r.tests.map(t => t.id)));
    if (expected.some(t => !passed.has(t.id))) add('test','required_positive_or_negative_case_not_executed');
  }
  if (entry.requires_guest === true && (!validSpecs || !validRuns ||
    !runs.some(r => checks.some(c => runValid(r, entry, c)) &&
      r.tests.some(t => t.kind === 'compiler-guest'))))
    add('guest','native_compiler_guest_not_verified');
  return blockers;
}
export function auditLedger(ledger) {
  if (!isRecord(ledger) || ledger.schema_version !== 1 || ledger.scope !== 'snapshot_only' ||
    typeof ledger.captured_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(ledger.captured_at) ||
    !Number.isFinite(Date.parse(ledger.captured_at)) ||
    !Array.isArray(ledger.entries) || ledger.entries.length === 0 || ledger.entries.length > 100)
    throw new TypeError('invalid_or_unbounded_ledger');
  const identities = new Set(), commits = new Set();
  const entries = ledger.entries.map(e => {
    const blockers = auditEntry(e);
    const identity = String(e?.repo) + '#' + String(e?.pr);
    const commitIdentity = String(e?.repo) + '@' + String(e?.merge_sha);
    if (identities.has(identity) || commits.has(commitIdentity))
      blockers.push({kind:'identity',reason:'duplicate_pr_or_merge_commit'});
    identities.add(identity);
    commits.add(commitIdentity);
    return {repo:e?.repo,pr:e?.pr,status:blockers.length ? 'BLOCKED' : 'SNAPSHOT_READY_RECHECK_LIVE',blockers};
  });
  return {schema_version:1,scope:'advisory_not_release_authority',
    status:entries.every(e => e.status === 'SNAPSHOT_READY_RECHECK_LIVE') ?
      'SNAPSHOT_READY_RECHECK_LIVE' : 'BLOCKED',
    count:entries.length,blocked:entries.filter(e => e.status === 'BLOCKED').length,
    entries,note:'Untrusted offline snapshots never authorize releases. Independently re-fetch live PR merge, main ancestry, source tree, reviewer attestation, protection, issuer-bound checks and execution logs.'};
}
