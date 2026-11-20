// Source-free GitHub Actions capacity admission. This does not authorize private exports.
// Usage: GH_TOKEN=... node tools/check-carrier-admission.mjs owner/repo <repo-id> 123456 <head-sha> <workflow-path> <workflow-blob-sha> <job-name>
import { pathToFileURL } from 'node:url';
import {CANARY_PATH, CANARY_JOB, CANARY_STEP, CANARY_BLOB_SHA, verifyCanonicalCarrierWorkflow} from './canonical-carrier-workflow.mjs';

export class AdmissionFailure extends Error {
  constructor(reason) { super(reason); this.name = 'AdmissionFailure'; }
}
function requireGate(ok, reason) { if (!ok) throw new AdmissionFailure(reason); }
const SHA = /^[a-f0-9]{40}$/;
const REPO = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const POSITIVE = n => Number.isSafeInteger(n) && n > 0;
function absoluteTime(value) { const n = Date.parse(value); return Number.isFinite(n) ? n : NaN; }

export function assessAdmission({ repository, run, jobs, workflow, expected, now = Date.now() }) {
  requireGate(REPO.test(expected.repo), 'invalid expected repository');
  requireGate(POSITIVE(expected.repoId), 'immutable destination repository ID required');
  requireGate(SHA.test(expected.headSha), 'invalid expected head SHA');
  requireGate(SHA.test(expected.workflowBlobSha), 'invalid approved workflow blob');
  requireGate(expected.workflowPath === CANARY_PATH && expected.jobName === CANARY_JOB &&
    expected.proofStep === CANARY_STEP && expected.workflowBlobSha === CANARY_BLOB_SHA,
    'canary does not use the reviewed canonical source-free workflow');
  requireGate(expected.workflowPath.startsWith('.github/workflows/') && expected.workflowPath.endsWith('.yml'), 'bad workflow path');
  requireGate(typeof expected.jobName === 'string' && expected.jobName.length > 0, 'job name required');
  requireGate(repository?.full_name === expected.repo && repository.archived === false, 'destination repository is missing, archived or mismatched');
  requireGate(POSITIVE(repository.id), 'destination immutable repository ID missing');
  requireGate(repository.id === expected.repoId, 'destination repository ID changed');
  requireGate(repository.private === true && repository.visibility === 'private',
    'private-source carrier must be a private repository');
  requireGate(run?.repository?.full_name === expected.repo && run.repository.id === repository.id, 'run repository mismatch');
  requireGate(run.repository.private === true, 'run repository is not private');
  requireGate(POSITIVE(run.id) && run.id === expected.runId, 'run ID mismatch');
  requireGate(run.head_sha === expected.headSha, 'run head does not match approved source-free canary');
  requireGate(run.path === expected.workflowPath, 'run uses a different workflow');
  requireGate(run.status === 'completed' && run.conclusion === 'success', 'run not successful');
  const age = now - absoluteTime(run.created_at);
  requireGate(Number.isFinite(age) && age >= 0 && age <= 60 * 60 * 1000, 'canary is older than one hour or future dated');
  requireGate(POSITIVE(run.run_attempt), 'no authenticated run attempt');
  requireGate(run.event === 'push' || run.event === 'workflow_dispatch', 'invalid canary trigger');
  requireGate(workflow?.sha === expected.workflowBlobSha, 'workflow not pinned to approved Git blob');
  requireGate(workflow?.path === expected.workflowPath, 'fetched workflow path mismatch');
  try { verifyCanonicalCarrierWorkflow(workflow, expected.workflowBlobSha); }
  catch { throw new AdmissionFailure('unapproved or altered source-free workflow content'); }
  requireGate(Array.isArray(jobs) && jobs.length >= 1, 'no jobs');
  const matching = jobs.filter(j => j.name === expected.jobName);
  requireGate(matching.length === 1, 'missing or duplicated named canary job');
  const job = matching[0];
  requireGate(POSITIVE(job.id) && job.run_id === run.id, 'job ID or parent run mismatched');
  requireGate(job.run_attempt === run.run_attempt, 'stale job attempt');
  requireGate(job.head_sha == null || job.head_sha === expected.headSha, 'job head mismatched');
  requireGate(job.status === 'completed' && job.conclusion === 'success', 'job not successful');
  requireGate(POSITIVE(job.runner_id) && typeof job.runner_name === 'string' && job.runner_name.trim(), 'no assigned runner');
  requireGate(absoluteTime(job.started_at) >= 0 && absoluteTime(job.completed_at) >= absoluteTime(job.started_at), 'no chronological execution');
  requireGate(Array.isArray(job.steps) && job.steps.length >= 1, 'no executed steps');
  const completed = job.steps.filter(step => step?.status === 'completed' && step.conclusion === 'success');
  requireGate(completed.length === job.steps.length, 'incomplete or failing steps');
  requireGate(completed.some(step => step.name === expected.proofStep), 'proof step did not execute');
  requireGate(!completed.some(step => /checkout/i.test(step.name)), 'source-free canary unexpectedly checks out code');
  return Object.freeze({ admitted: true, repo: expected.repo, repo_id: repository.id,
    canary_sha: run.head_sha, workflow_blob_sha: workflow.sha, run_id: run.id,
    run_attempt: run.run_attempt, job_id: job.id, runner_id: job.runner_id,
    successful_step_count: completed.length, proof_step: expected.proofStep,
    classification: 'SOURCE_FREE_CAPACITY_ONLY_NOT_COMPILER_PARITY' });
}

// No secrets printed. API endpoints are built from independently validated repo + numeric IDs.
export async function checkLiveAdmission(expected, { token, fetchImpl = fetch, now = Date.now() } = {}) {
  requireGate(token && typeof token === 'string', 'GH_TOKEN or GITHUB_TOKEN required for private repositories');
  requireGate(REPO.test(expected.repo), 'invalid expected repository');
  requireGate(POSITIVE(expected.repoId), 'immutable destination repository ID required');
  requireGate(POSITIVE(expected.runId), 'run ID required');
  requireGate(SHA.test(expected.headSha), 'expected SHA must be 40 lowercase hex');
  requireGate(SHA.test(expected.workflowBlobSha), 'expected workflow blob must be 40 lowercase hex');
  requireGate(expected.workflowPath === CANARY_PATH && expected.jobName === CANARY_JOB &&
    expected.proofStep === CANARY_STEP && expected.workflowBlobSha === CANARY_BLOB_SHA,
    'noncanonical canary expected fields: refusing API request');
  const base = 'https://api.github.com/repos/' + expected.repo;
  async function get(url) {
    const res = await fetchImpl(url, { headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }, redirect: 'error' });
    requireGate(res.ok, 'GitHub API status ' + res.status + ' for ' + new URL(url).pathname);
    return res.json();
  }
  const repository = await get(base);
  const run = await get(base + '/actions/runs/' + expected.runId);
  // More than 100 jobs would need explicit pagination and is not an acceptable tiny canary.
  const page = await get(base + '/actions/runs/' + expected.runId + '/jobs?per_page=100&filter=latest');
  requireGate(page.total_count >= 1 && page.total_count <= 100 && page.jobs?.length === page.total_count,
    'incomplete canary job page');
  const jobHeaders = page.jobs.filter(j => j.name === expected.jobName);
  requireGate(jobHeaders.length === 1 && POSITIVE(jobHeaders[0].id), 'named job missing');
  const job = await get(base + '/actions/jobs/' + jobHeaders[0].id);
  const workflow = await get(base + '/contents/' + expected.workflowPath + '?ref=' + expected.headSha);
  return assessAdmission({ repository, run, jobs: [job], workflow, expected, now });
}

const invokedAsCLI = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsCLI) {
  const [repo, repoIdText, runIdText, headSha, workflowPath, workflowBlobSha, jobName, proofStep = 'ADMISSION_PROOF'] = process.argv.slice(2);
  const runId = Number(runIdText);
  const expected = {repo, repoId: Number(repoIdText), runId, headSha, workflowPath, workflowBlobSha, jobName, proofStep};
  checkLiveAdmission(expected, {token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN})
    .then(value => { console.log(JSON.stringify(value, null, 2)); })
    .catch(error => { console.error('ADMISSION_DENIED: ' + error.message); process.exitCode = 1; });
}
