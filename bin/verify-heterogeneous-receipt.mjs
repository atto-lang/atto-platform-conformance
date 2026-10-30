#!/usr/bin/env node
// Evidence shape/provenance checker, never a substitute for independently
// inspecting build logs, emitted artifacts, machine identity or timing proofs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = path.join(root, 'contracts/heterogeneous-compute-v1.json');
const contractSha256 = '464bddba8632d64b6c604d20f7ea93609d0929af2478ac23230f0a53541a2498';
const sha40 = /^[a-f0-9]{40}$/;
const sha64 = /^[a-f0-9]{64}$/;
const stages = ['compiler-checked', 'guest-executed', 'physical-hardware', 'deadline-verified'];
const own = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);

function parseBoundedJson(filename) {
  const fd = fs.openSync(filename, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (!Number.isSafeInteger(size) || size > 1024 * 1024) throw Error('JSON exceeds 1 MiB limit');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally {
    fs.closeSync(fd);
  }
}

export function loadCanonicalContract(filename = contractPath) {
  const raw = fs.readFileSync(filename);
  const actual = crypto.createHash('sha256').update(raw).digest('hex');
  if (actual !== contractSha256) throw Error('contract digest mismatch; v1 registry must not be weakened');
  return JSON.parse(raw.toString('utf8'));
}

export function verifyHeterogeneousReceipt(receipt, contract = loadCanonicalContract()) {
  const errors = [];
  const fail = message => errors.push(message);
  // A caller cannot supply a weaker contract by changing the stage or feature definitions.
  if (!object(contract) || JSON.stringify(contract) !== JSON.stringify(loadCanonicalContract())) {
    return { ok: false, errors: ['contract is incompatible with heterogeneous-compute v1'] };
  }
  if (!object(receipt)) return { ok: false, errors: ['receipt must be an object'] };
  if (receipt.schema !== 'oreslang.heterogeneous-evidence/1') fail('invalid receipt schema');
  if (!contract.backends.includes(receipt.backend)) fail('unknown backend');
  if (!sha40.test(receipt.sourceCommit ?? '')) fail('sourceCommit requires exact lower-case 40-digit SHA');
  if (!sha64.test(receipt.fixtureSha256 ?? '')) fail('fixtureSha256 requires 64-digit SHA-256');

  const feature = own(contract.features, receipt.feature) ? contract.features[receipt.feature] : null;
  if (!feature) fail('unknown feature');
  const stageIndex = stages.indexOf(receipt.stage);
  if (stageIndex < 0) fail('unknown stage');
  if (feature && stageIndex >= 0 && stageIndex < stages.indexOf(feature.minimumStage)) {
    fail(`feature ${receipt.feature} requires at least ${feature.minimumStage}`);
  }
  const e = receipt.evidence;
  if (!object(e)) return { ok: false, errors: [...errors, 'evidence must be an object'] };
  if (!sha40.test(e.compilerCommit ?? '')) fail('compilerCommit requires exact source revision');
  for (const k of ['compilerBinarySha256', 'sourceSha256', 'artifactSha256', 'testLogSha256']) {
    if (!sha64.test(e[k] ?? '')) fail(`${k} requires SHA-256`);
  }
  if (e.workflowConclusion !== 'success') fail('workflowConclusion must be success');
  if (!Number.isSafeInteger(e.executedSteps) || e.executedSteps <= 0) fail('executedSteps must be positive');
  if (e.compiledOresSource !== true) fail('must be compiled from actual .ores source');
  if (e.hostStub === true) fail('host stubs are not Oreslang evidence');
  if (e.fixturePassed !== true) fail('actual positive/negative fixture expectations must pass');
  if (!contract.targetClasses.includes(e.targetClass)) fail('unknown targetClass');
  if (feature && !feature.targets.includes(e.targetClass)) fail('targetClass not permitted for feature');

  // Dependency receipt references are consistency pointers, not evidence validation.
  // The CI aggregator must independently retrieve and verify their content and hashes.
  if (feature) {
    if (!Array.isArray(e.dependencies)) fail('dependencies must be an array');
    else {
      const want = new Set(feature.requires);
      const got = new Set();
      for (const d of e.dependencies) {
        if (!object(d) || typeof d.feature !== 'string' || !sha64.test(d.receiptSha256 ?? '')) {
          fail('each dependency needs feature and receiptSha256');
          continue;
        }
        if (!want.has(d.feature)) fail(`unexpected dependency ${d.feature}`);
        if (got.has(d.feature)) fail(`duplicate dependency ${d.feature}`);
        got.add(d.feature);
      }
      for (const name of want) if (!got.has(name)) fail(`missing dependency ${name}`);
    }
  }
  if (stageIndex >= 1 && (e.guestExecuted !== true || e.guestExitCode !== 0)) {
    fail('guest-executed and higher require real guest execution with exit 0');
  }
  if (stageIndex >= 2) {
    if (e.targetExecuted !== true || e.physicalHardware !== true) {
      fail('physical-hardware requires executed real target; simulator/emulator is insufficient');
    }
    if (typeof e.targetModel !== 'string' || e.targetModel.trim().length < 3 ||
        e.targetModel.length > 256) fail('physical-hardware requires identifiable targetModel');
    if (!sha64.test(e.hardwareRunSha256 ?? '')) fail('physical-hardware requires hardwareRunSha256');
  }
  if (stageIndex === 3) {
    if (typeof receipt.feature !== 'string' || !receipt.feature.startsWith('rt.')) fail('deadline-verified stage is reserved for real-time features');
    const t = e.timing;
    if (!object(t)) fail('deadline verification requires timing object');
    else {
      for (const k of ['deadlineUs', 'worstObservedUs', 'wcetBoundUs']) {
        if (!Number.isSafeInteger(t[k]) || t[k] <= 0) fail(`timing.${k} must be positive integer`);
      }
      if (Number.isSafeInteger(t.deadlineUs) && Number.isSafeInteger(t.wcetBoundUs) &&
          t.wcetBoundUs > t.deadlineUs) fail('WCET upper bound exceeds deadline');
      if (Number.isSafeInteger(t.deadlineUs) && Number.isSafeInteger(t.worstObservedUs) &&
          t.worstObservedUs > t.deadlineUs) fail('observed execution exceeded deadline');
      if (!sha64.test(t.wcetAnalysisSha256 ?? '')) fail('timing requires auditable WCET analysis artifact');
      if (!sha64.test(t.schedulabilityAnalysisSha256 ?? '')) fail('timing requires schedulability evidence');
      if (!sha64.test(t.interferenceAnalysisSha256 ?? '')) fail('timing requires interference evidence');
    }
  }
  return { ok: errors.length === 0, errors };
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  const input = process.argv[2];
  if (!input || process.argv.length > 3) {
    console.error('usage: verify-heterogeneous-receipt.mjs RECEIPT.json');
    process.exit(64);
  }
  try {
    const result = verifyHeterogeneousReceipt(parseBoundedJson(input));
    if (!result.ok) {
      for (const error of result.errors) console.error(`heterogeneous receipt: ${error}`);
      process.exit(1);
    }
    console.log('heterogeneous receipt: structurally valid (NOT independently authenticated)');
  } catch (error) {
    console.error(`heterogeneous receipt: ${error.message}`);
    process.exit(1);
  }
}
