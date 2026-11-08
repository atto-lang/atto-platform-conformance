// Advisory merge-wave evidence gate. No GitHub writes and no merge authorization.
const shaPattern = /^[0-9a-f]{40}$/i;
const componentPattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const acceptedReviewStates = new Set(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING']);
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const validRunConclusions = new Set(['success']);
const validJobConclusions = new Set(['success', 'skipped']);

function requiredString(value) { return typeof value === 'string' && value.trim().length > 0; }
function isSha(value) { return requiredString(value) && shaPattern.test(value); }
function stableUnique(items) { return [...new Set(items)]; }
export function validRepoName(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('/');
  return parts.length === 2 && parts.every(p => componentPattern.test(p) && p !== '.' && p !== '..');
}
function reviewTime(value) {
  if (typeof value !== 'string' || !isoTimestamp.test(value)) return NaN;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return NaN;
  const canonical = new Date(t).toISOString();
  return canonical.slice(0, 19) === value.slice(0, 19) ? t : NaN;
}

/** Assess provider-returned GitHub snapshots, never PR-authored evidence declarations. */
export function assessPullRequest({ repository, number, expectedHead, expectedBaseSha, expectedBase = 'main', requiredStepNames, requiredWorkflows,
  pr, reviews, runs, jobsByRun, trustedReviewers = ['ORESoftware', 'the1mills'],
  expectedParentMerged = true } = {}) {
  const blockers = [];
  const fail = code => { if (!blockers.includes(code)) blockers.push(code); };
  if (!validRepoName(repository) || !Number.isSafeInteger(number) || number < 1) fail('INVALID_IDENTITY');
  if (!isSha(expectedHead)) fail('INVALID_PINNED_HEAD');
  if (!isSha(expectedBaseSha) || pr?.base?.sha !== expectedBaseSha) fail('STALE_OR_UNPINNED_BASE');
  if (!Array.isArray(requiredStepNames) || requiredStepNames.length === 0 ||
      requiredStepNames.some(x => !requiredString(x)) ||
      stableUnique(Array.isArray(requiredStepNames) ? requiredStepNames : []).length !== requiredStepNames?.length)
    fail('MISSING_REQUIRED_TEST_STEP_POLICY');
  // A successful unrelated workflow or copied step name is not evidence.
  const workflowPolicyValid = Array.isArray(requiredWorkflows) && requiredWorkflows.length > 0 &&
    requiredWorkflows.every(x => x && Number.isSafeInteger(x.workflowId) && x.workflowId > 0 &&
      requiredString(x.workflowName) && requiredString(x.jobName) && requiredString(x.testStepName));
  if (!workflowPolicyValid || new Set((Array.isArray(requiredWorkflows) ? requiredWorkflows : []).map(x =>
    `${x?.workflowId}:${x?.jobName}:${x?.testStepName}`)).size !== requiredWorkflows?.length)
    fail('MISSING_REQUIRED_WORKFLOW_POLICY');
  if (!pr || typeof pr !== 'object' || Array.isArray(pr)) fail('MISSING_PROVIDER_PR');
  if (!pr || pr.state !== 'open' || pr.merged === true || pr.merged_at) fail('NOT_OPEN_UNMERGED');
  if (!pr || pr.draft !== false) fail('DRAFT_OR_UNKNOWN');
  if (!pr || pr.mergeable !== true) fail('NOT_MERGEABLE');
  if (!pr || pr.head?.sha !== expectedHead) fail('HEAD_CHANGED');
  if (!pr || pr.base?.ref !== expectedBase || expectedBase !== 'main') fail('NOT_MAIN_BASED');
  if (pr?.number !== undefined && pr.number !== number) fail('PR_NUMBER_MISMATCH');
  if (pr?.base?.repo?.full_name !== undefined && pr.base.repo.full_name !== repository) fail('BASE_REPOSITORY_MISMATCH');
  if (pr?.head?.repo?.full_name !== undefined && pr.head.repo.full_name !== repository) fail('HEAD_REPOSITORY_MISMATCH');
  if (!expectedParentMerged) fail('PARENT_NOT_MERGED');

  const author = typeof pr?.user?.login === 'string' ? pr.user.login.toLowerCase() : null;
  if (!requiredString(author)) fail('UNKNOWN_AUTHOR');
  if (!Array.isArray(reviews)) fail('MISSING_PROVIDER_REVIEWS');
  if (!Array.isArray(trustedReviewers) || trustedReviewers.length === 0 ||
      trustedReviewers.some(x => !requiredString(x))) fail('INVALID_TRUSTED_REVIEWER_POLICY');
  const latestReview = new Map();
  for (const review of Array.isArray(reviews) ? reviews : []) {
    if (review?.state === 'PENDING' && review.submitted_at == null) continue;
    const who = typeof review?.user?.login === 'string' ? review.user.login.toLowerCase() : null;
    if (!requiredString(who) || !requiredString(review?.submitted_at)) {
      fail('MALFORMED_REVIEW'); continue;
    }
    if (!acceptedReviewStates.has(review?.state)) fail('UNKNOWN_REVIEW_STATE');
    const timestamp = reviewTime(review.submitted_at);
    if (!Number.isFinite(timestamp)) { fail('MALFORMED_REVIEW_TIME'); continue; }
    const previous = latestReview.get(who);
    if (!previous || timestamp > previous.at) latestReview.set(who, {reviews:[review],at:timestamp});
    else if (timestamp === previous.at) previous.reviews.push(review);
  }
  const resolved = [];
  for (const [who, {reviews:tied}] of latestReview) {
    const states = new Set(tied.map(r => r.state));
    if (states.size > 1 || (states.has('APPROVED') && new Set(tied.map(r => r.commit_id)).size > 1))
      fail('AMBIGUOUS_LATEST_REVIEW');
    if (states.has('CHANGES_REQUESTED')) fail('ACTIVE_CHANGES_REQUESTED');
    if (states.size === 1 && tied.length > 0) resolved.push([who,tied[0]]);
  }
  const trusted = new Set(Array.isArray(trustedReviewers)
    ? trustedReviewers.map(x => typeof x === 'string' ? x.toLowerCase() : '') : []);
  const approved = resolved.some(([who,review]) =>
    who !== author && trusted.has(who) && review.state === 'APPROVED' && review.commit_id === expectedHead);
  if (!approved) fail('MISSING_EXACT_HEAD_INDEPENDENT_APPROVAL');

  if (!Array.isArray(runs) || runs.length === 0) fail('NO_PROVIDER_RUNS');
  const currentRuns = Array.isArray(runs) ? runs.filter(r =>
    r?.head_sha === expectedHead && r?.event === 'pull_request') : [];
  if (!currentRuns.length) fail('NO_EXACT_HEAD_PR_RUN');
  if (currentRuns.some(r => r.status !== 'completed' || !validRunConclusions.has(r.conclusion))) fail('UNSUCCESSFUL_OR_PENDING_RUN');
  let executed = 0;
  const executedStepNames = new Set();
  const runIds = new Set();
  for (const run of currentRuns) {
    if (!Number.isSafeInteger(run.id) || run.id <= 0 ||
        !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) {
      fail('MALFORMED_RUN_IDENTITY'); continue;
    }
    if (runIds.has(run.id)) fail('DUPLICATE_RUN_IDENTITY');
    else runIds.add(run.id);
    if (run.repository?.full_name !== undefined && run.repository.full_name !== repository) fail('RUN_REPOSITORY_MISMATCH');
    if (run.head_repository?.full_name !== undefined && run.head_repository.full_name !== repository) fail('RUN_HEAD_REPOSITORY_MISMATCH');
    if (Array.isArray(run.pull_requests) && run.pull_requests.length > 0 &&
        !run.pull_requests.some(x => x?.number === number &&
          (x?.base?.repo?.full_name === undefined || x.base.repo.full_name === repository)))
      fail('RUN_NOT_ASSOCIATED_WITH_PR');
    const jobs = jobsByRun?.[String(run.id)];
    if (!Array.isArray(jobs) || jobs.length === 0) { fail('MISSING_PROVIDER_JOBS'); continue; }
    const names = new Set();
    const jobIds = new Set();
    for (const job of jobs) {
      if (!requiredString(job?.name) || names.has(job.name)) fail('DUPLICATE_OR_MISSING_JOB_NAME');
      else names.add(job.name);
      if (job?.id != null && (!Number.isSafeInteger(job.id) || job.id <= 0 || jobIds.has(job.id)))
        fail('DUPLICATE_OR_INVALID_JOB_ID');
      else if (job?.id != null) jobIds.add(job.id);
      if (job?.run_id != null && job.run_id !== run.id) fail('JOB_RUN_ID_MISMATCH');
      if (!validJobConclusions.has(job?.conclusion)) fail('JOB_FAILED_OR_UNKNOWN');
      if (job?.run_attempt != null && job.run_attempt !== run.run_attempt) fail('RUN_ATTEMPT_MISMATCH');
      if (job?.conclusion === 'skipped') continue; // Not evidence and not necessarily a failure.
      if (!Number.isSafeInteger(job?.runner_id) || job.runner_id <= 0) { fail('RUNNER_NOT_ADMITTED'); continue; }
      if (!Array.isArray(job.steps) || job.steps.length === 0) { fail('ZERO_EXECUTED_STEPS'); continue; }
      const stepNames = new Set();
      const stepNumbers = new Set();
      for (const step of job.steps) {
        if (!requiredString(step?.name) || stepNames.has(step.name)) fail('DUPLICATE_OR_MISSING_STEP_NAME');
        else stepNames.add(step.name);
        if (step?.number != null && (!Number.isSafeInteger(step.number) || step.number < 1 ||
            stepNumbers.has(step.number))) fail('DUPLICATE_OR_INVALID_STEP_NUMBER');
        else if (step?.number != null) stepNumbers.add(step.number);
        if (step?.status !== 'completed' || step?.conclusion !== 'success') fail('STEP_NOT_SUCCESSFUL');
        else { executed++; executedStepNames.add(step.name); }
      }
    }
  }
  if (executed < 1) fail('NO_EXECUTED_SUCCESSFUL_STEPS');
  if (Array.isArray(requiredStepNames) && requiredStepNames.some(x => !executedStepNames.has(x)))
    fail('MISSING_REQUIRED_EXECUTED_TEST_STEP');
  if (workflowPolicyValid) for (const requirement of requiredWorkflows) {
    const candidates = currentRuns.filter(r => r.workflow_id === requirement.workflowId);
    if (candidates.some(r => r.name !== requirement.workflowName)) fail('WORKFLOW_IDENTITY_MISMATCH');
    const validRuns = candidates.filter(r => r.name === requirement.workflowName);
    if (!validRuns.length) { fail('MISSING_REQUIRED_WORKFLOW'); continue; }
    const candidateJobs = validRuns.flatMap(r => (jobsByRun?.[String(r.id)] ?? [])
      .filter(j => j?.name === requirement.jobName && j?.conclusion === 'success' &&
        j?.run_id !== undefined && j.run_id === r.id && j?.run_attempt === r.run_attempt &&
        Number.isSafeInteger(j.runner_id) && j.runner_id > 0));
    if (!candidateJobs.length) { fail('MISSING_REQUIRED_WORKFLOW_JOB'); continue; }
    if (!candidateJobs.some(j => Array.isArray(j.steps) && j.steps.some(s =>
      s?.name === requirement.testStepName && s?.status === 'completed' && s?.conclusion === 'success')))
      fail('MISSING_REQUIRED_WORKFLOW_STEP');
  }
  return { repository, number, expectedHead, readyForIndependentMergeDecision: blockers.length === 0,
    executedSuccessfulStepCount: executed, blockers };
}

/** No merge is ever performed: even a passing report needs branch protection and a fresh API recheck. */
export function assessWave(entries, {minimumPRs = 5, minimumRepos = 3} = {}) {
  if (!Array.isArray(entries)) throw new TypeError('entries must be provider-assessed PRs');
  if (!Number.isSafeInteger(minimumPRs) || minimumPRs < 5 ||
      !Number.isSafeInteger(minimumRepos) || minimumRepos < 3)
    throw new RangeError('merge-wave minimums cannot be lowered');
  const keys = entries.map(x => x.repository+'#'+x.number);
  const duplicateIds = keys.length !== stableUnique(keys).length;
  const ready = entries.filter(x => x?.readyForIndependentMergeDecision === true);
  const repos = stableUnique(ready.map(x => x.repository));
  const blockers = [];
  if (duplicateIds) blockers.push('DUPLICATE_PR_IDENTITY');
  if (entries.length < minimumPRs || ready.length < minimumPRs) blockers.push('INSUFFICIENT_READY_PRS');
  if (repos.length < minimumRepos) blockers.push('INSUFFICIENT_DISTINCT_REPOS');
  return { advisoryOnly: true, mergeAuthorized: false, readyCount: ready.length,
    distinctReadyRepos: repos.length, blockedCount: entries.length - ready.length,
    readyForHumanFinalReview: blockers.length === 0, blockers, prs: entries };
}
