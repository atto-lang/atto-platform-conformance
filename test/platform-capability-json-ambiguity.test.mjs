import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStrictJson } from '../bin/strict-receipt-json.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('accept canonical JSON with nested objects and escapes', () => {
  assert.deepEqual(parseStrictJson('{"outer":{"k":true},"array":[1,"hi\\u0020there",null]}'),
    {outer:{k:true},array:[1,'hi there',null]});
});

test('reject duplicate top-level keys even when values agree', () => {
  assert.throws(() => parseStrictJson('{"schema":1,"schema":1}'), /duplicate object key: schema/);
});

test('reject duplicate nested evidence keys with last-wins PASS camouflage', () => {
  const hostile = '{"evidence":{"executedSteps":0,"executedSteps":4}}';
  assert.equal(JSON.parse(hostile).evidence.executedSteps, 4); // old reader behavior
  assert.throws(() => parseStrictJson(hostile), /duplicate object key: executedSteps/);
});

test('normalize Unicode-escaped object keys before duplicate detection', () => {
  assert.throws(() => parseStrictJson('{"executedSteps":0,"ex\\u0065cutedSteps":4}'),
    /duplicate object key: executedSteps/);
  assert.throws(() => parseStrictJson('{"\\u0065xecutedSteps":0,"executedSteps":4}'),
    /duplicate object key: executedSteps/);
});

test('allow the same key at different nesting scopes', () => {
  assert.deepEqual(parseStrictJson('{"a":1,"child":{"a":2},"list":[{"a":3}]}'),
    {a:1,child:{a:2},list:[{a:3}]});
});

test('reject duplicate rule names inside alternate policy', () => {
  assert.throws(() => parseStrictJson('{"promotionRules":{"all":[],"all":[]}}'), /duplicate object key: all/);
});

test('reject oversize documents and deep-nesting denial inputs', () => {
  assert.throws(() => parseStrictJson(' '.repeat(1048577)), /size limit/);
  assert.throws(() => parseStrictJson('['.repeat(81)+'null'+']'.repeat(81)), /nesting limit/);
});

test('reject malformed escapes, incomplete syntax, trailing payload and trailing commas', () => {
  for (const bad of ['{"a":"\\x"}', '{"a":0,}', '{"a":0} true', '{"a":', '{"a":"x\ny"}', '{"a": 01}', '{"a":NaN}', '{}{}']) {
    assert.throws(() => parseStrictJson(bad), /ambiguous or invalid/);
  }
});

test('reject invalid input type',()=>{
  for(const input of [null,{},[],3,undefined])
    assert.throws(()=>parseStrictJson(input), /not text/);
});

const executable = fileURLToPath(new URL('../bin/verify-platform-capability-receipt.mjs', import.meta.url));
const contractText = readFileSync(new URL('../contracts/platform-capabilities-v1.json', import.meta.url), 'utf8');
const receipt = {
  schema: 'oreslang.platform-capability/1',
  platform: 'desktop',
  repository: 'ores-truffle-oreslang/oreslang-platform.desktop',
  sourceCommit: 'a'.repeat(40),
  stage: 'compiler-guest',
  evidence: {
    exactHead: true,
    executedSteps: 4,
    workflowConclusion: 'success',
    targetArtifactSha256: 'b'.repeat(64),
    abiLinked: true,
    hostReferenceOnly: false,
    compilerProduced: true,
    compilerSourceCommit: 'c'.repeat(40),
    compilerBinarySha256: 'd'.repeat(64),
  },
};

function runCli(rawReceipt, rawContract = contractText) {
  const directory = mkdtempSync(join(tmpdir(), 'atto-ambiguous-json-'));
  try {
    const receiptFile = join(directory, 'receipt.json');
    const contractFile = join(directory, 'contract.json');
    writeFileSync(receiptFile, rawReceipt);
    writeFileSync(contractFile, rawContract);
    const result = spawnSync(process.execPath, [executable, receiptFile, contractFile], {
      encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
    });
    assert.equal(result.error, undefined, 'CLI process failed to launch');
    assert.equal(result.signal, null, 'CLI was killed');
    return result;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('CLI keeps valid exact-schema receipts explicitly non-attesting', () => {
  const result = runCli(JSON.stringify(receipt));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SCHEMA_ONLY; NOT_AUTHENTICATED/);
});

test('CLI rejects duplicate workflow-step keys that JSON.parse silently promotes', () => {
  const text = JSON.stringify(receipt).replace('"executedSteps":4', '"executedSteps":0,"executedSteps":4');
  assert.equal(JSON.parse(text).evidence.executedSteps, 4);
  const result = runCli(text);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate object key: executedSteps/);
  assert.doesNotMatch(result.stdout, /PASS/);
});

test('CLI rejects escaped duplicate evidence and root schema keys', () => {
  const text = JSON.stringify(receipt);
  for (const forged of [
    text.replace('"executedSteps":4', '"ex\\u0065cutedSteps":0,"executedSteps":4'),
    text.replace('"schema":"oreslang.platform-capability/1"',
      '"schema":"oreslang.platform-capability/0","schema":"oreslang.platform-capability/1"'),
  ]) {
    const result = runCli(forged);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /duplicate object key:/);
  }
});

test('CLI rejects duplicate canonical contract keys or promotion rule entries', () => {
  const text = JSON.stringify(receipt);
  const variants = [
    contractText.replace('"schemaVersion": 1', '"schemaVersion": 0, "schemaVersion": 1'),
    contractText.replace('"all": [', '"all": [], "all": ['),
  ];
  for (const altered of variants) {
    assert.notEqual(altered, contractText, 'mutation precondition must hold');
    const result = runCli(text, altered);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /duplicate object key:/);
  }
});

test('CLI rejects oversized JSON before evaluating schema claims', () => {
  const result = runCli(JSON.stringify(receipt) + ' '.repeat(1048577));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JSON exceeds size limit/);
});
