import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateVectors,validateReceipt,gitBlob,FIXTURE_BLOB,BACKENDS} from '../src/liveview-wire-receipts.mjs';
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

test("Git blob hashing uses canonical NUL header without trailing space",()=>{
  assert.equal(gitBlob(""),"e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
});
