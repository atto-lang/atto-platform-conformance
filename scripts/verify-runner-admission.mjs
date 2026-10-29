import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CANARY_WORKFLOW = '.github/workflows/source-local-runner-admission.yml';
export const CANARY_JOB = 'runner-admission';
export const CANARY_STEP = 'Prove source-local runner and meaningful shell execution';

function nonHousekeeping(step) {
  const name = typeof step?.name === 'string' ? step.name.trim() : '';
  return name !== '' && !/^(Set up job|Complete job|Post(?:\s|$))/i.test(name);
}

export function verifyRunnerAdmission(run, jobPage, expected) {
  const reasons = [];
  const reject = (condition, message) => { if (!condition) reasons.push(message); };
  reject(run && Number.isSafeInteger(run.id) && run.id > 0, 'invalid run id');
  reject(run?.repository?.full_name === expected.repository, 'repository mismatch');
  reject(run?.head_sha === expected.sha, 'commit SHA mismatch');
  reject(run?.head_branch === expected.branch, 'branch mismatch');
  reject(run?.path?.split('@')[0] === CANARY_WORKFLOW, 'workflow path mismatch');
  reject(['push', 'workflow_dispatch'].includes(run?.event), 'unexpected event');
  reject(Number.isSafeInteger(run?.run_attempt) && run.run_attempt > 0, 'invalid attempt');
  reject(run?.status === 'completed', 'run not completed');
  reject(jobPage && Array.isArray(jobPage.jobs) && Number.isSafeInteger(jobPage.total_count), 'invalid job response');
  reject(jobPage?.total_count === jobPage?.jobs?.length, 'job response incomplete or truncated');

  const matches = Array.isArray(jobPage?.jobs) ? jobPage.jobs.filter(j => j.name === CANARY_JOB) : [];
  reject(matches.length === 1, 'expected exactly one canary job');
  const job = matches.length === 1 ? matches[0] : null;
  reject(job?.run_id === run?.id, 'job run id mismatch');
  reject(job?.run_attempt === run?.run_attempt, 'job attempt mismatch');
  reject(job?.head_sha === run?.head_sha, 'job commit mismatch');
  reject(job?.status === 'completed', 'job not completed');

  const runnerAllocated = Number.isSafeInteger(job?.runner_id) && job.runner_id > 0 && typeof job.runner_name === 'string' && job.runner_name.trim() !== '';
  reject(runnerAllocated, 'no independently allocated runner');
  const steps = Array.isArray(job?.steps) ? job.steps : [];
  const meaningful = steps.filter(s => nonHousekeeping(s) && s.status === 'completed' && ['success', 'failure', 'timed_out'].includes(s.conclusion));
  const canaryStep = meaningful.find(s => s.name === CANARY_STEP);
  reject(Boolean(canaryStep), 'no completed canary step');
  reject(job?.conclusion === 'success' && canaryStep?.conclusion === 'success', 'canary did not succeed');

  return {
    admitted: reasons.length === 0,
    runnerAllocated,
    meaningfulStepExecuted: meaningful.length > 0,
    backendGuestExecution: false,
    runId: run?.id ?? null,
    attempt: run?.run_attempt ?? null,
    sha: run?.head_sha ?? null,
    jobConclusion: job?.conclusion ?? null,
    meaningfulSteps: meaningful.map(s => ({ name: s.name, conclusion: s.conclusion })),
    reasons,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [runPath, jobsPath, repository, sha, branch] = process.argv.slice(2);
  if (![runPath, jobsPath, repository, sha, branch].every(Boolean)) {
    console.error('usage: node scripts/verify-runner-admission.mjs run.json jobs.json repository exact_sha exact_branch');
    process.exitCode = 2;
  } else {
    try {
      const run = JSON.parse(readFileSync(runPath, 'utf8'));
      const jobs = JSON.parse(readFileSync(jobsPath, 'utf8'));
      const result = verifyRunnerAdmission(run, jobs, { repository, sha, branch });
      console.log(JSON.stringify(result, null, 2));
      if (!result.admitted) process.exitCode = 1;
    } catch (err) {
      console.error(`failed closed: ${err.message}`);
      process.exitCode = 2;
    }
  }
}
