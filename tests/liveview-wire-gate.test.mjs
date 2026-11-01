import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateVectors,validateReceipt,validateSixBackendReceipt,gitBlob,FIXTURE_BLOB,BACKENDS,SIX_BACKENDS} from '../src/liveview-wire-receipts.mjs';
const raw=readFileSync(new URL('../contracts/v1/ores-liveview-wire-v1.json',import.meta.url),'utf8');
const fixture=JSON.parse(raw);
const clone=x=>structuredClone(x);
function fake(){
  return {schema:'ores-liveview-wire-backend-receipt-v1',fixture_blob:FIXTURE_BLOB,
    backends:BACKENDS.map(backend=>({
      backend,repository:'ores-truffle-oreslang/oreslang-source.'+backend,
      head_sha:'a'.repeat(40),tree_sha:'b'.repeat(40),profile:'native',
      runner:{run_id:1,job_id:2,runner_id:3,step_count:4,head_sha:'a'.repeat(40)},
      guest:{kind:'native-oreslang-guest',compiled:true,executed:true,binary_sha256:'c'.repeat(64)},
      results:fixture.cases.map(c=>({case_id:c.id,actual:c.error_code?{close_code:c.error_code}:{messages:c.expected}}))
    }))};
}
test('canonical registry has immutable Git blob, 41 unique classified vectors',()=>{
  assert.equal(gitBlob(raw),FIXTURE_BLOB);
  assert.equal(validateVectors(fixture,raw).vector_count,41);
  assert.equal(new Set(fixture.cases.map(c=>c.id)).size,41);
});
test('a structurally complete fake report is never authenticated parity',()=>{
  const v=validateReceipt(fake(),fixture);
  assert.equal(v.backend_count,5);
  assert.equal(v.backend_parity_certified,false);
  assert.equal(v.guest_execution_authenticated,false);
  assert.equal(v.runner_provenance_authenticated,false);
});
const mutations=[
  ['missing-backend',x=>x.backends.pop()],
  ['duplicate-backend',x=>x.backends[1].backend='java'],
  ['wrong-repo',x=>x.backends[0].repository='ores-truffle-oreslang/oreslang-source.llvm'],
  ['zero-step',x=>x.backends[0].runner.step_count=0],
  ['missing-runner',x=>x.backends[0].runner.runner_id=0],
  ['wrong-run-head',x=>x.backends[0].runner.head_sha='b'.repeat(40)],
  ['no-guest',x=>x.backends[0].guest.executed=false],
  ['compiler-missing',x=>x.backends[0].guest.compiled=false],
  ['fake-guest-kind',x=>x.backends[0].guest.kind='host-model'],
  ['missing-vector',x=>x.backends[0].results.pop()],
  ['duplicate-vector',x=>x.backends[0].results[1].case_id=x.backends[0].results[0].case_id],
  ['unknown-vector',x=>x.backends[0].results[0].case_id='invented'],
  ['wrong-code',x=>x.backends[0].results[0].actual={close_code:1000}],
  ['wrong-fixture',x=>x.fixture_blob='d'.repeat(40)],
  ['unknown-field',x=>x.backends[0].injected=true],
  ['unrecognized-profile',x=>x.backends[0].profile='mock'],
  ['not-a-sha',x=>x.backends[0].head_sha='notashahash'],
];
for(const [name,mutate] of mutations)test('reject '+name,()=>{
  const receipt=fake();mutate(receipt);
  assert.throws(()=>validateReceipt(receipt,fixture),/LIVEVIEW_WIRE_GATE/);
});
test('reject damaged fixture bytes even when JSON remains parseable',()=>{
  const tampered=raw.replace('masked-hello','masked-HELLO');
  assert.throws(()=>validateVectors(JSON.parse(tampered),tampered),/LIVEVIEW_WIRE_GATE/);
});
test('reject malformed vectors even without a trusted blob',()=>{
  const v=clone(fixture);v.cases[0].frames_hex='thisisnothex';
  assert.throws(()=>validateVectors(v,JSON.stringify(v)),/LIVEVIEW_WIRE_GATE/);
});

function fakeSix() {
  const source=fake();
  const profile={java:'jvm',llvm:'native',wasm:'browser',
    forge:'forge-native',net:'net-native-aot'};
  for(const b of source.backends) b.profile=profile[b.backend];
  source.schema='ores-liveview-wire-six-backend-receipt-v1';
  const cranelift=clone(source.backends[0]);
  cranelift.backend='cranelift';
  cranelift.repository='ores-truffle-oreslang/oreslang-source.cranelift';
  cranelift.profile='cranelift-native';
  source.backends.push(cranelift);
  return source;
}

test('legacy five-backend report remains backward-compatible, six is isolated',()=>{
  const old=fake();
  assert.equal(validateReceipt(old,fixture).backend_count,5);
  assert.throws(()=>validateSixBackendReceipt(old,fixture),/LIVEVIEW_WIRE_GATE/);
  const six=fakeSix();
  assert.equal(SIX_BACKENDS.length,6);
  assert.equal(validateSixBackendReceipt(six,fixture).backend_count,6);
  assert.equal(validateSixBackendReceipt(six,fixture).backend_parity_certified,false);
  assert.equal(validateSixBackendReceipt(six,fixture).guest_execution_authenticated,false);
  assert.equal(validateSixBackendReceipt(six,fixture).runner_provenance_authenticated,false);
  assert.throws(()=>validateReceipt(six,fixture),/LIVEVIEW_WIRE_GATE/);
});

for(const [label,mutate] of [
  ['missing-cranelift',x=>x.backends.pop()],
  ['cranelift-falsely-aliased-to-forge',x=>x.backends[5].backend='forge'],
  ['forged-cranelift-repo',x=>x.backends[5].repository='ores-truffle-oreslang/oreslang-source.forge'],
  ['forged-cranelift-profile',x=>x.backends[5].profile='forge-native'],
  ['forge-claiming-cranelift',x=>x.backends[3].profile='cranelift-native'],
  ['java-claiming-cranelift',x=>x.backends[0].profile='cranelift-native'],
  ['wasm-claiming-jvm',x=>x.backends[2].profile='jvm'],
  ['net-claiming-forge',x=>x.backends[4].profile='forge-native'],
  ['cranelift-no-runner',x=>x.backends[5].runner.step_count=0],
  ['cranelift-false-guest',x=>x.backends[5].guest.executed=false],
  ['cranelift-unknown-fixture',x=>x.backends[5].results[0].case_id='invented'],
  ['cranelift-incorrect-observation',x=>x.backends[5].results[0].actual={close_code:1000}],
  ['cranelift-stale-head',x=>x.backends[5].runner.head_sha='0'.repeat(40)],
  ['cranelift-extra-field',x=>x.backends[5].foo='untrusted'],
  ['legacy-schema-spoof',x=>x.schema='ores-liveview-wire-backend-receipt-v1'],
]) {
  test('six-backend receipt rejects '+label,()=>{
    const sample=fakeSix();
    mutate(sample);
    assert.throws(()=>validateSixBackendReceipt(sample,fixture),/LIVEVIEW_WIRE_GATE/);
  });
}
