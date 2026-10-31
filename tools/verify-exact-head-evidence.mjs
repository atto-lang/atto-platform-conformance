#!/usr/bin/env node
// Source-free GitHub Actions metadata evaluator. Never certifies semantic parity.
import { openSync, closeSync, fstatSync, readSync, constants } from 'node:fs';
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
      run.repository?.full_name !== expected.repository || run.status !== 'completed' ||
      !isSha(run.head_sha)) {
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
    // Only a failed *workflow* can support an admission-failure diagnosis.
    // Cancelled, timed-out, skipped, neutral, action-required and missing
    // conclusions remain UNVERIFIED even if a job has no runner or steps.
    if (run.conclusion !== 'failure')
      return fail('workflow conclusion is not an executed failure');
    // Still inspect jobs to preserve the primary failure classification.
    if (!Array.isArray(jobs.jobs) || !Number.isSafeInteger(jobs.total_count) ||
        jobs.total_count !== jobs.jobs.length ||
        !jobs.jobs.every(j => j !== null && typeof j === 'object' && !Array.isArray(j)))
      return fail('incomplete or malformed job metadata');
    const selected = jobs.jobs.filter(j => j.name === expected.job_name);
    // Missing step metadata or a runner_id is not proof that no step ran.
    // A failed job can record actual compilation/guest failures even when its
    // runner metadata is unavailable. Only an explicit empty steps array
    // establishes the admission-only, zero-step classification.
    if (selected.length === 1 && isId(selected[0].id) &&
        selected[0].run_id === run.id && selected[0].run_attempt === run.run_attempt &&
        selected[0].head_sha === run.head_sha &&
        selected[0].status === 'completed' && selected[0].conclusion === 'failure' &&
        selected[0].runner_id === 0 &&
        Array.isArray(selected[0].steps) && selected[0].steps.length === 0) {
      return { classification: 'RUNNER_ADMISSION_FAILURE', reason: 'failed job with runner_id=0 and explicitly zero steps',
        run_id: run.id, attempt: run.run_attempt, job_id: selected[0].id ?? null };
    }
    return fail('workflow not successful');
  }
  if (!Array.isArray(jobs.jobs) || !Number.isSafeInteger(jobs.total_count) ||
      jobs.total_count !== jobs.jobs.length ||
      !jobs.jobs.every(j => j !== null && typeof j === 'object' && !Array.isArray(j)))
    return fail('incomplete or malformed job metadata');
  const selected = jobs.jobs.filter(j => j.name === expected.job_name);
  if (selected.length !== 1) return fail('selected job missing or ambiguous');
  const job = selected[0];
  if (!isId(job.id) || job.run_id !== run.id || job.run_attempt !== run.run_attempt ||
      job.head_sha !== run.head_sha) {
    return fail('job not bound to exact run attempt');
  }
  if (!Array.isArray(job.steps) ||
      !job.steps.every(s => s !== null && typeof s === 'object' && !Array.isArray(s)))
    return fail('job step metadata missing or invalid');
  if (job.steps.length === 0) {
    // An allegedly successful workflow with no executed steps has inconsistent
    // metadata. It is not a proven runner-admission failure or a CI pass.
    return fail('successful run contains a job with zero recorded steps');
  }
  // Incomplete runner metadata cannot override positive step evidence.
  if (!isId(job.runner_id)) return fail('runner identity missing for recorded steps');
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

// Offline input is still untrusted. Opening an attacker-supplied FIFO with
// readFileSync can hang evidence triage before any semantic checks run.
// Refuse non-regular files, final-component symlinks and overlarge bundles.
// This is not an authenticated GitHub receipt or a filesystem sandbox.
const MAX_EVIDENCE_BYTES = 256 * 1024;
export function readEvidenceBundle(filename) {
  if (typeof filename !== 'string' || filename.length === 0)
    throw Error('evidence path required');
  if (!Number.isInteger(constants.O_NOFOLLOW) || !Number.isInteger(constants.O_NONBLOCK))
    throw Error('safe evidence-file flags unavailable');
  const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW |
    constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_EVIDENCE_BYTES)
      throw Error('evidence must be a nonempty regular file <=256 KiB');
    const bytes = Buffer.alloc(MAX_EVIDENCE_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length < 1 || length > MAX_EVIDENCE_BYTES)
      throw Error('evidence file empty or exceeded 256 KiB');
    return JSON.parse(bytes.toString('utf8', 0, length));
  } finally {
    closeSync(fd);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw Error('usage: node tools/verify-exact-head-evidence.mjs <bundle.json>');
    const data = readEvidenceBundle(process.argv[2]);
    const result = evaluateEvidence(data);
    console.log(JSON.stringify(result, null, 2));
    if (result.classification !== 'EXECUTION_STEPS_RECORDED') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify(fail('input or JSON parse error: ' + error.message)));
    process.exitCode = 2;
  }
}
