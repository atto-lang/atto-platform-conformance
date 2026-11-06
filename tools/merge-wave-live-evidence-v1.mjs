// Source-free, READ-ONLY GitHub evidence inventory. NEVER authorizes a merge or private-source export.
const OWNER = 'ores-truffle-oreslang';
const REPO_RE = /^ores-truffle-oreslang\/(?:oreslang-source\.(?:java|llvm|wasm|net|forge|cranelift|js|rs|hdl)|oreslang-platform\.(?:mobile|iot|embedded|desktop|fpga|asic)|oreslang-platform-conformance)$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const MAX_PAGES = 10, PER_PAGE = 100, MAX_RUNS = 12, MAX_JOBS_PER_RUN = 128;
const safeId = n => Number.isSafeInteger(n) && n > 0;
const sha = s => typeof s === 'string' && SHA_RE.test(s);
const housekeeping = name => {
  if (typeof name !== 'string') return true;
  const n = name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
  return !n || ['set up job', 'complete job', 'initialize containers', 'start containers',
    'stop containers', 'post job cleanup', 'checkout', 'post checkout'].includes(n) ||
    /^(?:pre|post)\s/u.test(n);
};
export function classifyJob(job, run, head) {
  if (!job || !run || !safeId(job.id) || !safeId(run.id) ||
    !safeId(run.run_attempt) || job.run_id !== run.id || job.run_attempt !== run.run_attempt ||
    job.head_sha !== head || run.head_sha !== head) return 'UNBOUND';
  if (!Array.isArray(job.steps)) return 'STEPS_UNOBSERVED';
  if (job.steps.length > 128) return 'STEPS_UNBOUNDED';
  const numbers = new Set();
  for (const step of job.steps) {
    if (!safeId(step?.number) || numbers.has(step.number) || typeof step.name !== 'string' ||
        step.name.length > 250 || !['completed','in_progress','queued','pending'].includes(step.status)) return 'STEPS_MALFORMED';
    numbers.add(step.number);
  }
  const runner = safeId(job.runner_id);
  if (job.steps.length === 0 && !runner && job.status === 'completed' &&
    job.conclusion !== 'success') return 'NOT_EXECUTED';
  if (!runner || !job.steps.length) return 'NO_PROVEN_RUNNER';
  const meaningful = job.steps.some(s => !housekeeping(s.name) && s.status === 'completed');
  if (!meaningful) return 'NO_MEANINGFUL_STEP';
  if (run.status === 'completed' && run.conclusion === 'success' &&
    job.status === 'completed' && job.conclusion === 'success' &&
    job.steps.every(s => s.status === 'completed' && s.conclusion === 'success')) return 'RUNNER_EXECUTED_SUCCESS';
  return 'RUNNER_EXECUTED_NON_SUCCESS';
}

export async function readPages(get, prefix, field = null, {cap = MAX_PAGES} = {}) {
  if (typeof get !== 'function' || typeof prefix !== 'string' || !prefix.startsWith('/repos/') ||
      !Number.isInteger(cap) || cap < 1 || cap > MAX_PAGES) throw Error('invalid read-only pagination contract');
  const items = [], gaps = []; let total = null, finished = false;
  const ids = new Set();
  for (let page = 1; page <= cap; page++) {
    let data;
    try { data = await get(`${prefix}${prefix.includes('?')?'&':'?'}per_page=${PER_PAGE}&page=${page}`); }
    catch (err) { gaps.push(`PAGE_FETCH_FAILED:${page}:${err?.status ?? 'unknown'}`); break; }
    const arr = field ? data?.[field] : data;
    if (!Array.isArray(arr) || arr.length > PER_PAGE) { gaps.push(`PAGE_SHAPE_INVALID:${page}`); break; }
    if (field && (!Number.isSafeInteger(data.total_count) || data.total_count < 0)) {
      gaps.push(`PAGE_COUNT_UNVERIFIED:${page}`); break;
    }
    if (field) {
      if (total === null) total = data.total_count;
      else if (total !== data.total_count) gaps.push(`PAGE_TOTAL_CHANGED:${page}`);
    }
    for (const entry of arr) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !safeId(entry.id) || ids.has(entry.id)) {
        gaps.push(`PAGE_IDENTITY_OR_DUPLICATE:${page}`); continue;
      }
      ids.add(entry.id); items.push(entry);
    }
    if (arr.length < PER_PAGE) { finished = true; break; }
  }
  if (!finished) gaps.push('PAGINATION_UNBOUNDED_OR_UNOBSERVED');
  if (total !== null && items.length !== total) gaps.push(`PAGINATION_COUNT_MISMATCH:${items.length}:${total}`);
  return {items, complete: gaps.length === 0, gaps};
}

export async function collectLiveEvidence({repo, number, get, now = () => new Date().toISOString()} = {}) {
  if (typeof repo !== 'string' || !REPO_RE.test(repo) || !safeId(number) || number > 1_000_000 ||
      typeof get !== 'function' || typeof now !== 'function') throw TypeError('invalid read-only target');
  const start = now(), base = `/repos/${repo}`, gapSet = new Set();
  const mark = s => gapSet.add(s);
  const safeRead = async (path, code) => {
    try { return await get(path); }
    catch (e) { mark(`${code}:${e?.status || 'UNKNOWN'}`); return null; }
  };
  const initial = await safeRead(`${base}/pulls/${number}`, 'PR_UNOBSERVED');
  if (!initial) return {schema:1, target:{repo,number}, as_of:start, status:'BLOCKED', gaps:[...gapSet], merge_authorized:false, guest_certified:false};
  const head = initial.head?.sha, baseSha = initial.base?.sha, repoId = initial.base?.repo?.id;
  if (!sha(head) || !sha(baseSha) || !safeId(repoId) || !safeId(initial.user?.id) || initial.base?.ref !== 'main' ||
    initial.base?.repo?.full_name !== repo || initial.head?.repo?.full_name !== repo) mark('PR_REPOSITORY_OR_HEAD_UNVERIFIED');
  if (initial.state !== 'open' || initial.draft !== false || initial.mergeable !== true) mark('PR_NOT_READY');
  const headValid = sha(head);
  const branch = await safeRead(`${base}/branches/main`, 'BRANCH_UNOBSERVED');
  if (!branch || branch.protected !== true) mark('MAIN_NOT_PROTECTED');
  if (branch && branch.commit?.sha !== baseSha) mark('BASE_SHA_DRIFT');
  const protection = await safeRead(`${base}/branches/main/protection`, 'PROTECTION_UNREADABLE');
  const prRule = protection?.required_pull_request_reviews;
  const statusRule = protection?.required_status_checks;
  const appChecks = statusRule?.checks;
  if (!prRule || prRule.require_code_owner_reviews !== true || prRule.dismiss_stale_reviews !== true ||
      !safeId(prRule.required_approving_review_count) || statusRule?.strict !== true ||
      !Array.isArray(appChecks) || !appChecks.length ||
      appChecks.some(c => typeof c.context !== 'string' || !c.context || !safeId(c.app_id)) ||
      protection?.enforce_admins?.enabled !== true) mark('PROTECTION_POLICY_NOT_PROVEN');
  if (!prRule?.bypass_pull_request_allowances ||
      ['users','teams','apps'].some(k => !Array.isArray(prRule.bypass_pull_request_allowances[k]) ||
        prRule.bypass_pull_request_allowances[k].length)) mark('REVIEW_BYPASS_NOT_PROVEN_EMPTY');
  const commit = headValid ? await safeRead(`${base}/git/commits/${head}`, 'COMMIT_UNOBSERVED') : null;
  const tree = commit?.tree?.sha;
  if (!headValid || commit?.sha !== head || !sha(tree)) mark('HEAD_TREE_UNVERIFIED');
  const reviews = await readPages(get, `${base}/pulls/${number}/reviews`);
  if (!reviews.complete) reviews.gaps.forEach(x => mark(`REVIEWS_${x}`));
  const reviewSummary = reviews.items.map(r => ({id:r.id,user_id:r.user?.id,login:r.user?.login,
    state:r.state,commit_sha:r.commit_id,submitted_at:r.submitted_at}));
  const latest = new Map();
  for (const r of reviewSummary) {
    if (!safeId(r.user_id) || !safeId(r.id) || typeof r.login !== 'string' ||
        !Number.isFinite(Date.parse(r.submitted_at))) { mark('REVIEW_IDENTITY_UNVERIFIED'); continue; }
    const old = latest.get(r.user_id);
    if (!old || Date.parse(r.submitted_at) > Date.parse(old.submitted_at)) latest.set(r.user_id,r);
    else if (Date.parse(r.submitted_at) === Date.parse(old.submitted_at) && r.id !== old.id) mark('REVIEW_EVENT_ORDER_AMBIGUOUS');
  }
  const approvals = [...latest.values()].filter(r => r.state === 'APPROVED' && r.commit_sha === head &&
    r.user_id !== initial.user?.id && ![2148448,11139560].includes(r.user_id) &&
    !['the1mills','oresoftware'].includes(r.login.toLowerCase()));
  if (!approvals.length || approvals.length < (prRule?.required_approving_review_count || 1) ||
      [...latest.values()].some(r => r.state === 'CHANGES_REQUESTED')) mark('INDEPENDENT_REVIEW_NOT_PROVEN');
  // A syntactically valid approval is NOT a CODEOWNERS or independence attestation.
  mark('REVIEWER_AUTHORITY_REQUIRES_INDEPENDENT_VERIFICATION');
  let checks = {items:[],complete:false,gaps:['NO_VALID_HEAD']}, runs = {...checks};
  if (headValid) {
    checks = await readPages(get, `${base}/commits/${head}/check-runs`, 'check_runs');
    runs = await readPages(get, `${base}/actions/runs?head_sha=${head}`, 'workflow_runs');
    for (const x of checks.gaps) mark(`CHECKS_${x}`);
    for (const x of runs.gaps) mark(`RUNS_${x}`);
  }
  const checked = checks.items.map(c => ({id:c.id,name:c.name,app_id:c.app?.id,head_sha:c.head_sha,
    status:c.status,conclusion:c.conclusion}));
  for (const check of appChecks || []) {
    const matches = checked.filter(c => c.name === check.context);
    if (matches.length !== 1) mark(`REQUIRED_CHECK_AMBIGUOUS:${check.context}`);
    if (!matches.some(c => c.app_id === check.app_id && c.head_sha === head &&
      c.status === 'completed' && c.conclusion === 'success')) mark(`REQUIRED_CHECK_NOT_PROVEN:${check.context}`);
  }
  if (!runs.items.length) mark('NO_WORKFLOW_RUNS');
  if (runs.items.length > MAX_RUNS) mark('RUN_SCAN_CAPPED');
  const executions = [];
  for (const r of runs.items.slice(0, MAX_RUNS)) {
    if (!safeId(r.id) || !safeId(r.run_attempt) || r.head_sha !== head ||
        r.repository?.id !== repoId || r.head_repository?.id !== repoId || r.event !== 'pull_request') {
      mark(`RUN_IDENTITY_MISMATCH:${r.id}`); continue;
    }
    const jobs = await readPages(get, `${base}/actions/runs/${r.id}/attempts/${r.run_attempt}/jobs`, 'jobs');
    if (!jobs.complete) jobs.gaps.forEach(x => mark(`JOBS_${r.id}_${x}`));
    if (!jobs.items.length || jobs.items.length > MAX_JOBS_PER_RUN) mark(`JOBS_ABSENT_OR_CAPPED:${r.id}`);
    for (const summary of jobs.items.slice(0, MAX_JOBS_PER_RUN)) {
      const job = await safeRead(`${base}/actions/jobs/${summary.id}`, `JOB_UNOBSERVED:${r.id}:${summary.id}`);
      if (!job) continue;
      if (job.id !== summary.id || job.run_id !== summary.run_id ||
          job.run_attempt !== summary.run_attempt || job.head_sha !== summary.head_sha ||
          job.status !== summary.status || job.conclusion !== summary.conclusion ||
          job.runner_id !== summary.runner_id) mark(`JOB_READBACK_MISMATCH:${job.id}`);
      const state = classifyJob(job,r,head);
      executions.push({run_id:r.id,attempt:r.run_attempt,job_id:job.id,job_name:typeof job.name==='string'?job.name.slice(0,180):null,
        runner_id:safeId(job.runner_id)?job.runner_id:null,state,steps_count:Array.isArray(job.steps)?job.steps.length:null});
      if (state !== 'RUNNER_EXECUTED_SUCCESS') mark(`RUNNER_EVIDENCE_NOT_SUCCESS:${r.id}:${job.id}:${state}`);
    }
  }
  if (!executions.some(e => e.state === 'RUNNER_EXECUTED_SUCCESS')) mark('NO_RUNNER_EXECUTED_SUCCESS');
  const final = await safeRead(`${base}/pulls/${number}`, 'FINAL_PR_UNOBSERVED');
  const finalBranch = await safeRead(`${base}/branches/main`, 'FINAL_BRANCH_UNOBSERVED');
  const finalProtection = await safeRead(`${base}/branches/main/protection`, 'FINAL_PROTECTION_UNREADABLE');
  if (!final || final.head?.sha !== head || final.base?.sha !== baseSha ||
      final.state !== initial.state || final.draft !== initial.draft ||
      final.mergeable !== initial.mergeable || final.mergeable !== true) mark('PR_CHANGED_DURING_COLLECTION');
  if (!finalBranch || finalBranch.commit?.sha !== branch?.commit?.sha ||
      finalBranch.protected !== branch?.protected) mark('BRANCH_CHANGED_DURING_COLLECTION');
  if (!finalProtection || JSON.stringify(finalProtection) !== JSON.stringify(protection))
    mark('PROTECTION_CHANGED_OR_UNOBSERVED_DURING_COLLECTION');
  // No attestation of test assertions, mutation tests, CODEOWNERS, policy readback authority or guest compiler here.
  mark('TEST_RECEIPTS_UNVERIFIED');
  return {
    schema:1, target:{repo,number,head_sha:head,base_sha:baseSha,tree_sha:tree}, as_of:start,
    status:'BLOCKED', merge_authorized:false, guest_certified:false,
    explanation:'Advisory read-only inventory; independent administrator/security review and exact-head guest tests are separate mandatory gates.',
    protection:{branch_protected:branch?.protected===true,api_readable:!!protection,
      required_approvals:prRule?.required_approving_review_count??null,required_checks:Array.isArray(appChecks)?appChecks.map(c=>({context:c.context,app_id:c.app_id})):[]},
    reviews:{complete:reviews.complete,observed:reviewSummary.length,effective_approval_count:approvals.length},
    check_runs:{complete:checks.complete,observed:checked},
    workflow_runs:{complete:runs.complete,observed:runs.items.length},
    executions, gaps:[...gapSet].sort()
  };
}

// Five-PR / >=3 distinct repository inventory; still always BLOCKED until separate
// authenticated authorization, independent review and guest receipts are enforced.
export async function collectWaveEvidence({targets,get,now}={}) {
  if (!Array.isArray(targets) || targets.length !== 5 ||
      !targets.every(x => x && REPO_RE.test(x.repo || '') && safeId(x.number) && x.number <= 1_000_000) ||
      new Set(targets.map(x=>`${x.repo}#${x.number}`)).size !== 5 ||
      new Set(targets.map(x=>x.repo)).size < 3 || typeof get !== 'function') {
    throw TypeError('wave requires exactly 5 unique valid PRs across >=3 repos');
  }
  const items=[];
  for(const target of targets) items.push(await collectLiveEvidence({...target,get,now}));
  return {schema:1, status:'BLOCKED', merge_authorized:false,
    note:'Inventory only, not merger eligibility. Live policy, independent security signoff and compiler-backed receipts are additional gates.',
    count:items.length, distinct_repos:new Set(targets.map(x=>x.repo)).size,
    items, complete:false};
}
