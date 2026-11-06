// Read-only evidence auditor. Input is untrusted and never authorizes a merge or release.
const SHA = /^[0-9a-f]{40}$/;
const REPO = /^ores-truffle-oreslang\/[a-z0-9][a-z0-9._-]*$/;
const ignored = new Set(['set up job','complete job','post job cleanup','initialize containers','prepare all required actions','post checkout','checkout']);
const externalReview = login => typeof login === 'string' && !['the1mills','oresoftware'].includes(login.toLowerCase());
const positive = n => Number.isSafeInteger(n) && n > 0;
const stepful = steps => Array.isArray(steps) && steps.some(s => {
  if (s?.conclusion !== 'success' || typeof s.name !== 'string') return false;
  const name = s.name.trim().replace(/\s+/gu,' ').toLowerCase();
  return name && !ignored.has(name) && !name.startsWith('post ') &&
    !/^(run )?actions\/(checkout|setup-|cache|upload-artifact|download-artifact)@/.test(name) &&
    !/^verify exact (pr|source|checkout|head)/.test(name);
});
function runValid(run, entry, check) {
  return run?.scope === 'landed-main' && run?.commit_sha === entry.merge_sha &&
    SHA.test(run.tree_sha ?? '') && run?.context === check.context &&
    run?.app_id === check.app_id && positive(run.run_id) &&
    positive(run.run_attempt) && positive(run.job_id) && positive(run.runner_id) &&
    run.conclusion === 'success' && stepful(run.steps) &&
    Array.isArray(run.tests) && run.tests.length > 0 &&
    run.tests.every(t => t && typeof t.id === 'string' && t.id.length > 0 &&
      t.status === 'PASS' && ['host','compiler-guest','negative'].includes(t.kind));
}
export function auditEntry(entry) {
  const blockers = [];
  const add = (kind, reason) => blockers.push({kind, reason});
  if (!entry || typeof entry !== 'object' || !REPO.test(entry.repo ?? '') ||
    !positive(entry.pr) || !SHA.test(entry.pr_head_sha ?? '') ||
    !SHA.test(entry.merge_sha ?? '') || entry.pr_head_sha === entry.merge_sha ||
    typeof entry.author !== 'string' || !entry.author)
    add('identity','missing_or_invalid_merged_pr_identity');
  const o=entry?.main_observation;
  if (!o || !SHA.test(o.head_sha ?? '') ||
    !['identical','ahead'].includes(o.compare_status) || o.behind_by !== 0 ||
    (o.compare_status === 'identical' && o.head_sha !== entry.merge_sha) ||
    (o.compare_status === 'ahead' && o.head_sha === entry.merge_sha))
    add('ancestry','landed_commit_not_observed_on_main');
  const p=entry?.protection;
  if (p?.protected !== true || p?.required_approvals < 1 ||
    p?.codeowners !== true || p?.dismiss_stale !== true ||
    p?.strict_checks !== true || p?.enforce_admins !== true || p?.bypass_count !== 0)
    add('protection','protected_main_policy_not_verified');
  const approvals=entry?.approvals;
  if (!Array.isArray(approvals) || !approvals.some(a=>a?.state==='APPROVED' &&
    a?.reviewed_commit_sha === entry.merge_sha && externalReview(a.login) &&
    a.login.toLowerCase() !== entry.author?.toLowerCase()))
    add('review','independent_landed_sha_approval_missing');
  const checks=entry?.required_checks, runs=entry?.source_owned_runs;
  if (!Array.isArray(checks) || checks.length===0 ||
    checks.some(c=>!c || typeof c.context!=='string' || !c.context || !positive(c.app_id)) ||
    new Set(checks.map(c=>c.context)).size!==checks.length || !Array.isArray(runs) ||
    checks.some(c=>!runs.some(run=>runValid(run,entry,c))))
    add('ci','required_source_owned_exact_landed_stepful_tests_missing');
  if (entry?.requires_guest === true && (!Array.isArray(runs) || !runs.some(r=>
    Array.isArray(r.tests) && r.tests.some(t=>t.kind==='compiler-guest' && t.status==='PASS') &&
    checks?.some(c=>runValid(r,entry,c)))))
    add('guest','native_compiler_guest_not_verified');
  return blockers;
}
export function auditLedger(ledger) {
  if (!ledger || ledger.schema_version!==1 || ledger.scope!=='snapshot_only' ||
      !Number.isFinite(Date.parse(ledger.captured_at)) ||
      !Array.isArray(ledger.entries) || ledger.entries.length===0 || ledger.entries.length>100)
    throw new TypeError('invalid_or_unbounded_ledger');
  const identities=new Set(), commits=new Set();
  const entries=ledger.entries.map(e=>{
    const blockers=auditEntry(e), identity=`${e?.repo}#${e?.pr}`;
    if (identities.has(identity) || commits.has(`${e?.repo}@${e?.merge_sha}`))
      blockers.push({kind:'identity',reason:'duplicate_pr_or_merge_commit'});
    identities.add(identity);commits.add(`${e?.repo}@${e?.merge_sha}`);
    return {repo:e?.repo,pr:e?.pr,status:blockers.length?'BLOCKED':'SNAPSHOT_READY_RECHECK_LIVE',blockers};
  });
  return {schema_version:1,scope:'advisory_not_release_authority',
    status:entries.every(x=>x.status==='SNAPSHOT_READY_RECHECK_LIVE')?'SNAPSHOT_READY_RECHECK_LIVE':'BLOCKED',
    count:entries.length,blocked:entries.filter(x=>x.status==='BLOCKED').length,
    entries,note:'Source snapshots are untrusted; independently re-fetch live main ancestry, protection, reviews, required checks and exact landed-run job steps before release.'};
}
