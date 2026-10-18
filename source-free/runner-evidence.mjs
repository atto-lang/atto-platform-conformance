/**
 * Classify authenticated GitHub Actions metadata, never private source contents.
 * Caller must fetch run + jobs from GitHub; arbitrary JSON is NOT an attestation.
 * In particular, a successful source-free carrier does not verify a private
 * compiler's implementation, authorizations, or release compatibility.
 */
export function classifyRunnerEvidence(run, jobs, expected) {
  const fail = (reason) => Object.freeze({status: 'NOT_VERIFIED', reason, releaseReady: false});
  if (!expected || !/^[a-f0-9]{40}$/.test(expected.commitSha ?? '') ||
      !Number.isSafeInteger(expected.repositoryId) || expected.repositoryId < 1 ||
      typeof expected.workflow !== 'string' || !expected.workflow ||
      !Array.isArray(expected.requiredSteps) || expected.requiredSteps.length < 2 ||
      !expected.requiredSteps.every(s => typeof s === 'string' && s.length > 0) ||
      new Set(expected.requiredSteps).size !== expected.requiredSteps.length) {
    return fail('INVALID_EXPECTATIONS');
  }
  if (!run || !Number.isSafeInteger(run.id) || run.id < 1 ||
      !Number.isSafeInteger(run.repository?.id) ||
      run.repository.id !== expected.repositoryId ||
      run.head_sha !== expected.commitSha || run.name !== expected.workflow ||
      run.event !== expected.event || !['push','pull_request'].includes(run.event)) {
    return fail('PROVENANCE_MISMATCH');
  }
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    return fail('RUN_NOT_SUCCESSFUL');
  }
  if (!Array.isArray(jobs) || jobs.length === 0 ||
      jobs.some(j => !j || j.run_id !== run.id || j.status !== 'completed' || j.conclusion !== 'success')) {
    return fail('JOB_NOT_SUCCESSFUL');
  }
  const seen = new Map();
  for (const job of jobs) {
    if (!Array.isArray(job.steps) || job.steps.length === 0) return fail('NO_EXECUTED_STEPS');
    for (const step of job.steps) {
      if (!step || typeof step.name !== 'string' || step.status !== 'completed' ||
          step.conclusion !== 'success' || !Number.isSafeInteger(step.number) || step.number < 1) {
        return fail('STEP_NOT_SUCCESSFUL');
      }
      if (seen.has(step.name)) return fail('AMBIGUOUS_STEP_NAME');
      seen.set(step.name, job.id);
    }
  }
  if (!expected.requiredSteps.every(s => seen.has(s))) return fail('REQUIRED_TEST_STEP_MISSING');
  return Object.freeze({status: 'RUNNER_STEPS_OBSERVED', observedSteps: seen.size,
    sourceCompatibilityVerified: false, releaseReady: false});
}
