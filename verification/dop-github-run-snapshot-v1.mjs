// Correlates a schema-valid DOP receipt with GitHub Actions REST run/job data.
// Caller MUST retrieve data independently from authenticated GitHub API; this
// pure validator does not authenticate self-supplied JSON or binary artifacts.
import { validateDopGuestReceipt } from './dop-scalar-guest-v1.mjs';

const positiveInt = value => Number.isSafeInteger(value) && value > 0;

export function validateDopGithubSnapshot(receipt, contract, run, jobPage, expectedRepo) {
  const errors = validateDopGuestReceipt(receipt, contract);
  const need = (value, reason) => { if (!value) errors.push(reason); };
  if (errors.length) return errors;
  if (receipt.status === 'NOT_EXECUTED') return ['not-executed-cannot-attest-run'];

  need(typeof expectedRepo === 'string' && /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(expectedRepo),
    'expected-repository');
  need(run !== null && typeof run === 'object' && !Array.isArray(run), 'run-object');
  if (run === null || typeof run !== 'object' || Array.isArray(run)) return errors;
  need(positiveInt(run.id) && run.id === receipt.ciJob.runId, 'run-id-match');
  need(run.head_sha === receipt.sourceHeadSha, 'run-exact-head');
  need(run.repository?.full_name === expectedRepo, 'run-repository');
  need(run.head_repository?.full_name === expectedRepo, 'run-head-repository');
  need(positiveInt(run.run_attempt), 'run-attempt');
  need(run.status === 'completed', 'run-completed');
  need(run.conclusion === (receipt.status === 'FAILED' ? 'failure' : 'success'),
    'run-conclusion');

  need(jobPage !== null && typeof jobPage === 'object' && !Array.isArray(jobPage), 'job-page');
  const jobs = Array.isArray(jobPage?.jobs) ? jobPage.jobs : null;
  need(jobs !== null, 'job-list');
  need(Number.isSafeInteger(jobPage?.total_count) && jobPage.total_count >= 1 &&
    jobPage.total_count <= 100 && jobs?.length === jobPage.total_count,
    'complete-bounded-job-page');
  if (!jobs) return errors;
  need(positiveInt(receipt.ciJob.jobId), 'receipt-job-id');
  const matches = jobs.filter(job => job?.id === receipt.ciJob.jobId);
  need(matches.length === 1, 'unique-job-id-match');
  if (matches.length !== 1) return errors;
  const job = matches[0];
  need(job.run_id === run.id, 'job-run-id-match');
  need(job.head_sha === receipt.sourceHeadSha, 'job-exact-head');
  need(positiveInt(job.run_attempt) && job.run_attempt === run.run_attempt, 'job-attempt-match');
  need(job.runner_id === receipt.ciJob.runnerId && positiveInt(job.runner_id),
    'admitted-runner-match');
  need(job.status === 'completed', 'job-completed');
  need(job.conclusion === receipt.ciJob.conclusion, 'job-conclusion-match');
  need(Array.isArray(job.steps) && job.steps.length > 0 && job.steps.length <= 1000,
    'executed-job-steps');
  if (!Array.isArray(job.steps)) return errors;

  const names = new Set();
  const numbers = new Set();
  for (const step of job.steps) {
    need(typeof step?.name === 'string' && step.name.length > 0, 'api-step-name');
    need(!names.has(step?.name), 'duplicate-api-step-name');
    names.add(step?.name);
    need(positiveInt(step?.number), 'api-step-number');
    need(!numbers.has(step?.number), 'duplicate-api-step-number');
    numbers.add(step?.number);
  }
  for (const claimed of receipt.ciJob.steps) {
    const matchesByNumber = job.steps.filter(step => step?.number === claimed.number);
    need(matchesByNumber.length === 1, 'observed-step-number-match');
    if (matchesByNumber.length !== 1) continue;
    const actual = matchesByNumber[0];
    need(actual.name === claimed.id, 'observed-step-name-match');
    need(actual.conclusion === claimed.conclusion, 'observed-step-conclusion-match');
    need(actual.started_at === claimed.startedAt, 'observed-step-start-match');
    need(actual.completed_at === claimed.completedAt, 'observed-step-end-match');
  }
  return errors;
}
