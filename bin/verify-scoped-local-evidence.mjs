#!/usr/bin/env node
/**
 * AttoLang scoped-local evidence *shape* validator, not a trusted attestation.
 * No runner, compiler or guest is invoked by this script.
 */
import { openSync, readSync, fstatSync, closeSync, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const sha40 = /^[a-f0-9]{40}$/;
const sha256 = /^[a-f0-9]{64}$/;
const backends = Object.freeze({
  java: 'ores-truffle-oreslang/oreslang-source.java',
  llvm: 'ores-truffle-oreslang/oreslang-source.llvm',
  net: 'ores-truffle-oreslang/oreslang-source.net',
  wasm: 'ores-truffle-oreslang/oreslang-source.wasm',
  forge: 'ores-truffle-oreslang/oreslang-source.forge',
});
const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const int = n => Number.isSafeInteger(n) && n >= 0;
const truthyString = x => typeof x === 'string' && x.length > 0 && x.length <= 512;

export function evaluateReceipt(receipt, contract) {
  const errors = [];
  const fail = (code, context = '') => errors.push(context ? code+':'+context : code);
  if (!isObj(receipt)) return {status:'INVALID_RECEIPT',errors:['NOT_OBJECT'],covered:0,total:0};
  if (!isObj(contract) || !Array.isArray(contract.scenarios) || contract.status !== 'candidate-unattested')
    return {status:'INVALID_CONTRACT',errors:['CONTRACT_INVALID'],covered:0,total:0};
  const target = backends[receipt.backend];
  if (receipt.schema !== 'attolang.scoped-local-evidence/1') fail('SCHEMA');
  if (!target || !contract.backendTargets?.includes(receipt.backend)) fail('UNKNOWN_BACKEND');
  if (receipt.repository !== target) fail('REPOSITORY_MISMATCH');
  for (const field of ['headSha','rootTreeSha','checkedOutSha'])
    if (!sha40.test(receipt[field] ?? '')) fail('MISSING_GIT_ID',field);
  if (receipt.checkedOutSha !== receipt.headSha) fail('NOT_EXACT_HEAD');
  if (!isObj(receipt.compiler) || !sha256.test(receipt.compiler.binarySha256 ?? '') ||
      !sha40.test(receipt.compiler.sourceHeadSha ?? '') ||
      receipt.compiler.sourceHeadSha !== receipt.headSha ||
      !truthyString(receipt.compiler.toolchain)) fail('UNBOUND_COMPILER');
  const workflow = receipt.workflow;
  let admissionFailed = false;
  if (!isObj(workflow) || !int(workflow.runId) || workflow.runId === 0 ||
      !int(workflow.attempt) || workflow.attempt === 0 ||
      workflow.headSha !== receipt.headSha || !Array.isArray(workflow.jobs) ||
      workflow.jobs.length === 0) fail('WORKFLOW_PROVENANCE');
  else {
    const ids = new Set();
    for (const job of workflow.jobs) {
      if (!isObj(job) || !int(job.id) || job.id === 0 || ids.has(job.id)) {
        fail('INVALID_JOB_ID');continue;
      }
      ids.add(job.id);
      if (!Array.isArray(job.steps) || job.steps.length === 0 ||
          !int(job.runnerId) || job.runnerId === 0) {
        admissionFailed = true;fail('RUNNER_ADMISSION_FAILURE',String(job.id));continue;
      }
      if (job.conclusion !== 'success') fail('JOB_NOT_SUCCESS',String(job.id));
      if (job.steps.some(step => !isObj(step) || !truthyString(step.name) ||
          step.conclusion !== 'success')) fail('STEP_NOT_SUCCESS',String(job.id));
    }
  }
  const scenarios = new Map();
  for (const s of contract.scenarios) {
    if (!isObj(s) || !truthyString(s.id) ||
        !['compile','runtime','guest-runtime','compile-and-runtime'].includes(s.kind) ||
        scenarios.has(s.id)) fail('INVALID_CONTRACT_SCENARIOS');
    else scenarios.set(s.id,s.kind);
  }
  const found = new Set();
  let covered = 0;
  if (!Array.isArray(receipt.scenarios)) fail('MISSING_SCENARIOS');
  else for (const record of receipt.scenarios) {
    if (!isObj(record) || !truthyString(record.id)) {fail('INVALID_SCENARIO');continue;}
    const kind = scenarios.get(record.id);
    if (!kind) {fail('UNKNOWN_SCENARIO',record.id);continue;}
    if (found.has(record.id)) {fail('DUPLICATE_SCENARIO',record.id);continue;}
    found.add(record.id);
    const initial = errors.length;
    if (record.kind !== kind) fail('SCENARIO_KIND_MISMATCH',record.id);
    if (!Array.isArray(record.checks) || !record.checks.length) {fail('NO_EXECUTED_CHECKS',record.id);continue;}
    const phases = new Set();
    for (const check of record.checks) {
      if (!isObj(check) || !['compile-positive','compile-negative','guest-run'].includes(check.phase)) {
        fail('BAD_CHECK_PHASE',record.id);continue;
      }
      if (phases.has(check.phase)) fail('DUPLICATE_CHECK_PHASE',record.id);
      phases.add(check.phase);
      if (check.executed !== true || !int(check.assertions) || check.assertions === 0 ||
          !sha256.test(check.logSha256 ?? '') || !sha256.test(check.fixtureSha256 ?? ''))
        fail('NO_EXECUTION_RECEIPT',record.id);
      if (check.phase === 'compile-negative') {
        if (check.exitCode !== 1 || !truthyString(check.diagnostic) ||
            check.stdoutBytes !== 0 || !Array.isArray(check.artifacts) || check.artifacts.length !== 0)
          fail('INVALID_SEMANTIC_REJECTION',record.id);
      } else {
        if (check.exitCode !== 0 || !sha256.test(check.artifactSha256 ?? ''))
          fail('NO_SUCCESSFUL_ARTIFACT',record.id);
      }
    }
    if (kind === 'compile') {
      if (!phases.has('compile-negative') && !phases.has('compile-positive'))
        fail('MISSING_COMPILE',record.id);
    } else {
      if (!phases.has('compile-positive') || !phases.has('guest-run'))
        fail('MISSING_COMPILED_GUEST',record.id);
      if (kind === 'compile-and-runtime' && !phases.has('compile-negative'))
        fail('MISSING_NEGATIVE_COMPILER_CONTROL',record.id);
    }
    if (errors.length === initial) covered++;
  }
  for (const scenario of scenarios.keys())
    if (!found.has(scenario)) fail('MISSING_SCENARIO',scenario);
  // A JSON self-report cannot establish checkout/build/runner identity by itself.
  // Deliberately no VERIFIED/PARITY_PASS outcome, even if structurally complete.
  return {
    status: admissionFailed ? 'RUNNER_ADMISSION_FAILURE'
      : errors.length ? 'UNVERIFIED_INCOMPLETE'
      : 'CANDIDATE_FOR_INDEPENDENT_REVIEW',
    evidenceTrust:'SELF_REPORTED_UNATTESTED',
    parityVerified:false,
    backend:receipt.backend,
    covered,total:scenarios.size,
    errors,
  };
}

function readBoundedJson(path) {
  // Reject symlinks, devices, pipes, and excess bytes before parsing.
  // The extra one-byte read detects a regular file growing after fstat.
  const max = 2*1024*1024;
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) |
                (constants.O_NONBLOCK ?? 0);
  const fd = openSync(path, flags);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0 || stat.size > max)
      throw new Error('invalid evidence file type or size');
    const bytes = Buffer.alloc(stat.size);
    let used = 0;
    while (used < bytes.length) {
      const n = readSync(fd, bytes, used, bytes.length-used, used);
      if (n <= 0) throw new Error('evidence file truncated during read');
      used += n;
    }
    const extra = Buffer.alloc(1);
    if (readSync(fd, extra, 0, 1, used) !== 0)
      throw new Error('evidence file grew during read');
    return JSON.parse(bytes.toString('utf8'));
  } finally {
    closeSync(fd);
  }
}

export function evaluateBatch(receipts, contract) {
  const results = receipts.map(r=>evaluateReceipt(r,contract));
  const seen = new Set();
  for (const r of results) {
    if (seen.has(r.backend)) r.errors.push('DUPLICATE_BACKEND');
    seen.add(r.backend);
  }
  return {
    status: results.some(r=>r.status==='RUNNER_ADMISSION_FAILURE') ? 'RUNNER_ADMISSION_FAILURE'
      : results.some(r=>r.errors.length) ? 'UNVERIFIED_INCOMPLETE'
      : receipts.length===5 && Object.keys(backends).every(b=>seen.has(b))
        ? 'FIVE_BACKEND_CANDIDATE_FOR_INDEPENDENT_REVIEW'
        : 'PARTIAL_BACKEND_CANDIDATE_FOR_INDEPENDENT_REVIEW',
    parityVerified:false,
    evidenceTrust:'SELF_REPORTED_UNATTESTED',
    results,
  };
}

const invoked = process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url);
if (invoked) {
  try {
    if (process.argv.length < 3) throw new Error('usage: node bin/verify-scoped-local-evidence.mjs RECEIPT.json [RECEIPT.json ...]');
    const contract = readBoundedJson(new URL('../contracts/scoped-locals-v1.json',import.meta.url));
    const report = evaluateBatch(process.argv.slice(2).map(readBoundedJson),contract);
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
    if (report.results.some(x=>x.errors.length)) process.exitCode=1;
  } catch (error) {
    process.stderr.write('SCOPED_LOCAL_EVIDENCE_INVALID: '+error.message+'\n');
    process.exitCode=2;
  }
}
