import test from 'node:test';
import assert from 'node:assert/strict';
import { checkReceipt, parseStrictJSON } from '../bin/verify-atto-xp-receipt.mjs';
import { readFileSync } from 'node:fs';

const m = JSON.parse(readFileSync(new URL('../contracts/atto-xp-ui-v1.json', import.meta.url), 'utf8'));
const H40 = 'a'.repeat(40), H64 = 'b'.repeat(64);
const base = () => ({
  contract:m.contract,target:'ios-arm64',stage:'reference-model',status:'PASS',adapter:'uikit',
  source:{repo:'atto-xp/atto-xp-core',commit:H40,tree:H40,fixtureSha256:H64},
  run:{runId:'123',attempt:1,executedSteps:13,jobName:'host-model'},
  artifact:{sha256:H64,kind:'host-reference'},
  results:{abiLinked:false,guestCompiled:false,guestExecuted:false,targetExecuted:false,hardwareExecuted:false,mainThreadSafe:true,negativeTestsPassed:true}
});
const modify = (fn) => { const r = structuredClone(base()); fn(r); return r; };
const guest = () => modify(r => {r.stage='atto-guest';r.results.abiLinked=true;r.results.guestCompiled=true;r.results.guestExecuted=true;r.results.outputSha256=H64;r.compiler={backend:'llvm',sourceCommit:H40,binarySha256:H64};r.artifact.kind='ios-native-app';});

test('contract is proposed and limited to two AOT mobile targets',()=>{
  assert.equal(m.status,'PROPOSED_NOT_IMPLEMENTED');
  assert.equal(m.languageSourceExtension,'.atto');
  assert.deepEqual(Object.keys(m.initialTargets),['ios-arm64','android-arm64']);
  assert.equal(m.negativeTests.length,18);
});
test('host baseline passes only as unverified structural receipt',()=>assert.equal(checkReceipt(base()).promotion,'STRUCTURALLY_VALID_UNAUTHENTICATED'));
test('explicit NOT_EXECUTED is never promoted',()=>assert.equal(checkReceipt({contract:m.contract,target:'ios-arm64',stage:'atto-guest',status:'NOT_EXECUTED',adapter:'uikit'}).promotion,'NOT_PROMOTED'));
test('rejects zero-step run',()=>assert.throws(()=>checkReceipt(modify(r=>r.run.executedSteps=0)),/nonzero/));
test('rejects string or unsafe numeric step count',()=>assert.throws(()=>checkReceipt(modify(r=>r.run.executedSteps='15')), /nonzero/));
test('rejects unpinned tree',()=>assert.throws(()=>checkReceipt(modify(r=>delete r.source.tree)),/digests/));
test('rejects missing fixture hash',()=>assert.throws(()=>checkReceipt(modify(r=>r.source.fixtureSha256='')),/digests/));
test('rejects cross-target native adapter',()=>assert.throws(()=>checkReceipt(modify(r=>r.adapter='android-view')),/adapter/));
test('rejects unsupported target',()=>assert.throws(()=>checkReceipt(modify(r=>r.target='ios-x86')),/target/));
test('rejects unsupported stage',()=>assert.throws(()=>checkReceipt(modify(r=>r.stage='production')),/stage/));
test('rejects unknown top-level claims',()=>assert.throws(()=>checkReceipt(modify(r=>r.promoted=true)),/unsupported field/));
test('rejects unknown source claims',()=>assert.throws(()=>checkReceipt(modify(r=>r.source.verified=true)),/unsupported field/));
test('rejects missing negative test outcomes',()=>assert.throws(()=>checkReceipt(modify(r=>r.results.negativeTestsPassed=false)),/negatives/));
test('rejects misleading host-only guest claim',()=>assert.throws(()=>checkReceipt(modify(r=>r.results.guestExecuted=true)),/host-only/));
test('guest receipt requires compiler provenance',()=>assert.throws(()=>checkReceipt(modify(r=>{r.stage='atto-guest';r.results.abiLinked=true;r.results.guestCompiled=true;r.results.guestExecuted=true;r.results.outputSha256=H64;})),/object required/));
test('real guest stage is structurally valid but unauthenticated',()=>assert.equal(checkReceipt(guest()).promotion,'STRUCTURALLY_VALID_UNAUTHENTICATED'));
test('simulator stage requires runtime execution and device',()=>assert.throws(()=>checkReceipt({...guest(),stage:'simulator'}),/target runtime execution/));
test('physical stage rejects emulator identity',()=>{const r=guest();r.stage='physical-device';r.results.targetExecuted=true;r.results.hardwareExecuted=true;r.device={kind:'simulator',osVersion:'18.0',identifier:'sim-1'};assert.throws(()=>checkReceipt(r),/device evidence/)});
test('simulator is not physical evidence',()=>{const r=guest();r.stage='simulator';r.results.targetExecuted=true;r.results.hardwareExecuted=true;r.device={kind:'simulator',osVersion:'18.0',identifier:'sim-1'};assert.throws(()=>checkReceipt(r),/hardware claim invalid/)});
test('physical requires positive hardware claim',()=>{const r=guest();r.stage='physical-device';r.results.targetExecuted=true;r.device={kind:'physical',osVersion:'18.0',identifier:'test-device'};assert.throws(()=>checkReceipt(r),/hardware claim required/)});
test('physical device structured receipt is not authenticated',()=>{const r=guest();r.stage='physical-device';r.results.targetExecuted=true;r.results.hardwareExecuted=true;r.device={kind:'physical',osVersion:'18.0',identifier:'test-device'};assert.equal(checkReceipt(r).promotion,'STRUCTURALLY_VALID_UNAUTHENTICATED')});
test('rejects duplicated top-level JSON object keys',()=>assert.throws(()=>parseStrictJSON('{"status":"PASS","status":"NOT_EXECUTED"}'),/duplicate JSON key/));
test('rejects duplicated nested keys even in arrays',()=>assert.throws(()=>parseStrictJSON('{"results":[{"a":1,"a":2}]}'),/duplicate JSON key/));
test('accepts a key repeated across different objects',()=>assert.deepEqual(parseStrictJSON('{"x":{"a":1},"y":{"a":2}}'),{x:{a:1},y:{a:2}}));
test('rejects oversized payload',()=>assert.throws(()=>parseStrictJSON(JSON.stringify({a:'x'.repeat(131072)})),/128 KiB/));
test('rejects excessive depth',()=>assert.throws(()=>parseStrictJSON('['.repeat(34)+'0'+']'.repeat(34)),/maximum JSON/));
test('rejects invalid JSON syntax',()=>assert.throws(()=>parseStrictJSON('{"a":}'),SyntaxError));
test('rejects nonpass claiming device evidence',()=>assert.throws(()=>checkReceipt({contract:m.contract,target:'ios-arm64',stage:'simulator',status:'FAIL',adapter:'uikit',device:{kind:'simulator'}}),/nonpass/));
test('rejects Android receipt with iOS adapter',()=>assert.throws(()=>checkReceipt({...base(),target:'android-arm64'}),/adapter/));

test('host evidence cannot claim a native ABI link', () =>
  assert.throws(() => checkReceipt(modify(r => r.results.abiLinked = true)), /host model must not claim native ABI/));
test('ABI-linked stage requires ABI link proof', () =>
  assert.throws(() => checkReceipt(modify(r => r.stage = 'abi-link')), /ABI link proof/));
test('host model cannot claim compiler output digest', () =>
  assert.throws(() => checkReceipt(modify(r => r.results.outputSha256 = H64)), /host-only/));
test('malformed UTF-8 input fails before receipt parsing', () =>
  assert.throws(() => parseStrictJSON(Buffer.from([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d])), /encoded|UTF-8/i));
test('valid UTF-8 input decodes without replacement', () =>
  assert.deepEqual(parseStrictJSON(Buffer.from('{"ok":true}')), {ok:true}));
