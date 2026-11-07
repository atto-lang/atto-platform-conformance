// Advisory merge-wave evidence gate. No GitHub writes and no merge authorization.
const shaPattern = /^[0-9a-f]{40}$/i;
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const validRunConclusions = new Set(['success']);
const validJobConclusions = new Set(['success', 'skipped']);

function requiredString(value) { return typeof value === 'string' && value.length > 0; }
function isSha(value) { return requiredString(value) && shaPattern.test(value); }
function stableUnique(items) { return [...new Set(items)]; }

/** Assess provider-returned GitHub snapshots, never PR-authored evidence declarations. */
export function assessPullRequest({ repository, number, expectedHead, expectedBaseSha, expectedBase = 'main', requiredStepNames,
  pr, reviews, runs, jobsByRun, trustedReviewers = ['ORESoftware', 'the1mills'],
  expectedParentMerged = true } = {}) {
  const blockers = [];
  const fail = code => { if (!blockers.includes(code)) blockers.push(code); };
  if (!repoPattern.test(repository || '') || !Number.isSafeInteger(number) || number < 1) fail('INVALID_IDENTITY');
  if (!isSha(expectedHead)) fail('INVALID_PINNED_HEAD');
  if (!isSha(expectedBaseSha) || pr?.base?.sha !== expectedBaseSha) fail('STALE_OR_UNPINNED_BASE');
  if (!Array.isArray(requiredStepNames) || requiredStepNames.length === 0 ||
      requiredStepNames.some(x => !requiredString(x))) fail('MISSING_REQUIRED_TEST_STEP_POLICY');
  if (!pr || typeof pr !== 'object') fail('MISSING_PROVIDER_PR');
  if (!pr || pr.state !== 'open' || pr.merged === true || pr.merged_at) fail('NOT_OPEN_UNMERGED');
  if (!pr || pr.draft !== false) fail('DRAFT_OR_UNKNOWN');
  if (!pr || pr.mergeable !== true) fail('NOT_MERGEABLE');
  if (!pr || pr.head?.sha !== expectedHead) fail('HEAD_CHANGED');
  if (!pr || pr.base?.ref !== expectedBase || expectedBase !== 'main') fail('NOT_MAIN_BASED');
  if (!expectedParentMerged) fail('PARENT_NOT_MERGED');

  const author = pr?.user?.login?.toLowerCase();
  if (!requiredString(author)) fail('UNKNOWN_AUTHOR');
  if (!Array.isArray(reviews)) fail('MISSING_PROVIDER_REVIEWS');
  const latestReview = new Map();
  for (const review of Array.isArray(reviews) ? reviews : []) {
    const who = review?.user?.login?.toLowerCase();
    if (!requiredString(who) || !requiredString(review?.submitted_at)) {
      fail('MALFORMED_REVIEW');
      continue;
    }
    const previous = latestReview.get(who);
    const timestamp = Date.parse(review.submitted_at);
    if (!Number.isFinite(timestamp)) { fail('MALFORMED_REVIEW_TIME'); continue; }
    if (!previous || timestamp >= previous.at) latestReview.set(who, { review, at: timestamp });
  }
  if ([...latestReview.values()].some(({review}) => review.state === 'CHANGES_REQUESTED')) fail('ACTIVE_CHANGES_REQUESTED');
  const trusted = new Set(trustedReviewers.map(x => String(x).toLowerCase()));
  const approved = [...latestReview.entries()].some(([who, {review}]) =>
    who !== author && trusted.has(who) && review.state === 'APPROVED' && review.commit_id === expectedHead);
  if (!approved) fail('MISSING_EXACT_HEAD_INDEPENDENT_APPROVAL');

  if (!Array.isArray(runs) || runs.length === 0) fail('NO_PROVIDER_RUNS');
  const currentRuns = Array.isArray(runs) ? runs.filter(r =>
    r?.head_sha === expectedHead && r?.event === 'pull_request') : [];
  if (!currentRuns.length) fail('NO_EXACT_HEAD_PR_RUN');
  if (currentRuns.some(r => r.status !== 'completed' || !validRunConclusions.has(r.conclusion))) fail('UNSUCCESSFUL_OR_PENDING_RUN');
  let executed = 0;
  const executedStepNames = new Set();
  for (const run of currentRuns) {
    if (!Number.isSafeInteger(run.id) || run.id <= 0 ||
        !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) {
      fail('MALFORMED_RUN_IDENTITY'); continue;
    }
    const jobs = jobsByRun?.[String(run.id)];
    if (!Array.isArray(jobs) || jobs.length === 0) { fail('MISSING_PROVIDER_JOBS'); continue; }
    const names = new Set();
    for (const job of jobs) {
      if (!requiredString(job?.name) || names.has(job.name)) fail('DUPLICATE_OR_MISSING_JOB_NAME');
      else names.add(job.name);
      if (!validJobConclusions.has(job?.conclusion)) fail('JOB_FAILED_OR_UNKNOWN');
      if (job?.run_attempt != null && job.run_attempt !== run.run_attempt) fail('RUN_ATTEMPT_MISMATCH');
      if (job?.conclusion === 'skipped') continue; // Not evidence and not necessarily a failure.
      if (!Number.isSafeInteger(job?.runner_id) || job.runner_id <= 0) { fail('RUNNER_NOT_ADMITTED'); continue; }
      if (!Array.isArray(job.steps) || job.steps.length === 0) { fail('ZERO_EXECUTED_STEPS'); continue; }
      const stepNames = new Set();
      for (const step of job.steps) {
        if (!requiredString(step?.name) || stepNames.has(step.name)) fail('DUPLICATE_OR_MISSING_STEP_NAME');
        else stepNames.add(step.name);
        if (step?.status !== 'completed' || step?.conclusion !== 'success') fail('STEP_NOT_SUCCESSFUL');
        else { executed++; executedStepNames.add(step.name); }
      }
    }
  }
  if (executed < 1) fail('NO_EXECUTED_SUCCESSFUL_STEPS');
  if (Array.isArray(requiredStepNames) && requiredStepNames.some(x => !executedStepNames.has(x)))
    fail('MISSING_REQUIRED_EXECUTED_TEST_STEP');
  return { repository, number, expectedHead, readyForIndependentMergeDecision: blockers.length === 0,
    executedSuccessfulStepCount: executed, blockers };
}

/** No merge is ever performed: even a passing report needs branch protection and a fresh API recheck. */
export function assessWave(entries, {minimumPRs = 5, minimumRepos = 3} = {}) {
  if (!Array.isArray(entries)) throw new TypeError('entries must be provider-assessed PRs');
  const keys = entries.map(x => x.repository+'#'+x.number);
  const duplicateIds = keys.length !== stableUnique(keys).length;
  const ready = entries.filter(x => x.readyForIndependentMergeDecision === true);
  const repos = stableUnique(ready.map(x => x.repository));
  const blockers = [];
  if (duplicateIds) blockers.push('DUPLICATE_PR_IDENTITY');
  if (entries.length < minimumPRs || ready.length < minimumPRs) blockers.push('INSUFFICIENT_READY_PRS');
  if (repos.length < minimumRepos) blockers.push('INSUFFICIENT_DISTINCT_REPOS');
  return { advisoryOnly: true, mergeAuthorized: false, readyCount: ready.length,
    distinctReadyRepos: repos.length, blockedCount: entries.length - ready.length,
    readyForHumanFinalReview: blockers.length === 0, blockers, prs: entries };
}
