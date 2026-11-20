#!/usr/bin/env node
// AttoXP M0: shape/policy validation ONLY. This does not authenticate execution.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const contract = JSON.parse(readFileSync(new URL('../contracts/atto-xp-ui-v1.json', import.meta.url), 'utf8'));
const s40 = /^[a-f0-9]{40}$/;
const s256 = /^[a-f0-9]{64}$/;
const targets = new Set(Object.keys(contract.initialTargets));
const stages = new Set(contract.stages);
const statuses = new Set(contract.resultStatuses);
const stagesThatNeedGuest = new Set(['atto-guest','simulator','physical-device']);
const stagesThatNeedTarget = new Set(['simulator','physical-device']);

function isObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function exactKeys(o, allowed, tag) {
  if (!isObject(o)) throw Error(`${tag}: object required`);
  const unexpected = Object.keys(o).filter(k => !allowed.includes(k));
  if (unexpected.length) throw Error(`${tag}: unsupported field ${unexpected[0]}`);
}
function need(v, msg) { if (!v) throw Error(msg); }
function isText(v) { return typeof v === 'string' && v.length > 0 && v.length <= 1024; }

// JSON.parse accepts duplicate keys; reject them before policy inspection.
export function parseStrictJSON(raw) {
  if (Buffer.isBuffer(raw)) raw = new TextDecoder('utf-8', {fatal:true}).decode(raw);
  need(typeof raw === 'string' && Buffer.byteLength(raw, 'utf8') <= 131072, 'receipt exceeds 128 KiB');
  const data = JSON.parse(raw);
  let i = 0;
  const ws = () => { while (/\s/.test(raw[i] ?? '') && i < raw.length) i++; };
  const quoted = () => {
    need(raw[i] === '"', 'expected JSON key/string');
    const start = i++;
    while (i < raw.length) {
      if (raw[i] === '\\') { i += 2; continue; }
      if (raw[i++] === '"') return JSON.parse(raw.slice(start, i));
    }
    throw Error('unterminated string');
  };
  const scan = depth => {
    need(depth <= 32, 'maximum JSON nesting exceeded');
    ws();
    if (raw[i] === '{') {
      i++; ws(); const keys = new Set();
      if (raw[i] === '}') { i++; return; }
      for (;;) {
        ws(); const key = quoted(); need(!keys.has(key), `duplicate JSON key: ${key}`);
        keys.add(key); ws(); need(raw[i++] === ':', 'expected colon');
        scan(depth + 1); ws();
        const sep = raw[i++]; if (sep === '}') return;
        need(sep === ',', 'expected comma in object');
      }
    }
    if (raw[i] === '[') {
      i++; ws(); if (raw[i] === ']') { i++; return; }
      for (;;) {
        scan(depth + 1); ws();
        const sep = raw[i++]; if (sep === ']') return;
        need(sep === ',', 'expected comma in array');
      }
    }
    if (raw[i] === '"') { quoted(); return; }
    while (i < raw.length && !/[\s,}\]]/.test(raw[i])) i++;
  };
  scan(0); ws(); need(i === raw.length, 'unexpected trailing data');
  return data;
}

export function checkReceipt(r) {
  exactKeys(r, ['contract','target','stage','status','adapter','source','run','artifact','compiler','results','device'], 'receipt');
  need(r.contract === contract.contract, 'contract/version mismatch');
  need(targets.has(r.target), 'unsupported target');
  need(stages.has(r.stage), 'unsupported stage');
  need(statuses.has(r.status), 'unsupported status');
  need(r.adapter === contract.initialTargets[r.target].adapter, 'incorrect native adapter for target');
  if (r.status !== 'PASS') {
    // Nonpass is a valid non-promoting state. No positive capability claims allowed.
    need(r.results === undefined && r.device === undefined, 'nonpass must not claim capabilities/device');
    return {valid:true, promotion:'NOT_PROMOTED', status:r.status, stage:r.stage};
  }
  exactKeys(r.source, ['repo','commit','tree','fixtureSha256'], 'source');
  need(isText(r.source.repo) && s40.test(r.source.commit) && s40.test(r.source.tree) && s256.test(r.source.fixtureSha256), 'source head/tree/fixture digests required');
  exactKeys(r.run, ['runId','attempt','executedSteps','jobName'], 'run');
  need(isText(r.run.runId) && Number.isSafeInteger(r.run.attempt) && r.run.attempt >= 1 && Number.isSafeInteger(r.run.executedSteps) && r.run.executedSteps >= 1 && isText(r.run.jobName), 'nonzero executed CI steps required');
  exactKeys(r.artifact, ['sha256','kind'], 'artifact');
  need(s256.test(r.artifact.sha256) && isText(r.artifact.kind), 'target artifact digest required');
  exactKeys(r.results, ['abiLinked','guestCompiled','guestExecuted','targetExecuted','hardwareExecuted','mainThreadSafe','negativeTestsPassed','outputSha256'], 'results');
  need(r.results.mainThreadSafe === true && r.results.negativeTestsPassed === true, 'native threading/security negatives must pass');
  need(typeof r.results.abiLinked === 'boolean' && typeof r.results.guestCompiled === 'boolean' && typeof r.results.guestExecuted === 'boolean' && typeof r.results.targetExecuted === 'boolean' && typeof r.results.hardwareExecuted === 'boolean', 'all capability booleans required');
  if (r.stage === 'reference-model') need(r.results.abiLinked === false, 'host model must not claim native ABI link');
  else need(r.results.abiLinked === true, 'ABI link proof required');
  if (stagesThatNeedGuest.has(r.stage)) {
    need(r.results.abiLinked && r.results.guestCompiled && r.results.guestExecuted && s256.test(r.results.outputSha256), 'real guest execution/output proof required');
    exactKeys(r.compiler, ['backend','sourceCommit','binarySha256'], 'compiler');
    need(r.compiler.backend === contract.initialTargets[r.target].compiler && s40.test(r.compiler.sourceCommit) && s256.test(r.compiler.binarySha256), 'compiler source and binary provenance required');
  } else {
    need(r.results.guestCompiled === false && r.results.guestExecuted === false && r.compiler === undefined && r.results.outputSha256 === undefined, 'host-only stages cannot claim compiler guest');
  }
  if (stagesThatNeedTarget.has(r.stage)) {
    need(r.results.targetExecuted === true, 'target runtime execution required');
    exactKeys(r.device, ['kind','osVersion','identifier'], 'device');
    need((r.stage === 'simulator' ? r.device.kind === 'simulator' : r.device.kind === 'physical') && isText(r.device.osVersion) && isText(r.device.identifier), 'target device evidence required');
  } else need(r.results.targetExecuted === false && r.device === undefined, 'target execution unsupported at stage');
  if (r.stage === 'physical-device') need(r.results.hardwareExecuted === true, 'hardware claim required');
  else need(r.results.hardwareExecuted === false, 'physical hardware claim invalid at stage');
  return {valid:true, promotion:'STRUCTURALLY_VALID_UNAUTHENTICATED', status:r.status, stage:r.stage};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    need(process.argv.length === 3, 'usage: node bin/verify-atto-xp-receipt.mjs <receipt.json>');
    const obj = parseStrictJSON(readFileSync(process.argv[2]));
    const result = checkReceipt(obj);
    console.log(JSON.stringify(result));
  } catch (e) {
    console.error(`AttoXP receipt rejected: ${e.message}`);
    process.exitCode = 2;
  }
}
