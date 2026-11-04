// Source-free, offline check of GitHub Actions metadata obtained through an
// independently authenticated API. Does NOT attest source-tree identity,
// artifact hashes, compiled guest execution, or authorize private mirroring.
const oid = /^[0-9a-f]{40}$/;
const plain = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
const positive = x => Number.isSafeInteger(x) && x > 0;
const actualStep = step => plain(step) && positive(step.number) &&
  step.status === 'completed' && step.conclusion === 'success';
const housekeeping = name => /^(?:Set up job|Complete job|Post |Run actions\/|Run docker\/)/.test(name);

export function assessActionsJob(input) {
  if (!plain(input))
    return {classification: 'INVALID', errors: ['plain evidence input required']};
  const {run, job, expected} = input;
  const errors = [];
  const fail = reason => errors.push(reason);
  if (!plain(run) || !plain(job) || !plain(expected))
    return {classification: 'INVALID', errors: ['plain data-only run, job and trusted expectations required']};
  if (!positive(expected.repositoryId) || !oid.test(expected.headSha) ||
      typeof expected.workflowPath !== 'string' ||
      !/^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/.test(expected.workflowPath) ||
      !Array.isArray(expected.requiredSteps) || expected.requiredSteps.length === 0 ||
      expected.requiredSteps.length > 32 ||
      !expected.requiredSteps.every(x => typeof x === 'string' && x.length > 0 && x.length <= 160) ||
      new Set(expected.requiredSteps).size !== expected.requiredSteps.length)
    return {classification: 'INVALID', errors: ['invalid independent trusted expectations']};
  if (!positive(run.id) || !positive(run.run_attempt) ||
      run.repository?.id !== expected.repositoryId ||
      run.head_repository?.id !== expected.repositoryId ||
      run.head_sha !== expected.headSha ||
      run.path?.split('@')[0] !== expected.workflowPath ||
      !['push', 'pull_request', 'workflow_dispatch'].includes(run.event))
    fail('run repository, workflow or exact head mismatches trusted pins');
  if (job.run_id !== run.id || job.run_attempt !== run.run_attempt ||
      job.head_sha !== expected.headSha || !positive(job.id))
    fail('job does not belong to exact run attempt and head');
  if (!Array.isArray(job.steps) || job.steps.length > 256 ||
      job.steps.some(step => !plain(step)))
    return {classification: 'INVALID', errors: [...errors, 'invalid or unbounded step inventory']};
  const steps = job.steps;
  const executed = steps.filter(actualStep);
  if (!positive(job.runner_id) || !job.runner_name ||
      typeof job.runner_name !== 'string' || job.runner_name.length > 160 ||
      !executed.some(step => typeof step.name === 'string' && !housekeeping(step.name)))
    fail('runner unassigned or zero substantive executed steps');
  for (const name of expected.requiredSteps) {
    if (steps.filter(step => step.name === name).length !== 1 ||
        executed.filter(step => step.name === name).length !== 1)
      fail('required executed step absent, repeated or unsuccessful: ' + name);
  }
  if (new Set(steps.map(step => step.number)).size !== steps.length)
    fail('step numbers are duplicated');
  if (run.status !== 'completed' || run.conclusion !== 'success' ||
      job.status !== 'completed' || job.conclusion !== 'success')
    fail('workflow or job was not successfully completed');
  if (errors.length) return {classification: 'INVALID', errors};
  // Raw JSON records are still only claims until fetched through an authenticated
  // API and matched against the pinned source tree and compiled guest artifact.
  return {classification: 'REVIEW_REQUIRED', errors: []};
}
