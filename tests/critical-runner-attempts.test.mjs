import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyRunnerAttemptComparison} from '../bin/verify-critical-runner-attempts.mjs';
const read=(name)=>JSON.parse(fs.readFileSync(new URL('../evidence/'+name,import.meta.url),'utf8'));
const original=read('critical-runner-admission-ab-20261102.json');
const current=read('critical-runner-admission-ab-attempt2-20261102.json');
const copy=()=>structuredClone(current);
const validate=(x)=>verifyRunnerAttemptComparison(x,original);
test('two exact-head repeats prove alternate source-free admission, not private transfer',()=>{
  assert.deepEqual(validate(current),{
    classification:'SOURCE_FREE_RUNNER_ADMISSION_DIVERGENCE_ONLY',
    attempts_per_org:2,source_executed_steps:0,alternate_executed_steps:8,
    source_transfer_approved:false,compiler_guest_verified:false
  });
});
test('both organizations must preserve unique attempt job IDs and run heads',()=>{
  for(const side of ['source','alternate']){
    for(const [field,value] of [['head','f'.repeat(40)],['tree','f'.repeat(40)],
      ['run_id',0],['repository','forged/repo']]){
      const x=copy();x[side][field]=value;
      assert.throws(()=>validate(x));
    }
    for(const value of [0,1,3]){
      const x=copy();x[side].attempts[1].attempt=value;
      assert.throws(()=>validate(x));
    }
    const x=copy();x[side].attempts[1].job_id=x[side].attempts[0].job_id;
    assert.throws(()=>validate(x));
  }
});
test('each step result is bounded to its source or alternative org',()=>{
  for(const side of ['source','alternate']){
    const x=copy();x[side].attempts[1].executed_steps=side==='source'?1:0;
    assert.throws(()=>validate(x));
    const y=copy();y[side].attempts[1].conclusion=side==='source'?'success':'failure';
    assert.throws(()=>validate(y));
    const z=copy();z[side].attempts[1].verified_logs=side==='source'?true:false;
    assert.throws(()=>validate(z));
  }
});
test('capacity check cannot authorize source export or assert remaining budget',()=>{
  for(const [field,value] of [
    ['private_source_transferred',true],['source_git_tree_mirrored',true],
    ['authorization_status','AUTHORIZED'],['budget_remaining_verified',true],
    ['root_cause_verified',true],['native_compiler_execution_verified',true],
    ['guest_runtime_execution_verified',true],['source_main_protected',true]
  ]){
    const x=copy();x[field]=value;
    assert.throws(()=>validate(x));
  }
});
test('incidents cannot be replaced with fake resolution evidence',()=>{
  const x=copy();x.incident_gate.all_closed_completed=true;assert.throws(()=>validate(x));
  const y=copy();y.incident_gate.required=[22,77];assert.throws(()=>validate(y));
});
