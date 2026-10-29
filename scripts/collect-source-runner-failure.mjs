#!/usr/bin/env node
/** Read-only, source-local GitHub Actions admission triage; never checks out or exports source. */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const REPOSITORY = 'ores-truffle-oreslang/oreslang-platform-conformance';
export const WORKFLOW = '.github/workflows/source-local-runner-admission.yml';
export const JOB = 'runner-admission';
export const BRANCH = 'ci/source-local-runner-admission-20261028';

function isId(value) {
  return Number.isSafeInteger(value) && value > 0;
}
export function parseTarget([runText, attemptText, sha, branch]) {
  if (!/^[1-9][0-9]*$/.test(runText ?? '') || !/^[1-9][0-9]*$/.test(attemptText ?? '') ||
      !isId(Number(runText)) || !isId(Number(attemptText)) ||
      !/^[0-9a-f]{40}$/.test(sha ?? '') || branch !== BRANCH) {
    throw new Error('expected positive run ID, positive attempt, exact 40-hex SHA and authorized branch');
  }
  return { runId: Number(runText), attempt: Number(attemptText), sha, branch };
}
function must(condition, reason) {
  if (!condition) throw new Error('fail-closed: ' + reason);
}
function shortText(input) {
  // Logs/annotations may contain unexpected secrets: mask credential-like strings.
  if (typeof input !== 'string') return '';
  return input.slice(0, 4000)
    .replace(/(?:ghp_|gho_|ghu_|ghs_|ghr_)[a-zA-Z0-9_]{10,}/g, '[REDACTED_GH_TOKEN]')
    .replace(/github_pat_[a-zA-Z0-9_]{10,}/g, '[REDACTED_GH_PAT]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
}
export function validateReceipt(run, jobPage, target) {
  must(run && run.id === target.runId, 'run ID differs from caller pin');
  must(run.repository?.full_name === REPOSITORY, 'wrong repository');
  must(run.head_sha === target.sha, 'wrong exact SHA');
  must(run.head_branch === target.branch, 'wrong branch');
  must(typeof run.path === 'string' && run.path.split('@')[0] === WORKFLOW, 'wrong workflow');
  must(['push', 'workflow_dispatch'].includes(run.event), 'unapproved trigger');
  must(run.run_attempt === target.attempt, 'run attempt differs from caller pin');
  must(jobPage && Array.isArray(jobPage.jobs) && jobPage.total_count === 1 && jobPage.jobs.length === 1, 'incomplete or unexpected job list');
  const job = jobPage.jobs[0];
  must(job?.name === JOB && isId(job.id), 'unexpected runner-admission job');
  must(job.run_id === run.id && job.run_attempt === target.attempt && job.head_sha === target.sha, 'job identity mismatch');
  const realRunner = isId(job.runner_id) && typeof job.runner_name === 'string' && job.runner_name.trim() !== '';
  const meaningful = Array.isArray(job.steps) ? job.steps.filter(s =>
    typeof s?.name === 'string' && s.name.trim() !== '' &&
    !/^(Set up job|Complete job|Post(?:\s|$))/i.test(s.name.trim()) &&
    s.status === 'completed' && ['success', 'failure', 'timed_out'].includes(s.conclusion)) : [];
  return {
    runId: run.id, attempt: run.run_attempt, sha: run.head_sha,
    runStatus: run.status, runConclusion: run.conclusion,
    jobId: job.id, jobStatus: job.status, jobConclusion: job.conclusion,
    runnerId: job.runner_id ?? null, runnerName: job.runner_name || '',
    runnerBackedExecutionObserved: realRunner && meaningful.length > 0,
    preAllocationFailure: job.status === 'completed' && job.conclusion === 'failure' &&
      job.runner_id === 0 && (job.runner_name == null || job.runner_name === '') &&
      Array.isArray(job.steps) && job.steps.length === 0,
    meaningfulSteps: meaningful.map(s => ({ name: s.name, conclusion: s.conclusion })),
    guestExecutionProven: false,
  };
}
export async function collectEvidence(target, get) {
  const root = 'repos/' + REPOSITORY;
  const run = await get(root + '/actions/runs/' + target.runId);
  const jobs = await get(root + '/actions/runs/' + target.runId + '/attempts/' + target.attempt + '/jobs?per_page=100');
  const receipt = validateReceipt(run, jobs, target);
  const annotations = await get(root + '/check-runs/' + receipt.jobId + '/annotations?per_page=100');
  must(Array.isArray(annotations), 'annotation API response not an array');
  const providerAnnotations = annotations.map(a => ({
    level: shortText(a?.annotation_level), title: shortText(a?.title),
    message: shortText(a?.message),
  }));
  return { ...receipt, providerAnnotations, possibleMoreAnnotations: annotations.length === 100,
    sourceExportAuthorized: false };
}
export function githubReadOnlyGet(path) {
  // Only hard-coded repository paths produced by collectEvidence are allowed.
  must(/^repos\/ores-truffle-oreslang\/oreslang-platform-conformance\/(actions\/runs\/[1-9][0-9]*(?:\/attempts\/[1-9][0-9]*\/jobs\?per_page=100)?|check-runs\/[1-9][0-9]*\/annotations\?per_page=100)$/.test(path), 'API path must be read-only and in allowed source repository');
  return JSON.parse(execFileSync('gh', ['api', '--hostname', 'github.com', path],
    { encoding: 'utf8', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const target = parseTarget(process.argv.slice(2));
    const receipt = await collectEvidence(target, githubReadOnlyGet);
    console.log(JSON.stringify(receipt, null, 2));
    process.exitCode = receipt.preAllocationFailure ? 1 : 0;
  } catch (e) {
    console.error('RUNNER_ADMISSION_DIAGNOSTIC_DENIED: ' + e.message);
    process.exitCode = 2;
  }
}
