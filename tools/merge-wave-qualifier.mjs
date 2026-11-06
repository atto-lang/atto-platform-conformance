// Offline, fail-closed merge-wave planning. A caller-supplied snapshot is NOT a GitHub attestation.
const SHA = /^[a-f0-9]{40}$/;
const REPO = /^ores-truffle-oreslang\/oreslang-source\.[a-z0-9-]+$/;
const REJECTED_REVIEWERS = new Set(['the1mills', 'oresoftware']);
const CORE = ['metadata', 'protection', 'review', 'checks', 'test', 'lease'];
const meaningful = step => {
  const normalized = step.name?.trim().replace(/\s+/gu, ' ').toLowerCase();
  return step.conclusion === 'success' && normalized &&
    !['set up job', 'complete job', 'post job cleanup', 'post checkout', 'checkout', 'initialize containers', 'prepare all required actions'].includes(normalized);
};
function validCheck(check, candidate) {
  if (!check || typeof check !== 'object') return false;
  if (!check.context || !Number.isInteger(check.app_id) || check.app_id <= 0) return false;
  if (check.head_sha !== candidate.head_sha || check.tree_sha !== candidate.head_tree_sha) return false;
  if (check.conclusion !== 'success' || !Number.isInteger(check.run_id) || check.run_id <= 0 || !Number.isInteger(check.run_attempt) || check.run_attempt <= 0) return false;
  if (!Array.isArray(check.jobs) || check.jobs.length === 0) return false;
  return check.jobs.some(job => Number.isInteger(job.runner_id) && job.runner_id > 0 &&
    job.conclusion === 'success' && Array.isArray(job.steps) && job.steps.some(meaningful));
}
export function qualifyCandidate(candidate, asOf) {
  const blockers = [];
  const bad = (kind, reason) => blockers.push({kind, reason});
  if (!candidate || typeof candidate !== 'object') return [{kind: 'metadata', reason: 'invalid_candidate'}];
  if (!REPO.test(candidate.repo ?? '') || !Number.isSafeInteger(candidate.number) || candidate.number < 1 ||
    !SHA.test(candidate.head_sha ?? '') || !SHA.test(candidate.head_tree_sha ?? '') ||
    !SHA.test(candidate.base_sha ?? '') || candidate.base_ref !== 'main' || candidate.draft !== false ||
    candidate.mergeable !== true || candidate.state !== 'open' || !candidate.author) {
    bad('metadata', 'invalid_or_stale_pr_metadata');
  }
  const policy = candidate.protection;
  if (policy?.protected !== true || policy?.require_pull_request !== true ||
    policy?.require_codeowners !== true || policy?.dismiss_stale_reviews !== true ||
    policy?.strict_checks !== true || policy?.enforce_admins !== true ||
    policy?.bypass_count !== 0) bad('protection', 'protected_main_policy_not_enforced');
  if (!Array.isArray(candidate.reviews) || !candidate.reviews.some(r =>
    r?.state === 'APPROVED' && r.commit_sha === candidate.head_sha &&
    typeof r.login === 'string' && r.login.toLowerCase() !== candidate.author.toLowerCase() &&
    !REJECTED_REVIEWERS.has(r.login.toLowerCase()))) bad('review', 'independent_exact_head_approval_missing');
  const required = candidate.required_checks;
  const checks = candidate.checks;
  if (!Array.isArray(required) || required.length === 0 || !Array.isArray(checks) ||
    new Set(required.map(r => r?.context)).size !== required.length ||
    required.some(r => !r || !r.context || !Number.isInteger(r.app_id) || r.app_id <= 0 ||
      checks.filter(c => c?.context === r.context).length !== 1 ||
      !validCheck(checks.find(c => c?.context === r.context && c.app_id === r.app_id), candidate))) {
    bad('checks', 'exact_head_runner_backed_checks_not_proven');
  }
  const receipts = candidate.test_receipts;
  const kinds = candidate.scope === 'source_free' ? ['source_free', 'negative'] :
    candidate.scope === 'compiler' ? ['guest', 'negative'] : null;
  if (!kinds || !Array.isArray(receipts) || kinds.some(kind => !receipts.some(r =>
    r?.kind === kind && r.head_sha === candidate.head_sha && r.tree_sha === candidate.head_tree_sha &&
    r.conclusion === 'success' && Number.isSafeInteger(r.assertions) && r.assertions > 0 &&
    Number.isInteger(r.run_id) && r.run_id > 0 &&
    checks?.some(c => c.run_id === r.run_id && validCheck(c, candidate))))) {
    bad('test', 'scope_specific_positive_and_negative_receipts_missing');
  }
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
    !Number.isFinite(Date.parse(snapshot.as_of))) throw new TypeError('invalid or unbounded snapshot');
  const asOf = Date.parse(snapshot.as_of);
  const results = [], counts = new Map();
  for (const item of snapshot.candidates) {
    const key = `${item?.repo ?? ''}#${item?.number ?? ''}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const item of snapshot.candidates) {
    const key = `${item?.repo ?? ''}#${item?.number ?? ''}`;
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
