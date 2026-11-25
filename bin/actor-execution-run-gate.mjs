/**
 * Source-free actor lifecycle v1 GitHub Actions evidence triage.
 * Inputs must be obtained independently from GitHub's authenticated API;
 * this code never calls a network API and cannot authenticate its caller.
 * Passing this gate is NOT a guest-runtime attestation. A human or trusted
 * independent job-log verifier still has to check the pinned guest result.
 */
const HEX40 = /^[0-9a-f]{40}$/;
const SUPPORTED = new Set([
  'java-graalvm', 'llvm-native', 'wasm', 'forge',
  'net-native-aot', 'cranelift-native',
]);
function isId(v) {
  return Number.isSafeInteger(v) && v > 0;
}
function isNonempty(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * @returns {{stage:'infrastructure-blocked'|'execution-incomplete'|'candidate-only',
 *            blockers:string[],backend:string,head:string}}
 */
export function auditActorExecutionJob({backend, expectedHead, run, job} = {}) {
  if (!SUPPORTED.has(backend)) throw new TypeError('unknown actor backend');
  if (!HEX40.test(expectedHead || '')) throw new TypeError('expected PR head must be a lowercase Git SHA');
  const blockers = [];
  if (!run || typeof run !== 'object' || Array.isArray(run) ||
      !job || typeof job !== 'object' || Array.isArray(job)) {
    return {stage:'infrastructure-blocked', blockers:['missing GitHub run/job metadata'], backend, head:expectedHead};
  }
  const steps = Array.isArray(job.steps) ? job.steps : [];
  if (steps.length === 0) blockers.push('no job steps: runner admission failed or execution is unproven');
  if (!isId(job.runner_id) || !isNonempty(job.runner_name)) {
    blockers.push('no assigned runner identity');
  }
  if (blockers.length) return {stage:'infrastructure-blocked', blockers, backend, head:expectedHead};

  // A job with real steps and a failed test is an execution failure
  // candidate, NOT evidence that runner admission failed.
  if (run.head_sha !== expectedHead) blockers.push('run head SHA differs from pinned PR head');
  if (!isId(run.id) || !isId(job.id) || job.run_id !== run.id) {
    blockers.push('invalid or mismatched GitHub run/job identity');
  }
  if (run.status !== 'completed' || job.status !== 'completed') {
    blockers.push('workflow or job not completed');
  }
  if (run.conclusion !== 'success' || job.conclusion !== 'success') {
    blockers.push('workflow or job did not succeed');
  }
  const stepNumbers = new Set();
  let hadExecutedTest = false;
  for (const step of steps) {
    if (!step || !isId(step.number) || stepNumbers.has(step.number)) {
      blockers.push('invalid or duplicate job step number');
      continue;
    }
    stepNumbers.add(step.number);
    if (!isNonempty(step.name) || step.status !== 'completed' || step.conclusion !== 'success') {
      blockers.push('skipped, failed or incomplete workflow step');
    }
    if (/\b(test|ctest|cargo test|verify|execute|guest)\b/i.test(step.name) &&
        step.status === 'completed' && step.conclusion === 'success') {
      hadExecutedTest = true;
    }
  }
  if (!hadExecutedTest) blockers.push('no successful named execution/test step');
  if (blockers.length) return {stage:'execution-incomplete', blockers, backend, head:expectedHead};

  // Green CI steps alone do not prove this exact actor guest source ran.
  // Verify the compiled guest test selector, checkout tree and observed
  // output independently from actual logs before any parity promotion.
  return {stage:'candidate-only', blockers:[], backend, head:expectedHead};
}
