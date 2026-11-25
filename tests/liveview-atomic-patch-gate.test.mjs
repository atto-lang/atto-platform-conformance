import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateAtomicFixture,validateAtomicReceipt,BACKENDS,gitBlob} from '../src/liveview-atomic-patch-gate.mjs';
const raw=readFileSync(new URL('../contracts/v1/ores-liveview-atomic-patch-v1.json',import.meta.url),'utf8');
const f=JSON.parse(raw);
const clone=x=>structuredClone(x);
const receipt=()=>({schema:'ores-liveview-atomic-patch-receipt-v1',fixture_blob:validateAtomicFixture(f,raw).fixture_blob,
  backends:BACKENDS.map(backend=>({backend,head_sha:'a'.repeat(40),binary_sha256:'b'.repeat(64),
    runner:{run_id:1,job_id:1,runner_id:1,step_count:5},results:f.cases.map(c=>({case_id:c.id,observed:c.expected}))}))});
test('canonical ten-case atomic patch contract is structurally valid',()=>{
  const r=validateAtomicFixture(f,raw);assert.equal(r.case_count,10);assert.equal(r.source_only,true);
});
test('synthetic five-backend receipt never authenticates guest execution',()=>{
  const result=validateAtomicReceipt(receipt(),f,raw);
  assert.equal(result.structurally_complete,true);assert.equal(result.guest_execution_authenticated,false);
  assert.equal(result.backend_parity_certified,false);
});
test('duplicate or missing backend fails closed',()=>{
  for(const mutate of [r=>{r.backends[1].backend='java'},r=>{r.backends.pop()}]){
    const r=receipt();mutate(r);assert.throws(()=>validateAtomicReceipt(r,f,raw));
  }
});
test('zero-step runner evidence fails closed',()=>{
  const r=receipt();r.backends[0].runner.step_count=0;
  assert.throws(()=>validateAtomicReceipt(r,f,raw),/runner/);
});
test('wrong expected frame, unknown case and duplicate results fail closed',()=>{
  for(const mutate of [r=>{r.backends[0].results[0].observed='snapshot'},
    r=>{r.backends[0].results[0].case_id='unknown-case'},
    r=>{r.backends[0].results[1].case_id=r.backends[0].results[0].case_id}]){
      const r=receipt();mutate(r);assert.throws(()=>validateAtomicReceipt(r,f,raw));
  }
});
test('non-canonical fixture and identity corruption are rejected',()=>{
  assert.throws(()=>validateAtomicFixture(f,raw.trim()));
  const v=clone(f);v.cases[0].before[0].id='__proto__';
  assert.throws(()=>validateAtomicFixture(v,JSON.stringify(v,null,2)+'\n'));
});
test('wrong fixture blob and unknown backend rejected',()=>{
  const r=receipt();r.fixture_blob='0'.repeat(40);assert.throws(()=>validateAtomicReceipt(r,f,raw));
  const r2=receipt();r2.backends[2].backend='cranelift';assert.throws(()=>validateAtomicReceipt(r2,f,raw));
});

test('changed canonical oracle cannot be laundered by matching receipt',()=>{
  const altered=clone(f);altered.cases[0].expected='snapshot';
  const bytes=JSON.stringify(altered,null,2)+'\n', r=receipt();
  r.fixture_blob=gitBlob(bytes);
  for(const b of r.backends)b.results[0].observed='snapshot';
  assert.throws(()=>validateAtomicReceipt(r,altered,bytes),/immutable atomic fixture/);
});
