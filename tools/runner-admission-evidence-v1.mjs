/** Read-only source-org runner admission classifier. NOT a merge/release gate. */
const SHA = /^[a-f0-9]{40}$/;
const MAX_JOBS = 200;
const MAX_STEPS = 100;
const isId = (n) => Number.isSafeInteger(n) && n > 0;
const nonempty = (s, max = 256) => typeof s === 'string' && s.trim() === s && s.length > 0 && s.length <= max;
const result = (classification, reasons, details = {}) => Object.freeze({
  schema_version: 1,
  classification,
  reasons: Object.freeze([...new Set(reasons)]),
  merge_authorized: false,
  release_certified: false,
  source_guest_executed: false,
  ...details,
});

/**
 * Input must be trusted GET observations *bound to a single run attempt*;
 * caller must fetch all jobs/pages. Offline supplied JSON is NEVER authority.
 * expected is a separately pinned owner/repo + SHA + run ID and attempt.
 */
export function classifyRunnerAdmission({ run, jobs, expected } = {}) {
  if (!run || !jobs || !expected || typeof run !== 'object' ||
      typeof jobs !== 'object' || typeof expected !== 'object' ||
      Array.isArray(run) || Array.isArray(jobs) || Array.isArray(expected)) {
    return result('INVALID_INPUT', ['MISSING_OR_MALFORMED_RECORD']);
  }
  if (!nonempty(expected.repository, 140) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(expected.repository) ||
      !SHA.test(expected.head_sha || '') || !isId(expected.run_id) ||
      !isId(expected.run_attempt)) {
    return result('INVALID_INPUT', ['INVALID_PINNED_IDENTITY']);
  }
  if (!isId(run.id) || run.id !== expected.run_id ||
      !isId(run.run_attempt) || run.run_attempt !== expected.run_attempt ||
      run.head_sha !== expected.head_sha ||
      run.repository?.full_name !== expected.repository) {
    return result('BLOCKED', ['RUN_IDENTITY_MISMATCH']);
  }
  if (!['completed', 'queued', 'in_progress', 'requested', 'waiting', 'pending'].includes(run.status) ||
      ![null, 'success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral'].includes(run.conclusion ?? null)) {
    return result('INVALID_INPUT', ['INVALID_RUN_STATUS']);
  }
  if (run.status !== 'completed' && run.conclusion != null) {
    return result('BLOCKED', ['INCOMPLETE_RUN_WITH_CONCLUSION']);
  }
  if (!isId(jobs.run_attempt) || jobs.run_attempt !== run.run_attempt) {
    return result('BLOCKED', ['JOB_INVENTORY_ATTEMPT_MISMATCH']);
  }
  if (!Number.isSafeInteger(jobs.total_count) || jobs.total_count < 0 ||
      jobs.total_count > MAX_JOBS || !Array.isArray(jobs.jobs) ||
      jobs.jobs.length !== jobs.total_count) {
    return result('BLOCKED', ['INCOMPLETE_OR_OVERSIZED_JOB_INVENTORY']);
  }
  if (jobs.jobs.length === 0) return result('BLOCKED', ['NO_JOBS']);
  const ids = new Set();
  let fullyStepful = 0;
  let zeroStep = 0;
  let missingRunner = 0;
  let jobFailure = 0;
  let inProgress = 0;
  for (const job of jobs.jobs) {
    if (!job || typeof job !== 'object' || Array.isArray(job) ||
        !isId(job.id) || ids.has(job.id) || job.run_id !== run.id ||
        (job.run_attempt != null && job.run_attempt !== run.run_attempt) ||
        !nonempty(job.name, 300) || !Array.isArray(job.steps) ||
        job.steps.length > MAX_STEPS) {
      return result('BLOCKED', ['MALFORMED_OR_WRONG_ATTEMPT_JOB']);
    }
    ids.add(job.id);
    if (!['completed', 'queued', 'in_progress', 'waiting', 'pending'].includes(job.status)) {
      return result('BLOCKED', ['INVALID_JOB_STATUS']);
    }
    if (job.status !== 'completed') inProgress++;
    if (job.steps.length === 0) {
      zeroStep++;
      if (job.status === 'completed' && job.conclusion === 'success') {
        return result('BLOCKED', ['ZERO_STEP_SUCCESS_NOT_EXECUTION']);
      }
      continue;
    }
    const stepIds = new Set();
    let substantive = false;
    for (const step of job.steps) {
      if (!step || typeof step !== 'object' || Array.isArray(step) ||
          !Number.isSafeInteger(step.number) || step.number <= 0 || stepIds.has(step.number) ||
          !nonempty(step.name, 300) ||
          !['completed', 'queued', 'in_progress', 'pending'].includes(step.status) ||
          ![null, 'success', 'failure', 'cancelled', 'skipped'].includes(step.conclusion ?? null)) {
        return result('BLOCKED', ['MALFORMED_STEP_INVENTORY']);
      }
      stepIds.add(step.number);
      if (step.status !== 'completed' && step.conclusion != null) {
        return result('BLOCKED', ['INCOMPLETE_STEP_WITH_CONCLUSION']);
      }
      if (step.conclusion === 'failure' || step.conclusion === 'cancelled') jobFailure++;
      if (step.status === 'completed' && step.conclusion === 'success' &&
          !/^(Set up job|Complete job|Post |Prepare all required actions|Finalize Containers)/i.test(step.name)) {
        substantive = true;
      }
    }
    if (job.status === 'completed' && job.conclusion === 'success' && substantive &&
        job.steps.every(s => s.status === 'completed' && s.conclusion === 'success')) fullyStepful++;
    if (!isId(job.runner_id) || !nonempty(job.runner_name, 256)) missingRunner++;
    if (job.conclusion !== 'success') jobFailure++;
  }
  const details = { observed_job_count: jobs.jobs.length, stepful_job_count: fullyStepful,
    zero_step_job_count: zeroStep, runner_identity_missing_count: missingRunner };
  if (run.status !== 'completed' || inProgress > 0) {
    return result('IN_PROGRESS', ['RUN_OR_JOBS_NOT_COMPLETED'], details);
  }
  if (zeroStep === jobs.jobs.length) {
    return result('NOT_EXECUTED', ['ALL_JOBS_ZERO_STEPS'], details);
  }
  if (zeroStep || fullyStepful !== jobs.jobs.length || jobFailure || run.conclusion !== 'success') {
    return result('BLOCKED', ['PARTIAL_OR_FAILED_EXECUTION'], details);
  }
  if (missingRunner) {
    return result('EXECUTED_RUNNER_UNATTESTED', ['MISSING_RUNNER_IDENTITY'], details);
  }
  return result('RUNNER_EXECUTION_OBSERVED', ['SOURCE_FREE_ONLY_NOT_RELEASE_EVIDENCE'], details);
}

/** Never return exit 0: even verified allocation is not release authorization. */
export function runnerAdmissionExitCode(record) {
  return record?.classification === 'INVALID_INPUT' ? 2 :
    record?.classification === 'RUNNER_EXECUTION_OBSERVED' ? 3 : 1;
}
