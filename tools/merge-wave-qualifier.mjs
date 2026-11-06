// Offline, fail-closed merge-wave planning. A caller-supplied snapshot is NOT a GitHub attestation.
const SHA = /^[a-f0-9]{40}$/;
const GH_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})$/;
const REPO = /^ores-truffle-oreslang\/(?:oreslang-source\.(?:java|llvm|wasm|forge|net)|oreslang-platform\.(?:mobile|iot|embedded|desktop|asic|fpga)|oreslang-platform-conformance)$/;
const REJECTED_REVIEWERS = new Set(['the1mills', 'oresoftware']);
const CORE = ['metadata', 'protection', 'review', 'checks', 'test', 'lease'];
const meaningful = step => {
  if (!step || typeof step.name !== 'string') return false;
  const normalized = step.name.trim().replace(/\s+/gu, ' ').toLowerCase();
  return step.conclusion === 'success' && normalized &&
    !['set up job', 'complete job', 'post job cleanup', 'post checkout', 'checkout', 'initialize containers', 'prepare all required actions'].includes(normalized);
};
function validCheck(check, candidate) {
  if (!check || typeof check !== 'object') return false;
  if (typeof check.context !== 'string' || !check.context.trim() ||
      !Number.isSafeInteger(check.app_id) || check.app_id <= 0) return false;
  if (check.head_sha !== candidate.head_sha || check.tree_sha !== candidate.head_tree_sha) return false;
  if (check.conclusion !== 'success' ||
      !Number.isSafeInteger(check.run_id) || check.run_id <= 0 ||
      !Number.isSafeInteger(check.run_attempt) || check.run_attempt <= 0) return false;
  if (!Array.isArray(check.jobs) || check.jobs.length === 0 || check.jobs.length > 128) return false;
  const seen = new Set();
  let executed = false;
  for (const job of check.jobs) {
    // Each claimed job must belong to the *same* exact-head run and attempt.
    if (!job || !Number.isSafeInteger(job.id) || job.id <= 0 || seen.has(job.id) ||
        job.run_id !== check.run_id || job.run_attempt !== check.run_attempt ||
        job.head_sha !== candidate.head_sha ||
        job.conclusion !== 'success') return false;
    seen.add(job.id);
    if (!Number.isSafeInteger(job.runner_id) || job.runner_id <= 0 ||
        !Array.isArray(job.steps) || !job.steps.length || job.steps.length > 128 ||
        !job.steps.some(meaningful)) return false;
    executed = true;
  }
  return executed;
}
export function qualifyCandidate(candidate, asOf) {
  const blockers = [];
  const bad = (kind, reason) => blockers.push({kind, reason});
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [{kind: 'metadata', reason: 'invalid_candidate'}];
  if (typeof candidate.repo !== 'string' || !REPO.test(candidate.repo) ||
    !Number.isSafeInteger(candidate.number) || candidate.number < 1 ||
    !SHA.test(candidate.head_sha ?? '') || !SHA.test(candidate.head_tree_sha ?? '') ||
    !SHA.test(candidate.base_sha ?? '') || candidate.base_ref !== 'main' || candidate.draft !== false ||
    candidate.mergeable !== true || candidate.state !== 'open' ||
    typeof candidate.author !== 'string' || !GH_LOGIN.test(candidate.author)) {
    bad('metadata', 'invalid_or_stale_pr_metadata');
  }
  const policy = candidate.protection;
  if (policy?.protected !== true || policy?.require_pull_request !== true ||
    policy?.require_codeowners !== true || policy?.dismiss_stale_reviews !== true ||
    policy?.strict_checks !== true || policy?.enforce_admins !== true ||
    policy?.bypass_count !== 0) bad('protection', 'protected_main_policy_not_enforced');
  const reviews = candidate.reviews;
  const authorLogin = typeof candidate.author === 'string' ? candidate.author.toLowerCase() : '';
  // Ambiguous approval followed by a change request or dismissal is never approval evidence.
  const conflicted = new Set(Array.isArray(reviews) ? reviews.filter(r =>
    r && (r.state === 'CHANGES_REQUESTED' || r.state === 'DISMISSED') &&
    r.commit_sha === candidate.head_sha && typeof r.login === 'string')
    .map(r => r.login.toLowerCase()) : []);
  if (!Array.isArray(reviews) || reviews.length > 100 ||
    reviews.some(r => r?.state === 'CHANGES_REQUESTED' && r.commit_sha === candidate.head_sha) ||
    !reviews.some(r => r?.state === 'APPROVED' && r.commit_sha === candidate.head_sha &&
      typeof r.login === 'string' && GH_LOGIN.test(r.login) &&
      r.login.toLowerCase() !== authorLogin &&
      !REJECTED_REVIEWERS.has(r.login.toLowerCase()) &&
      !conflicted.has(r.login.toLowerCase())))
    bad('review', 'independent_exact_head_approval_missing_or_conflicted');
  const required = candidate.required_checks;
  const checks = candidate.checks;
  if (!Array.isArray(required) || required.length === 0 || required.length > 64 ||
    !Array.isArray(checks) || checks.length !== required.length ||
    new Set(required.map(r => r?.context)).size !== required.length ||
    required.some(r => !r || typeof r.context !== 'string' || !r.context.trim() ||
      !Number.isSafeInteger(r.app_id) || r.app_id <= 0 ||
      checks.filter(c => c?.context === r.context).length !== 1 ||
      !validCheck(checks.find(c => c?.context === r.context && c.app_id === r.app_id), candidate))) {
    bad('checks', 'exact_head_runner_backed_checks_not_proven');
  }
  const receipts = candidate.test_receipts;
  const kinds = candidate.scope === 'source_free' ? ['source_free', 'negative'] :
    candidate.scope === 'compiler' ? ['guest', 'negative'] : null;
  if (!kinds || !Array.isArray(receipts) || receipts.length !== kinds.length ||
    new Set(receipts.map(r => r?.kind)).size !== kinds.length ||
    kinds.some(kind => !receipts.some(r =>
      r?.kind === kind && r.head_sha === candidate.head_sha && r.tree_sha === candidate.head_tree_sha &&
      r.conclusion === 'success' && Number.isSafeInteger(r.assertions) && r.assertions > 0 &&
      Number.isSafeInteger(r.run_id) && r.run_id > 0 &&
      Number.isSafeInteger(r.run_attempt) && r.run_attempt > 0 &&
      Number.isSafeInteger(r.job_id) && r.job_id > 0 &&
      checks?.some(c => c?.run_id === r.run_id && c.run_attempt === r.run_attempt &&
        c.jobs?.some(j => j?.id === r.job_id && j.conclusion === 'success') && validCheck(c, candidate))))) {
    bad('test', 'scope_specific_positive_and_negative_receipts_missing');
  }
  if (!Number.isFinite(asOf)) bad('lease', 'invalid_reference_time');
  if (candidate.lease !== null) {
    if (!candidate.lease || typeof candidate.lease !== 'object' ||
      typeof candidate.lease.expires_at !== 'string' ||
      !Number.isFinite(Date.parse(candidate.lease.expires_at)) ||
      Date.parse(candidate.lease.expires_at) > asOf) bad('lease', 'active_or_unknown_agent_lease');
  }
  return blockers;
}
export function qualifyWave(snapshot, {size = 5, minRepos = 3} = {}) {
  if (!Number.isSafeInteger(size) || size < 1 || !Number.isSafeInteger(minRepos) || minRepos < 1 || minRepos > size) throw new RangeError('invalid wave size');
  if (!snapshot || snapshot.schema_version !== 1 || !Array.isArray(snapshot.candidates) ||
    snapshot.candidates.length > 1000 || typeof snapshot.as_of !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(snapshot.as_of) ||
    !Number.isFinite(Date.parse(snapshot.as_of)) ||
    Date.parse(snapshot.as_of) > Date.now() + 5 * 60_000)
    throw new TypeError('invalid, future-dated or unbounded snapshot');
  const asOf = Date.parse(snapshot.as_of);
  const results = [], counts = new Map();
  for (const item of snapshot.candidates) {
    const key = `${typeof item?.repo === 'string' ? item.repo : ''}#${Number.isSafeInteger(item?.number) ? item.number : ''}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const item of snapshot.candidates) {
    const key = `${typeof item?.repo === 'string' ? item.repo : ''}#${Number.isSafeInteger(item?.number) ? item.number : ''}`;
    const blockers = qualifyCandidate(item, asOf);
    if (counts.get(key) > 1) blockers.push({kind:'metadata', reason:'duplicate_candidate'});
    results.push({repo: item?.repo ?? null, number: item?.number ?? null, head_sha: item?.head_sha ?? null, blockers});
  }
  // Deterministic, diversity-first selection; NEVER executes or authorizes a merge.
  const eligible = results.filter(r => !r.blockers.length).sort((a,b) =>
    a.repo.localeCompare(b.repo) || a.number - b.number);
  const chosen = [], picked = new Set(), repoCounts = new Map();
  while (chosen.length < size) {
    const options = eligible.filter(r => !picked.has(`${r.repo}#${r.number}`));
    if (!options.length) break;
    options.sort((a,b) => (repoCounts.get(a.repo) ?? 0) - (repoCounts.get(b.repo) ?? 0) ||
      a.repo.localeCompare(b.repo) || a.number - b.number);
    const next = options[0];
    chosen.push(next);
    picked.add(`${next.repo}#${next.number}`);
    repoCounts.set(next.repo,(repoCounts.get(next.repo)??0)+1);
  }
  const ready = chosen.length === size && repoCounts.size >= minRepos;
  return {status:ready?'SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK':'BLOCKED',
    note:'Advisory offline snapshot only; recheck live GitHub PR head/tree, protected main, approvals, required checks, executed steps, receipts, and leases immediately before each merge. Never auto-merge from this output.',
    selected:ready?chosen:[], eligible_count:eligible.length, distinct_repo_count:repoCounts.size,
    blockers:results.filter(x=>x.blockers.length), required_size:size, min_repos:minRepos};
}
export const blockerKinds = Object.freeze([...CORE]);
