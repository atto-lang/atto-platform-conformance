// Receipt SHAPE checks only. Local data can never independently authenticate GitHub runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateActorFinalizationReceipt} from '../src/actor-finalization-evidence-v1.mjs';

const head='a'.repeat(40);
const base=()=>({
  sourceHead:head,sourceTree:'b'.repeat(40),workflowStatus:'completed',
  workflowConclusion:'success',compilerSha256:'c'.repeat(64),
  artifactSha256:'d'.repeat(64),compilerExecuted:true,nativeGuestExecuted:true,
  scenarioIds:['AF01'],
  jobs:[{id:1,runnerId:10,conclusion:'success',requiredTestStep:'run actual guests',
    steps:[{name:'run actual guests',status:'completed',conclusion:'success'}]}]
});

test('even a well-shaped self-reported receipt never certifies independent execution',()=>{
  const r=validateActorFinalizationReceipt(head,base());
  assert.equal(r.shapeReady,true);
  assert.equal(r.independentlyAuthenticated,false);
  assert.equal(r.parityCertified,false);
});

test('duplicate required test step poisons apparently successful job',()=>{
  const fixture=base();
  fixture.jobs[0].steps.push({name:'run actual guests',status:'completed',conclusion:'skipped'});
  const r=validateActorFinalizationReceipt(head,fixture);
  assert.equal(r.shapeReady,false);
  assert.ok(r.errors.includes('UNSAFE_OR_DUPLICATE_TEST_STEP'));
});

test('failed companion step or zero-step runner cannot launder guest evidence',()=>{
  const failed=base();
  failed.jobs[0].steps.push({name:'compile',status:'completed',conclusion:'failure'});
  assert.ok(validateActorFinalizationReceipt(head,failed).errors.includes('INCOMPLETE_OR_FAILED_JOB_STEP'));
  const noSteps=base();
  noSteps.jobs[0].steps=[];
  assert.ok(validateActorFinalizationReceipt(head,noSteps).errors.includes('ZERO_EXECUTED_STEPS'));
  const noRunner=base();
  noRunner.jobs[0].runnerId=null;
  assert.ok(validateActorFinalizationReceipt(head,noRunner).errors.includes('RUNNER_NOT_ASSIGNED'));
});
