#!/usr/bin/env node
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const defaultContract = path.resolve(directory, '../contracts/actor-service-v1.json');
const canonicalV1ContractSha256 = 'b52477b70f95df4a1613cdd1257f20dd7a69a6be31e65682de90a0be5b4d532b';
const sha40 = /^[a-f0-9]{40}$/;
const sha64 = /^[a-f0-9]{64}$/;
const repoName = /^ores-truffle-oreslang\/oreslang-source\.(java|llvm|net|wasm|forge|cranelift)$/;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const positive = v => Number.isSafeInteger(v) && v > 0;

function validateContract(contract) {
  // V1 is immutable: changing case/profile requirements requires a deliberate version bump.
  const digest = createHash('sha256').update(JSON.stringify(contract)).digest('hex');
  if (digest !== canonicalV1ContractSha256) return ['v1 contract registry or assertions were modified'];
  if (!object(contract) || contract.schemaVersion !== 1 || contract.contract !== 'oreslang.actor-service/1')
    return ['unsupported contract version'];
  const errors = [];
  if (!Array.isArray(contract.backends) || new Set(contract.backends).size !== 6 ||
      [...['java', 'llvm', 'net', 'wasm', 'forge', 'cranelift']].some(v => !contract.backends.includes(v)))
    errors.push('backend registry must match the canonical v1 set');
  if (!object(contract.cases) || !object(contract.profiles))
    return [...errors, 'missing case or profile registry'];
  for (const [id, c] of Object.entries(contract.cases)) {
    if (!/^[a-z0-9-]+$/.test(id) || !object(c) || typeof c.assertion !== 'string' || !c.assertion.trim())
      errors.push(`invalid case contract ${id}`);
  }
  const requiredProfiles = ['actor-core', 'networked-service', 'protected-faas', 'hard-realtime'];
  if (Object.keys(contract.profiles).length !== 4 || requiredProfiles.some(p => !own(contract.profiles,p)))
    errors.push('profile registry must match v1');
  for (const [profile, ids] of Object.entries(contract.profiles)) {
    if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length ||
        ids.some(id => typeof id !== 'string' || !own(contract.cases,id)))
      errors.push(`invalid or duplicate case in profile ${profile}`);
  }
  for (const [profile, parent] of [['networked-service','actor-core'], ['protected-faas','networked-service'], ['hard-realtime','actor-core']]) {
    const ids = contract.profiles[profile];
    const base = contract.profiles[parent];
    if (Array.isArray(ids) && Array.isArray(base) && base.some(id => !ids.includes(id)))
      errors.push(`${profile} must contain all ${parent} cases`);
  }
  return errors;
}

// This validator checks receipt SHAPE, not whether reported GitHub evidence is authentic.
// Promotion requires independent review of exact Git trees, actual jobs, logs and guest artifacts.
export function verifyActorServiceReceipt(receipt, contract) {
  const errors = validateContract(contract);
  if (errors.length) return {ok:false, errors};
  const fail = message => errors.push(message);
  if (!object(receipt)) return {ok:false, errors:['receipt must be a JSON object']};
  if (receipt.schema !== 'oreslang.actor-service/1') fail('wrong receipt schema');
  if (!contract.backends.includes(receipt.backend)) fail('unknown backend');
  if (receipt.repository !== `ores-truffle-oreslang/oreslang-source.${receipt.backend}` || !repoName.test(receipt.repository || ''))
    fail('repository/backend mismatch');
  const expected = contract.profiles[receipt.profile];
  if (!Array.isArray(expected)) fail('unknown profile');
  for (const [label, value, rx] of [
    ['sourceCommit',receipt.sourceCommit,sha40],
    ['sourceTree',receipt.sourceTree,sha40],
    ['compilerSourceCommit',receipt.compilerSourceCommit,sha40],
    ['compilerBinarySha256',receipt.compilerBinarySha256,sha64],
    ['guestArtifactSha256',receipt.guestArtifactSha256,sha64],
    ['fixtureSetSha256',receipt.fixtureSetSha256,sha64]
  ]) if (typeof value !== 'string' || !rx.test(value)) fail(`${label} must be a complete lowercase digest`);

  const ci = receipt.ci;
  if (!object(ci)) fail('missing CI provenance object');
  else {
    for (const key of ['runId','jobId','runnerId','executedSteps'])
      if (!positive(ci[key])) fail(`${key} must be a positive safe integer (no zero-step/pre-runner proof)`);
    if (ci.conclusion !== 'success' || ci.exactHead !== true) fail('successful exact-head CI execution required');
    if (typeof ci.workflowUrl !== 'string' || !/^https:\/\/github\.com\/ores-truffle-oreslang\/oreslang-source\.(java|llvm|net|wasm|forge|cranelift)\/actions\/runs\/[1-9][0-9]*$/.test(ci.workflowUrl) ||
        ci.workflowUrl !== `https://github.com/${receipt.repository}/actions/runs/${ci.runId}`)
      fail('workflow URL must match exact repository and run ID');
  }
  const guest = receipt.guest;
  if (!object(guest)) fail('missing guest execution evidence');
  else {
    if (guest.compiledFromOres !== true || guest.executedOnTarget !== true || guest.hostReferenceOnly !== false)
      fail('real compiled .ores target execution required; host stubs do not qualify');
    if (!positive(guest.executedCases) || (Array.isArray(expected) && guest.executedCases !== expected.length))
      fail('executedCases must equal registered profile case count');
    if (guest.failedCases !== 0 || guest.skippedCases !== 0 || guest.erroredCases !== 0)
      fail('no failed, skipped or errored guest cases permitted');
  }

  const rows = receipt.caseResults;
  if (!Array.isArray(rows)) fail('caseResults must be an array');
  else if (Array.isArray(expected)) {
    const actual = new Set();
    for (const row of rows) {
      if (!object(row) || typeof row.id !== 'string') { fail('invalid case row'); continue; }
      if (actual.has(row.id)) fail(`duplicate case ${row.id}`);
      actual.add(row.id);
      if (!expected.includes(row.id)) fail(`unexpected case ${row.id}`);
      if (row.result !== 'pass' || row.mode !== 'compiled-guest' || !positive(row.guestAssertions))
        fail(`case ${row.id} needs actual compiled-guest positive assertions`);
      if (typeof row.fixtureBlob !== 'string' || !sha40.test(row.fixtureBlob))
        fail(`case ${row.id} needs an exact fixture Git blob`);
      if (contract.cases[row.id]?.hostEvidence === true && (!positive(row.hostAssertions) ||
          typeof row.hostEvidenceSha256 !== 'string' || !sha64.test(row.hostEvidenceSha256)))
        fail(`case ${row.id} needs host instrumentation evidence and digest`);
    }
    for (const id of expected) if (!actual.has(id)) fail(`missing required case ${id}`);
  }

  if (receipt.profile === 'protected-faas') {
    const boundary = receipt.security;
    if (!object(boundary) || !['process','microvm'].includes(boundary.enforcedBoundary) ||
        boundary.ambientFilesystemDenied !== true || boundary.ambientNetworkDenied !== true ||
        boundary.tenantIdentityBound !== true)
      fail('protected FaaS requires an enforced process/microVM boundary and denied ambient effects');
  }
  if (receipt.profile === 'hard-realtime') {
    const rt = receipt.realtime;
    if (!object(rt) || rt.physicalHardware !== true || rt.jitDisabled !== true || rt.tracingGcDisabled !== true ||
        rt.admissionEnforced !== true || !positive(rt.deadlineNs) || !positive(rt.wcetUpperBoundNs) ||
        rt.wcetUpperBoundNs > rt.deadlineNs || !positive(rt.fixedMemoryBudgetBytes) ||
        !positive(rt.maxMailboxEntries) || typeof rt.analysisArtifactSha256 !== 'string' ||
        !sha64.test(rt.analysisArtifactSha256))
      fail('hard real-time requires physical target, bounded resources, admission and WCET analysis');
  }
  return {ok:errors.length===0, errors};
}

export function verifyFile(filename, contractFilename = defaultContract) {
  return verifyActorServiceReceipt(JSON.parse(fs.readFileSync(filename,'utf8')), JSON.parse(fs.readFileSync(contractFilename,'utf8')));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (!process.argv[2]) {
    console.error('usage: verify-actor-service-receipt.mjs RECEIPT.json [CONTRACT.json]');
    process.exitCode = 64;
  } else {
    try {
      const result = verifyFile(process.argv[2], process.argv[3]);
      if (!result.ok) {
        for (const error of result.errors) console.error(`actor-service receipt: ${error}`);
        process.exitCode = 1;
      } else {
        console.log('actor-service receipt: SHAPE VALID (NOT an independently verified parity/production claim)');
      }
    } catch (error) {
      console.error(`actor-service receipt: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
