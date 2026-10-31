#!/usr/bin/env node
// Source-free GitHub Actions metadata evaluator. Never certifies semantic parity.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const fail = (reason, details = {}) => ({ classification: 'UNVERIFIED', reason, ...details });
const isId = x => Number.isSafeInteger(x) && x > 0;
const isSha = x => typeof x === 'string' && SHA.test(x);

export function evaluateEvidence(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('invalid bundle');
  const { expected, commit, run, jobs, checkout } = input;
  if (!expected || !commit || !run || !jobs) return fail('incomplete bundle');
  if (!/^ores-truffle-oreslang\/[a-zA-Z0-9._-]+$/.test(expected.repository || '') ||
      !isSha(expected.head_sha) || !isSha(expected.tree_sha) ||
      !isId(expected.run_id) || !isId(expected.attempt) ||
      typeof expected.job_name !== 'string' || !expected.job_name.trim() ||
      !Array.isArray(expected.required_steps) || expected.required_steps.length === 0 ||
      new Set(expected.required_steps).size !== expected.required_steps.length ||
      !expected.required_steps.every(s => typeof s === 'string' && s.trim())) {
    return fail('invalid exact-source or required-step expectations');
  }
  if (commit.sha !== expected.head_sha || commit.commit?.tree?.sha !== expected.tree_sha) {
    return fail('commit SHA/tree mismatch');
  }
  if (run.id !== expected.run_id || run.run_attempt !== expected.attempt ||
      run.repository?.full_name !== expected.repository || run.status !== 'completed') {
    return fail('workflow run identity/status mismatch');
  }
  if (run.event !== 'pull_request' && run.event !== 'workflow_dispatch') {
    return fail('unsupported workflow event');
  }
  if (run.event === 'pull_request' && run.head_sha !== expected.head_sha) {
    return fail('PR workflow head mismatch');
  }
  if (run.event === 'workflow_dispatch') {
    // Dispatch runs normally have main's head_sha, not the target PR head.
    // A runner-produced checkout receipt is therefore mandatory.
    if (!checkout || checkout.run_id !== run.id || checkout.attempt !== run.run_attempt ||
        checkout.repository !== expected.repository || checkout.head_sha !== expected.head_sha ||
        checkout.tree_sha !== expected.tree_sha || !isId(checkout.job_id) ||
        !isId(checkout.step_number)) {
      return fail('manual dispatch lacks exact-tree checkout receipt');
    }
  }
  if (run.conclusion !== 'success') {
    // Still inspect jobs to preserve the primary failure classification.
    if (!Array.isArray(jobs.jobs) || !Number.isSafeInteger(jobs.total_count) ||
        jobs.total_count !== jobs.jobs.length) return fail('incomplete job pagination');
    const selected = jobs.jobs.filter(j => j.name === expected.job_name);
    if (selected.length === 1 && (!isId(selected[0].runner_id) ||
        !Array.isArray(selected[0].steps) || !selected[0].steps.length)) {
      return { classification: 'RUNNER_ADMISSION_FAILURE', reason: 'no assigned runner or executed steps',
        run_id: run.id, attempt: run.run_attempt, job_id: selected[0].id ?? null };
    }
    return fail('workflow not successful');
  }
  if (!Array.isArray(jobs.jobs) || !Number.isSafeInteger(jobs.total_count) ||
      jobs.total_count !== jobs.jobs.length) return fail('incomplete job pagination');
  const selected = jobs.jobs.filter(j => j.name === expected.job_name);
  if (selected.length !== 1) return fail('selected job missing or ambiguous');
  const job = selected[0];
  if (!isId(job.id) || job.run_id !== run.id || job.run_attempt !== run.run_attempt) {
    return fail('job not bound to exact run attempt');
  }
  if (!isId(job.runner_id) || !Array.isArray(job.steps) || !job.steps.length) {
    return { classification: 'RUNNER_ADMISSION_FAILURE', reason: 'no assigned runner or executed steps',
      run_id: run.id, attempt: run.run_attempt, job_id: job.id };
  }
  if (job.status !== 'completed' || job.conclusion !== 'success') return fail('target job not successful');
  const seen = new Set();
  for (const step of job.steps) {
    if (!isId(step.number) || seen.has(step.number)) return fail('missing or duplicate step number');
    seen.add(step.number);
  }
  if (run.event === 'workflow_dispatch' &&
      (checkout.job_id !== job.id ||
       !job.steps.some(s => s.number === checkout.step_number && s.conclusion === 'success'))) {
    return fail('checkout receipt not bound to successful job step');
  }
  for (const name of expected.required_steps) {
    const matched = job.steps.filter(s => s.name === name);
    if (matched.length !== 1 || matched[0].conclusion !== 'success' ||
        matched[0].status !== 'completed') return fail('required step missing/failed/ambiguous: ' + name);
  }
  return { classification: 'EXECUTION_STEPS_RECORDED',
    reason: 'metadata candidate only; independently inspect logs, checkout proof, artifacts and compiled guest output',
    run_id: run.id, attempt: run.run_attempt, job_id: job.id,
    head_sha: expected.head_sha, tree_sha: expected.tree_sha,
    semantic_parity_certified: false, source_transfer_authorized: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw Error('usage: node tools/verify-exact-head-evidence.mjs <bundle.json>');
    const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const result = evaluateEvidence(data);
    console.log(JSON.stringify(result, null, 2));
    if (result.classification !== 'EXECUTION_STEPS_RECORDED') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify(fail('input or JSON parse error: ' + error.message)));
    process.exitCode = 2;
  }
}
