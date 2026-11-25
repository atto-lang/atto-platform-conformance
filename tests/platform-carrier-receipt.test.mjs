import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCarrierReceipt} from '../src/platform-carrier-receipt.mjs';
const A='a'.repeat(40), B='b'.repeat(40), C='c'.repeat(40);
const source={repository_id:10,commit_sha:A,tree_sha:B,visibility:'private'};
const good={repository_id:20,commit_sha:C,tree_sha:B,visibility:'private',workflows:[
  {name:'GCC',kind:'test',status:'completed',conclusion:'success',executed_steps:8},
  {name:'Clang',kind:'test',status:'completed',conclusion:'success',executed_steps:8},
]};
const inspect=(delta={},pin=source)=>inspectCarrierReceipt(pin,{...good,...delta});

test('metadata equivalence is not provenance, release or transfer authorization',()=>{
  const r=inspect();
  assert.equal(r.classification,'REPORTED_TESTS_PASS_SECURITY_HOLD');
  assert.equal(r.reported_tests_successful,true);
  assert.equal(r.reported_all_workflows_successful,true);
  for (const k of ['authorizes_source_transfer','authorizes_merge','certifies_source_free','authenticated_ci','proves_guest_backend_parity'])
    assert.equal(r[k],false,k);
  assert.ok(Object.isFrozen(r));
});
test('different source and carrier commits can share exactly the same tree',()=>{
  assert.equal(inspect().classification,'REPORTED_TESTS_PASS_SECURITY_HOLD');
  assert.equal(inspect({...good,repository_id:source.repository_id}).classification,'SOURCE_COMMIT_MISMATCH');
});
test('public destination risk overrides any passing tests or tree match',()=>{
  const r=inspect({visibility:'public'});
  assert.equal(r.classification,'PUBLIC_CARRIER_RISK');
  assert.equal(r.authorizes_source_transfer,false);
});
test('tree mismatch never becomes a successful receipt',()=>{
  assert.equal(inspect({tree_sha:C}).classification,'TREE_MISMATCH');
});
test('failed or skipped relevant job is not passing',()=>{
  for (const bad of [
    {status:'completed',conclusion:'failure',executed_steps:5},
    {status:'completed',conclusion:'timed_out',executed_steps:5},
    {status:'completed',conclusion:'skipped',executed_steps:0},
    {status:'in_progress',conclusion:null,executed_steps:2},
    {status:'completed',conclusion:'success',executed_steps:0},
  ]) {
    const result=inspect({workflows:[{...good.workflows[0],...bad}]});
    assert.equal(result.reported_tests_successful,false);
    assert.ok(['REPORTED_TEST_FAILURE','INCOMPLETE_EVIDENCE'].includes(result.classification));
  }
});
test('source identity canary failure must remain a visible overall failure',()=>{
  const result=inspect({workflows:[...good.workflows,
    {name:'repo-name-canary',kind:'source_identity_canary',status:'completed',conclusion:'failure',executed_steps:2}]});
  assert.equal(result.classification,'REPORTED_TESTS_PASS_WITH_NONPORTABLE_CANARY');
  assert.equal(result.reported_relevant_workflows_successful,true);
  assert.equal(result.reported_all_workflows_successful,false);
  assert.equal(result.reported_nonportable_canary_failures,1);
  assert.equal(result.authorizes_merge,false);
});
test('zero-step and uncompleted source identity canary is still incomplete evidence',()=>{
  for (const canary of [
    {status:'completed',conclusion:'failure',executed_steps:0},
    {status:'queued',conclusion:null,executed_steps:0},
  ]) {
    const result=inspect({workflows:[...good.workflows,
      {name:'repo-name-canary',kind:'source_identity_canary',...canary}]});
    assert.equal(result.classification,'INCOMPLETE_IDENTITY_CANARY');
  }
});
test('governance check failure is substantive, not disposable as canary',()=>{
  const r=inspect({workflows:[...good.workflows,
    {name:'governance',kind:'governance',status:'completed',conclusion:'failure',executed_steps:2}]});
  assert.equal(r.classification,'REPORTED_TEST_FAILURE');
  assert.equal(r.reported_relevant_workflows_successful,false);
});
test('no test or only policy checks cannot certify code',()=>{
  const r=inspect({workflows:[{name:'governance',kind:'governance',status:'completed',conclusion:'success',executed_steps:4}]});
  assert.equal(r.classification,'NO_EXECUTABLE_TESTS');
});
test('invalid identities, duplicate jobs, missing steps and unknown types fail closed',()=>{
  const badInputs=[
    {tree_sha:'not-sha'}, {repository_id:0}, {repository_id:'20'},
    {visibility:'unknown'}, {workflows:[]}, {workflows:Array(65).fill(good.workflows[0])},
    {workflows:[good.workflows[0],{...good.workflows[0],name:'gcc'}]},
    {workflows:[{...good.workflows[0],name:'../../bad'}]},
    {workflows:[{...good.workflows[0],kind:'ignored_failure'}]},
    {workflows:[{...good.workflows[0],executed_steps:null}]},
    {workflows:[{...good.workflows[0],executed_steps:1.2}]},
    {workflows:[{...good.workflows[0],status:'queued',conclusion:'success'}]},
    {workflows:[{...good.workflows[0],extra:true}]},
  ];
  for (const bad of badInputs)
    assert.throws(()=>inspect(bad),TypeError,JSON.stringify(bad).slice(0,90));
  assert.throws(()=>inspect({}, {...source,extra:'x'}),TypeError);
});
test('source tree labels alone never prove source bytes are absent',()=>{
  const r=inspect({}, {...source,visibility:'public'});
  assert.equal(r.authorizes_source_transfer,false);
  assert.equal(r.certifies_source_free,false);
});
