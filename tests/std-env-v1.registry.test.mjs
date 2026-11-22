import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT, verifyStdEnvRegistry} from '../bin/verify-std-env-v1.mjs';

const original=JSON.parse(readFileSync(join(ROOT,'contract.json'),'utf8'));
const copy=()=>structuredClone(original);
const fails=(registry,pattern)=> {
  const result=verifyStdEnvRegistry(registry);
  assert.equal(result.ok,false,'malformed contract must fail closed');
  assert.match(result.errors.join(' | '),pattern);
};

test('registry integrity checks 11 targets, 13 cases, 10 pinned source Git blobs',()=>{
  const result=verifyStdEnvRegistry(copy());
  assert.deepEqual(result,{ok:true,errors:[]});
  assert.equal(Object.keys(original.backends).length,11);
  assert.equal(original.cases.length,13);
  assert.equal(Object.keys(original.fixture_git_blobs).length,10);
});

test('source-only registry cannot falsely declare a guest PASS',()=>{
  const c=copy();c.backends.java.status='passed';
  fails(c,/cannot claim execution/);
  c.backends.java.status='not_executed';
  c.backends.llvm.reason='';
  fails(c,/cannot claim execution/);
});

test('modified or missing fixture Git blobs cannot be silently accepted',()=>{
  const c=copy();c.fixture_git_blobs['basic.atto']='0'.repeat(40);
  fails(c,/SHA mismatch/);
  delete c.fixture_git_blobs['shadow\/std\/env.atto'];
  fails(c,/ten pinned fixture/);
});

test('fixture path traversal and missing import references fail closed',()=>{
  const c=copy();c.fixture_git_blobs['../secrets.atto']='0'.repeat(40);
  fails(c,/invalid fixture path/);
  const c2=copy();c2.cases[0].fixture='not_in_registry.atto';
  fails(c2,/case references unknown fixture/);
});

test('duplicate cases and dropped backends cannot manufacture parity',()=>{
  const c=copy();c.cases[0].id=c.cases[1].id;
  fails(c,/duplicate case/);
  const c2=copy();delete c2.backends.wasm;
  fails(c2,/missing or extra backend/);
});

test('security semantic downgrades are rejected',()=>{
  const c=copy();c.semantics.deny_before_value_lookup=false;
  fails(c,/security or API semantic drift/);
  const c2=copy();c2.semantics.ambient_process_environment_forbidden=false;
  fails(c2,/security or API semantic drift/);
});

test('denied keys and missing coarse ENV cannot pass as ordinary absence',()=>{
  const c=copy();c.cases.find(x=>x.id==='denied-fallback').denied=[];
  fails(c,/deny-case must enforce explicit deny/);
  const c2=copy();c2.cases.find(x=>x.id==='coarse-denied').coarse_env=true;
  fails(c2,/coarse denied unexpectedly elevated/);
});

test('oversize vector and canonical-shadow fixture are required',()=>{
  const c=copy();c.cases.find(x=>x.id==='oversized-value')
    .generated_environment.ATTO_ENV_OVERSIZED.byte_count=16384;
  fails(c,/oversized value admission vector missing/);
  const c2=copy();c2.cases.find(x=>x.id==='package-no-shadow')
    .fixture_dependency='untrusted.atto';
  fails(c2,/no canonical package shadow negative/);
});

test('conformance manifest has no fabricated execution receipts',()=>{
  for(const [name,state] of Object.entries(original.backends)){
    assert.equal(state.status,'not_executed',name);
    assert.ok(!Object.hasOwn(state,'run_url'));
    assert.ok(!Object.hasOwn(state,'executed_cases'));
  }
  assert.equal(original.claim_tier,'SOURCE_ONLY_UNTIL_COMPILER_GUEST_RECEIPT');
});
