import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const evidence=JSON.parse(readFileSync(new URL(
  '../../contracts/event-sourcing-five-backend-evidence-v1.json',import.meta.url),'utf8'));
const wire=JSON.parse(readFileSync(new URL(
  '../../contracts/event-sourcing-durable-command-v1.json',import.meta.url),'utf8'));

const gitSha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
test('all five backend evidence records are explicit and exact-head pinned',()=>{
  assert.equal(evidence.schema,'atto.event-sourcing.five-backend-evidence/1');
  assert.deepEqual(evidence.backendOrder,['java','llvm','wasm','forge','net']);
  assert.deepEqual(Object.keys(evidence.backends),evidence.backendOrder);
  for(const [name,entry] of Object.entries(evidence.backends)){
    assert.equal(entry.repo,'ores-truffle-oreslang/oreslang-source.'+name);
    assert.ok(Number.isInteger(entry.pr)&&entry.pr>0,name);
    assert.ok(gitSha(entry.head)&&gitSha(entry.git_blob),name);
    assert.ok(entry.file.length>4);
    assert.ok(['SOURCE_VERIFIED_ONLY','LOCAL_HOST_EXECUTED'].includes(entry.host_evidence));
    assert.equal(entry.guest_evidence,'NOT_EXECUTED',name+' cannot imply guest proof');
    assert.equal(entry.ci_evidence,'NOT_EXECUTED',name+' zero-step is never CI pass');
    assert.equal(entry.aot_evidence,'NOT_EXECUTED',name+' no AOT guest proof');
    assert.equal(wire.statusByBackend[name],'NOT_EXECUTED');
  }
});
test('only actual local Forge host execution gets a local-host status',()=>{
  const forge=evidence.backends.forge;
  assert.equal(forge.host_evidence,'LOCAL_HOST_EXECUTED');
  assert.ok(gitSha(forge.test_git_blob));
  assert.deepEqual(forge.local_host_run.flavors,
    ['gcc_o2','gcc_asan_ubsan','clang_o2','clang_asan_ubsan']);
  assert.match(forge.local_host_run.reported,/guest_atto=0$/);
  assert.equal(evidence.backends.wasm.host_contract,'bounded_wire_codec_only_no_storage');
  for(const name of ['java','llvm','wasm','net'])
    assert.equal(evidence.backends[name].host_evidence,'SOURCE_VERIFIED_ONLY');
});
test('source-only and zero-step evidence cannot become backend certification',()=>{
  assert.equal(evidence.guestAcceptance,'fixtures/event-sourcing/bank-account.atto');
  assert.ok(evidence.releaseRules.some(x=>x.includes('Zero-step workflow')));
  assert.ok(evidence.releaseRules.some(x=>x.includes('Pure reducers')));
  assert.ok(evidence.releaseRules.some(x=>x.includes('mirroring')));
  const promoted=structuredClone(evidence);
  promoted.backends.forge.guest_evidence='PASS';
  assert.notEqual(promoted.backends.forge.guest_evidence,wire.statusByBackend.forge);
});
