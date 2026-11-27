import test from 'node:test';
import assert from 'node:assert/strict';
import {smokeIds,selectCases,summarizeCases} from './named-recursive-fnc-receipt.mjs';

const manifest={status:'CANDIDATE_SOURCE_NOT_EXECUTED',cases:[
  {id:'fib-55-exact',tier:'extended',expected:{kind:'value',value:'139583862445'}},
  ...smokeIds.map(id=>({id,tier:'smoke',expected:id==='fib-name-does-not-escape'
    ?{kind:'reject',code:'unresolved_callable'}:{kind:'value',value:'55'}}))
]};
const rows=profile=>['fib-55-exact',...selectCases(manifest,profile).selected].map(id=>{
  const expected=manifest.cases.find(c=>c.id===id).expected;
  if(id==='fib-55-exact')return {id,expected,status:'compile_only',compiled:true,executed:false,artifact_sha256:'a'.repeat(64)};
  if(expected.kind==='reject')return {id,expected,status:'pass',compiled:false,executed:false,artifact_present:false};
  return {id,expected,status:'pass',compiled:true,executed:true,actual:expected,artifact_sha256:'b'.repeat(64)};
});
test('direct stage cannot certify the three nested cases or exact execution',()=>{
  const s=summarizeCases(manifest,'direct-stage',rows('direct-stage'));
  assert.equal(s.status,'direct_stage_pass');
  assert.equal(s.passed,5);
  assert.equal(s.skipped_smoke.length,3);
  assert.equal(s.extended,'compile_only_not_executed');
});
test('full smoke requires all eight receipts and the exact compile',()=>{
  const s=summarizeCases(manifest,'full-smoke',rows('full-smoke'));
  assert.equal(s.status,'smoke_pass');
  assert.equal(s.passed,8);
  assert.deepEqual(s.skipped_smoke,[]);
  assert.throws(()=>summarizeCases(manifest,'full-smoke',rows('direct-stage')));
});
test('missing compile or pending guest cannot pass',()=>{
  const r=rows('full-smoke');r[0].status='fail';
  assert.equal(summarizeCases(manifest,'full-smoke',r).status,'incomplete');
  r[1].status='infrastructure_error';
  assert.equal(summarizeCases(manifest,'full-smoke',r).incomplete,1);
});
test('reject fabricated pass and compile-only evidence',()=>{
  for(const mutate of [
    r=>{r[0].executed=true;},
    r=>{r[1].executed=false;},
    r=>{r[1].actual={kind:'value',value:'56'};},
    r=>{r[1].artifact_sha256='';},
    r=>{r.at(-1).artifact_present=true;},
    r=>{r[1].status='compile_only';},
    r=>{r[0].status='pass';},
    r=>{r[1]=r[2];}
  ]){
    const r=rows('full-smoke');mutate(r);
    assert.throws(()=>summarizeCases(manifest,'full-smoke',r));
  }
});
test('manifest must have exact unique inventory',()=>{
  assert.throws(()=>selectCases({...manifest,cases:[...manifest.cases,manifest.cases[0]]},'direct-stage'));
  assert.throws(()=>selectCases(manifest,'unknown'));
});
