import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyRunnerAdmissionAB } from '../bin/verify-critical-runner-admission-ab.mjs';

const receipt = JSON.parse(fs.readFileSync(
  new URL('../evidence/critical-runner-admission-ab-20261102.json',import.meta.url),
  'utf8'));
const fresh=()=>structuredClone(receipt);
test('source-free same-job A/B must remain a capacity observation, not a budget approval',()=>{
  assert.deepEqual(verifyRunnerAdmissionAB(receipt),{
    classification:'SOURCE_FREE_CAPACITY_COMPARISON_ONLY',
    source_steps:0,alternate_steps:4,private_source_mirror_authorized:false
  });
});
test('a source-org zero-step job is never a compiler or runner pass',()=>{
  for(const [field,value] of [
    ['run_conclusion','success'],['job_conclusion','success'],
    ['steps',1],['logs_available',true]
  ]) {
    const x=fresh();x.source[field]=value;
    assert.throws(()=>verifyRunnerAdmissionAB(x));
  }
});
test('alternate capacity requires a real exact job and four named steps',()=>{
  for(const [field,value] of [
    ['run_conclusion','failure'],['job_conclusion','failure'],
    ['steps',0],['logs_available',false],['run_attempt',0],
    ['tree','invalid'],['workflow_blob','invalid']
  ]) {
    const x=fresh();x.alternate[field]=value;
    assert.throws(()=>verifyRunnerAdmissionAB(x));
  }
});
test('a source-free success never authorizes private mirroring or proves budget balance',()=>{
  for(const [field,value] of [
    ['budget_available_claim',true],['mirror_authorized',true],
    ['private_source_transferred',true],['source_org_branch_protection_observed',true],
    ['same_job_definition',false],['security_incidents_open',[]]
  ]) {
    const x=fresh();x[field]=value;
    assert.throws(()=>verifyRunnerAdmissionAB(x));
  }
});
test('a different head or a mislabeled run must fail closed',()=>{
  for(const [side,field,value] of [
    ['source','commit','short'],['source','run_id',0],
    ['alternate','job_id',0],['alternate','job_name','compiler-guest'],
    ['alternate','named_steps',[]],['alternate','log_markers',[]]
  ]) {
    const x=fresh();x[side][field]=value;
    assert.throws(()=>verifyRunnerAdmissionAB(x));
  }
});
