#!/usr/bin/env node
/**
 * Source-free conformance receipt classifier. Never authorizes UNTRUSTED,
 * release, merges, source export or OS sandbox placement. A self-reported
 * successful receipt is NOT authenticated evidence.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const contractPath = path.resolve(here, '../contracts/tenant-sandbox-evidence-v1.json');
const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const repoPrefix = 'ores-truffle-oreslang/oreslang-source.';
const backendNames = Object.freeze(['java','llvm','net','wasm','forge','rs','js','cranelift','hdl']);
const claims = Object.freeze(['host-model','compiler-guest','tenant-memory','process-fault']);
const kindFor = Object.freeze({
  'host-model':'host',
  'compiler-guest':'guest',
  'tenant-memory':'fault',
  'process-fault':'fault'
});
const validRuntime = new Set(['host-helper','js-worker','graal-context','graal-isolate','wasm-instance','native-sfi','os-process','microvm']);
const trustTiers = new Set(['trusted','constrained','untrusted']);
const has = (obj,key) => Object.prototype.hasOwnProperty.call(obj,key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function checkContract(contract) {
  if (!record(contract) || contract.schema !== 'attolang.tenant-sandbox-evidence/1')
    return ['invalid canonical contract'];
  if (!record(contract.backends) || Object.keys(contract.backends).length !== backendNames.length ||
      backendNames.some(name => !has(contract.backends,name) || contract.backends[name] !== repoPrefix + name))
    return ['contract backend registry is not canonical'];
  if (!Array.isArray(contract.proofOrder) ||
      contract.proofOrder.length !== claims.length ||
      claims.some((kind,index) => contract.proofOrder[index] !== kind))
    return ['contract proof order is not canonical'];
  const caseMap = {
    'host-model':['grant_foreign_actor','grant_foreign_tenant','grant_aba_reuse','grant_overlap','grant_overflow','grant_retirement'],
    'compiler-guest':['guest_load_cannot_bypass','guest_store_cannot_bypass','guest_ffi_pointer_escape_denied','guest_forged_capability_denied'],
    'tenant-memory':['corrupt_guest_cross_tenant_read_denied','corrupt_guest_cross_tenant_write_denied','tenant_executable_metadata_protected','tenant_stack_fault_contained','tenant_memory_quota_enforced','tenant_cpu_budget_enforced'],
    'process-fault':['host_filesystem_escape_denied','host_socket_escape_denied','host_fd_forgery_denied','native_crash_sibling_survives','descendant_processes_reaped','host_broker_survives']
  };
  if (!record(contract.requiredCases) || Object.keys(contract.requiredCases).length !== claims.length ||
      claims.some(claim => !Array.isArray(contract.requiredCases[claim]) ||
        contract.requiredCases[claim].length !== caseMap[claim].length ||
        caseMap[claim].some((id,index) => contract.requiredCases[claim][index] !== id)))
    return ['contract negative-case registry is not canonical'];
  return [];
}

/**
 * Validate a claim's shape ONLY. Even {shapeValid:true} is not a sandbox
 * result: there is no independent CI auth, binary attestation, or executed
 * exploit verification in this tool.
 */
export function inspectTenantSandboxEvidence(receipt, contract) {
  const errors = checkContract(contract);
  const result = () => ({
    shapeValid: errors.length === 0,
    errors,
    classification: errors.length ? 'REJECTED' : 'SELF_REPORTED_ONLY',
    independentlyVerified: false,
    promotionAllowed: false,
    untrustedPlacementAllowed: false
  });
  if (errors.length) return result();
  if (!record(receipt)) {
    errors.push('receipt must be an object');
    return result();
  }
  if (receipt.schema !== 'attolang.tenant-sandbox-evidence/1')
    errors.push('receipt schema mismatch');
  const backend = typeof receipt.backend === 'string' && has(contract.backends,receipt.backend)
    ? receipt.backend : null;
  if (backend === null) errors.push('unknown backend');
  else if (receipt.repository !== contract.backends[backend])
    errors.push('repository does not match registered backend');
  if (typeof receipt.sourceHead !== 'string' || !SHA40.test(receipt.sourceHead))
    errors.push('sourceHead requires lowercase full 40-hex SHA');
  if (!claims.includes(receipt.claim)) errors.push('invalid proof claim');
  if (backend === 'hdl' && receipt.claim !== 'host-model')
    errors.push('hdl has no guest actor execution; host-model only');

  const deployment = receipt.deployment;
  if (!record(deployment)) errors.push('deployment required');
  else {
    if (!trustTiers.has(deployment.trustTier)) errors.push('invalid trustTier');
    if (!validRuntime.has(deployment.runtime)) errors.push('invalid runtime mechanism');
    if (deployment.decision !== 'deny' && deployment.decision !== 'pending-independent-review')
      errors.push('offline receipts must never authorize deployment');
    if (deployment.trustTier === 'untrusted' && deployment.decision !== 'deny')
      errors.push('offline UNTRUSTED admission must be denied');
    if (receipt.claim === 'process-fault' &&
        deployment.runtime !== 'os-process' && deployment.runtime !== 'microvm')
      errors.push('process-fault requires OS process or microVM enforcement');
    if (receipt.claim === 'tenant-memory' &&
        ['host-helper','js-worker','graal-context'].includes(deployment.runtime))
      errors.push('host helper, JS Worker or Graal Context is not tenant-memory containment');
    if (receipt.claim === 'compiler-guest' && deployment.runtime === 'host-helper')
      errors.push('host helper is not a compiled guest');
  }
  const execution = receipt.execution;
  if (!record(execution)) errors.push('execution required');
  else {
    if (execution.kind !== 'github-actions' && execution.kind !== 'local')
      errors.push('unknown execution kind');
    if (execution.head !== receipt.sourceHead || !SHA40.test(execution.head))
      errors.push('execution head must be exact sourceHead');
    if (!Number.isSafeInteger(execution.executedSteps) || execution.executedSteps <= 0)
      errors.push('executedSteps must be positive; zero-step CI is NOT_EXECUTED');
    if (execution.conclusion !== 'success') errors.push('execution conclusion must be success');
    if (execution.kind === 'github-actions' &&
        (!Number.isSafeInteger(execution.runId) || execution.runId <= 0 ||
         !Number.isSafeInteger(execution.attempt) || execution.attempt <= 0 ||
         !Number.isSafeInteger(execution.jobId) || execution.jobId <= 0))
      errors.push('GitHub runId/attempt/jobId must be positive integers');
    if (execution.kind === 'local' && receipt.claim !== 'host-model')
      errors.push('local test report cannot promote compiler/tenant/process claims');
  }
  if (receipt.claim !== 'host-model' &&
      (typeof receipt.artifactSha256 !== 'string' || !SHA64.test(receipt.artifactSha256)))
    errors.push('guest or process proof requires target artifact SHA-256');
  if (receipt.claim === 'host-model' && receipt.artifactSha256 !== null)
    errors.push('host-model must have null artifactSha256');

  const tests = receipt.tests;
  if (!Array.isArray(tests)) errors.push('tests must be an array');
  else {
    const used = new Set();
    const target = claims.indexOf(receipt.claim);
    for (const item of tests) {
      if (!record(item) || typeof item.id !== 'string' || used.has(item.id)) {
        errors.push('malformed or duplicate test case');
        continue;
      }
      used.add(item.id);
      if (item.status !== 'passed') errors.push('test ' + item.id + ' not passed');
      const owner = claims.find(c => contract.requiredCases[c].includes(item.id));
      if (!owner) errors.push('unrecognized test ' + item.id);
      else if (item.mode !== kindFor[owner]) errors.push('test ' + item.id + ' has wrong execution mode');
    }
    if (target >= 0)
      for (let i = 0; i <= target; i++)
        for (const required of contract.requiredCases[claims[i]])
          if (!used.has(required)) errors.push('missing required adversarial case ' + required);
  }
  return result();
}

export function inspectFile(receiptPath, policyPath = contractPath) {
  return inspectTenantSandboxEvidence(
    JSON.parse(fs.readFileSync(receiptPath,'utf8')),
    JSON.parse(fs.readFileSync(policyPath,'utf8'))
  );
}
const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  if (!process.argv[2]) {
    console.error('usage: node bin/inspect-tenant-sandbox-evidence-v1.mjs RECEIPT.json [CONTRACT.json]');
    process.exit(64);
  }
  try {
    const value = inspectFile(process.argv[2],process.argv[3] || contractPath);
    console.log(JSON.stringify(value,null,2));
    if (!value.shapeValid) process.exitCode=1;
  } catch (error) {
    console.error('tenant sandbox evidence rejected:', error instanceof Error ? error.message : String(error));
    process.exitCode=1;
  }
}
