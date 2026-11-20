#!/usr/bin/env node
// An evidence receipt is not an authenticated runner log or a guest test.
// This verifier only prevents weak metadata being promoted as five-backend parity.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const defaultContract = path.resolve(directory, '../contracts/http-native-v1.json');
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const BACKENDS = Object.freeze({
  java: 'ores-truffle-oreslang/oreslang-source.java',
  llvm: 'ores-truffle-oreslang/oreslang-source.llvm',
  wasm: 'ores-truffle-oreslang/oreslang-source.wasm',
  cranelift: 'ores-truffle-oreslang/oreslang-source.cranelift',
  net: 'ores-truffle-oreslang/oreslang-source.net',
});
const PROFILES = Object.freeze({
  java: ['jdk25-jvm', 'graalvm-native-aot'],
  llvm: ['llvm-native'],
  wasm: ['wasmtime-aot'],
  cranelift: ['cranelift-native'],
  net: ['net-native-aot'],
});
const CASES = Object.freeze([
  'http-mime-three-canonical', 'http-mime-deny-unsupported',
  'http-framing-conflicting-cl', 'http-framing-te-cl',
  'http-header-host-unique', 'http-route-method-exact',
  'http-body-16384-accepted', 'http-body-16385-denied',
  'http-slow-header-deadline', 'http-slow-body-deadline',
  'http-overload-explicit-503', 'http-dispatch-actor-failure',
  'http-drain-restart-quiescence', 'http-hot-generation-affinity',
]);
const own = (obj, prop) => Object.hasOwn(obj, prop);
const record = x => x && typeof x === 'object' && !Array.isArray(x);
const exactKeys = (v, keys) => record(v) && Object.keys(v).sort().join('|') === [...keys].sort().join('|');
const positive = x => Number.isSafeInteger(x) && x > 0;
const hex = (x, regex) => typeof x === 'string' && regex.test(x);

export function verifyHttpContract(contract) {
  const errors = [];
  if (!record(contract) || contract.schema !== 'oreslang.http-native-contract/1')
    return ['unknown HTTP contract schema'];
  if (!exactKeys(contract, ['schema', 'backends', 'profiles', 'cases'])) errors.push('contract keys changed');
  if (!exactKeys(contract.backends, Object.keys(BACKENDS))) errors.push('backend inventory changed');
  for (const [name, repository] of Object.entries(BACKENDS)) {
    if (contract.backends?.[name] !== repository) errors.push(`backend repo mismatch: ${name}`);
    if (!Array.isArray(contract.profiles?.[name]) ||
      JSON.stringify(contract.profiles[name]) !== JSON.stringify(PROFILES[name]))
      errors.push(`backend profiles changed: ${name}`);
  }
  if (!exactKeys(contract.profiles, Object.keys(PROFILES))) errors.push('profile inventory changed');
  if (!Array.isArray(contract.cases) || JSON.stringify(contract.cases) !== JSON.stringify(CASES))
    errors.push('contract cases differ from pinned v1');
  return errors;
}

export function contractDigest(contract) {
  return crypto.createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}

export function verifyHttpReceipt(receipt, contract) {
  const errors = verifyHttpContract(contract);
  if (errors.length) return { ok:false, qualified:false, errors };
  if (!record(receipt)) return { ok:false, qualified:false, errors:['receipt not object'] };
  const fail = message => errors.push(message);
  if (!exactKeys(receipt, ['schema','backend','repository','profile','stage','contractSha256','demoCommit','compilerCommit','evidence']))
    fail('receipt keys must match v1');
  if (receipt.schema !== 'oreslang.http-native-receipt/1') fail('receipt schema mismatch');
  if (typeof receipt.backend !== 'string' || !own(BACKENDS, receipt.backend)) fail('unknown backend');
  else {
    if (receipt.repository !== BACKENDS[receipt.backend]) fail('backend repository mismatch');
    if (!PROFILES[receipt.backend].includes(receipt.profile)) fail('backend profile mismatch');
  }
  if (receipt.contractSha256 !== contractDigest(contract)) fail('contract digest mismatch');
  if (!hex(receipt.demoCommit, SHA40)) fail('demoCommit invalid');
  if (!hex(receipt.compilerCommit, SHA40)) fail('compilerCommit invalid');
  if (!['unsupported','compiler-check','native-execution'].includes(receipt.stage)) fail('unknown stage');
  const e = receipt.evidence;
  if (receipt.stage === 'unsupported') {
    if (e !== null) fail('unsupported stage must not claim evidence');
    return {ok: errors.length===0, qualified:false, errors};
  }
  if (!record(e)) return {ok:false, qualified:false, errors:[...errors,'evidence must be object']};
  if (!exactKeys(e, ['workflowUrl','runId','runnerId','executedSteps','conclusion','exactHead','compilerBinarySha256','compilerChecked','guestExecuted','nativeGuestSteps','targetArtifactSha256','caseResults']))
    fail('evidence keys must match v1');
  if (typeof e.workflowUrl !== 'string' ||
      !/^https:\/\/github\.com\/ores-truffle-oreslang\/[a-zA-Z0-9._-]+\/actions\/runs\/[1-9][0-9]*$/.test(e.workflowUrl) ||
      !e.workflowUrl.startsWith(`https://github.com/${receipt.repository}/actions/runs/`) ||
      e.workflowUrl !== `https://github.com/${receipt.repository}/actions/runs/${e.runId}`)
    fail('run URL not bound to source repository and runId');
  if (!positive(e.runId) || !positive(e.runnerId) || !positive(e.executedSteps)) fail('zero-step, absent runner or invalid run');
  if (e.conclusion !== 'success' || e.exactHead !== true) fail('workflow not successful at exact head');
  if (!hex(e.compilerBinarySha256, SHA64) || !hex(e.targetArtifactSha256, SHA64))
    fail('compiler/target SHA256 missing');
  if (e.compilerChecked !== true) fail('compiler source check not proved');
  if (receipt.stage === 'compiler-check') {
    if (e.guestExecuted !== false || e.nativeGuestSteps !== 0 ||
        !Array.isArray(e.caseResults) || e.caseResults.length !== 0)
      fail('compiler-check stage must not claim HTTP execution');
    return {ok:errors.length===0,qualified:false,errors};
  }
  if (e.guestExecuted !== true || !positive(e.nativeGuestSteps)) fail('no native guest execution');
  if (!Array.isArray(e.caseResults) || e.caseResults.length !== CASES.length ||
      e.caseResults.some((result, i) => !exactKeys(result, ['id','result']) ||
        result.id !== CASES[i] || result.result !== 'pass'))
    fail('native HTTP case evidence incomplete/duplicate/failed');
  return {ok:errors.length===0,qualified:errors.length===0,errors};
}

export function verifyHttpParity(receipts, contract) {
  const errors=verifyHttpContract(contract);
  if (errors.length) return {ok:false,parity:false,errors};
  if (!Array.isArray(receipts)) return {ok:false,parity:false,errors:['receipts must be array']};
  const seen = new Set();
  let complete=0;
  for (const receipt of receipts) {
    if (!record(receipt)) {errors.push('invalid receipt entry');continue;}
    if (seen.has(receipt.backend)) errors.push(`duplicate backend receipt: ${receipt.backend}`);
    seen.add(receipt.backend);
    const check=verifyHttpReceipt(receipt,contract);
    errors.push(...check.errors.map(e=>`${String(receipt.backend)}: ${e}`));
    if (check.qualified) complete++;
  }
  for (const backend of Object.keys(BACKENDS)) {
    if (!seen.has(backend)) errors.push(`missing backend receipt: ${backend}`);
  }
  return {ok:errors.length===0,parity:errors.length===0 && complete===Object.keys(BACKENDS).length,errors};
}

const called = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url;
if (called) {
  try {
    if (process.argv.length !== 3) throw Error('usage: verify-http-native-receipts.mjs REPORT.json');
    const contract=JSON.parse(fs.readFileSync(defaultContract,'utf8'));
    const receipts=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
    const check=verifyHttpParity(receipts,contract);
    if (!check.parity) {
      console.error('HTTP_NATIVE_PARITY_NOT_ATTESTED');
      for (const error of check.errors) console.error(error);
      if (check.ok) console.error('valid receipts but unsupported or compiler-only backend');
      process.exitCode=1;
    } else console.log('HTTP_NATIVE_PARITY_RECEIPTS_VALID (independent runtime attestation still required)');
  } catch (error) {
    console.error('HTTP_NATIVE_PARITY_NOT_ATTESTED', error.message);
    process.exitCode=1;
  }
}
