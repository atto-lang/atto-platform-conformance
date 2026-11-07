#!/usr/bin/env node
// Independent GitHub REST metadata read-back for scoped-local receipts.
// Does not attest compiler binary, log bytes, checkout inside the runner,
// guest execution, ownership correctness or cross-backend parity.
import { evaluateReceipt, evaluateSliceReceipt, readBoundedJson } from './verify-scoped-local-evidence.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const sha40 = /^[a-f0-9]{40}$/;
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const positiveInt = x => Number.isSafeInteger(x) && x > 0;

export async function auditGitHubReceipt(receipt, contract, {
  fetchImpl = fetch,
  token = '',
  allowPartial = false,
} = {}) {
  const shape = allowPartial ? evaluateSliceReceipt(receipt, contract)
    : evaluateReceipt(receipt, contract);
  const faults = [...shape.errors];
  const result = {
    backend: receipt?.backend ?? null,
    status: 'GITHUB_METADATA_NOT_VERIFIED',
    evidenceTrust: 'SELF_REPORTED_UNATTESTED',
    githubMetadataVerified: false,
    guestExecutionVerified: false,
    parityVerified: false,
    errors: faults,
  };
  if (faults.length) return result;
  if (!positiveInt(receipt.prNumber)) {
    faults.push('MISSING_PR_NUMBER'); return result;
  }
  if (!isObject(receipt.workflow) || !positiveInt(receipt.workflow.runId) ||
      !positiveInt(receipt.workflow.attempt) || !sha40.test(receipt.headSha)) {
    faults.push('INVALID_RUN_IDENTITY'); return result;
  }
  const repo = receipt.repository;
  // Repository is selected exclusively from a fixed allowlist in the shape
  // validator; do not accept an arbitrary URL / redirect from receipt JSON.
  if (!/^ores-truffle-oreslang\/oreslang-source\.(?:java|llvm|net|wasm|forge)$/.test(repo)) {
    faults.push('REPOSITORY_NOT_ALLOWLISTED'); return result;
  }
  const apiBase = `https://api.github.com/repos/${repo}`;
  const request = async suffix => {
    const response = await fetchImpl(apiBase + suffix, {
      method: 'GET', redirect: 'error', cache: 'no-store',
      headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? {'Authorization': `Bearer ${token}`} : {}),
      },
    });
    if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}`);
    return response.json();
  };
  let pr, commit, run, jobs;
  try {
    // Jobs endpoint pins the exact attempt; the ordinary runs/{id}/jobs
    // endpoint can mix or replace evidence after a retry.
    [pr, commit, run] = await Promise.all([
      request(`/pulls/${receipt.prNumber}`),
      request(`/git/commits/${receipt.headSha}`),
      request(`/actions/runs/${receipt.workflow.runId}`),
    ]);
    jobs = [];
    for (let page = 1; page <= 10; page++) {
      const part = await request(`/actions/runs/${receipt.workflow.runId}/attempts/${receipt.workflow.attempt}/jobs?per_page=100&page=${page}`);
      if (!Array.isArray(part.jobs) || !Number.isSafeInteger(part.total_count)) {
        faults.push('INVALID_GITHUB_JOBS_RESPONSE'); return result;
      }
      jobs.push(...part.jobs);
      if (jobs.length >= part.total_count) break;
      if (page === 10) {faults.push('UNBOUNDED_JOBS_PAGINATION');return result;}
    }
  } catch (error) {
    faults.push('GITHUB_READBACK_FAILED:' + String(error.message).slice(0,128));
    return result;
  }
  if (pr?.head?.sha !== receipt.headSha || pr?.base?.repo?.full_name !== repo ||
      pr?.number !== receipt.prNumber) faults.push('PR_EXACT_HEAD_MISMATCH');
  if (commit?.sha !== receipt.headSha || commit?.tree?.sha !== receipt.rootTreeSha)
    faults.push('GIT_TREE_MISMATCH');
  if (run?.id !== receipt.workflow.runId || run?.run_attempt !== receipt.workflow.attempt ||
      run?.repository?.full_name !== repo || run?.event !== 'pull_request' ||
      run?.status !== 'completed' || run?.conclusion !== 'success' ||
      !Array.isArray(run?.pull_requests) ||
      !run.pull_requests.some(p => p.number === receipt.prNumber))
    faults.push('RUN_ASSOCIATION_MISMATCH');
  const fetchedIds = new Set();
  for (const j of jobs) {
    if (!positiveInt(j.id) || fetchedIds.has(j.id)) faults.push('DUPLICATE_PROVIDER_JOB');
    fetchedIds.add(j.id);
  }
  const declared = receipt.workflow.jobs;
  for (const claimed of declared) {
    const actual = jobs.find(j => j.id === claimed.id);
    if (!actual || actual.run_id !== run.id || actual.run_attempt !== run.run_attempt ||
        actual.status !== 'completed' || actual.conclusion !== 'success' ||
        !positiveInt(actual.runner_id) || actual.runner_id !== claimed.runnerId ||
        !Array.isArray(actual.steps) || actual.steps.length === 0) {
      faults.push('JOB_READBACK_MISMATCH:' + claimed.id);
      continue;
    }
    if (claimed.steps.length !== actual.steps.length ||
        actual.steps.some((step, i) =>
          step.name !== claimed.steps[i]?.name ||
          step.conclusion !== 'success' || claimed.steps[i]?.conclusion !== 'success')) {
      faults.push('JOB_STEPS_READBACK_MISMATCH:' + claimed.id);
    }
  }
  const declaredJobIds = new Set(declared.map(j => j.id));
  // A positive/negative compile or guest run unconnected to an independently
  // checked job is merely an assertion in an untrusted JSON file.
  for (const scenario of receipt.scenarios) for (const check of scenario.checks) {
    if (!positiveInt(check.jobId) || !declaredJobIds.has(check.jobId))
      faults.push('UNBOUND_SCENARIO_JOB:' + scenario.id);
  }
  if (faults.length) return result;
  return {
    ...result,
    status: allowPartial ? 'GITHUB_METADATA_MATCH_PARTIAL_UNATTESTED'
      : 'GITHUB_METADATA_MATCH_GUEST_UNATTESTED',
    evidenceTrust: 'GITHUB_API_METADATA_ONLY',
    githubMetadataVerified: true,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 3 && !(process.argv.length===4 && process.argv[2]==='--slice'))
      throw new Error('usage: node bin/verify-scoped-local-github.mjs [--slice] RECEIPT.json');
    const contract = readBoundedJson(new URL('../contracts/scoped-locals-v1.json', import.meta.url));
    const partial = process.argv[2] === '--slice';
    const receipt = readBoundedJson(partial ? process.argv[3] : process.argv[2]);
    const report = await auditGitHubReceipt(receipt, contract, {
      token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '',
      allowPartial: partial,
    });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (!report.githubMetadataVerified) process.exitCode = 1;
  } catch (error) {
    process.stderr.write('SCOPED_LOCAL_GITHUB_INVALID: ' + error.message + '\n');
    process.exitCode = 2;
  }
}
