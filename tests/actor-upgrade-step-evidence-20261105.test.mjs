import test from 'node:test';
import assert from 'node:assert/strict';
import {validateActorFinalizationReceipt,actorFinalizationReleaseGate} from '../src/actor-finalization-evidence-v1.mjs';

const head='a'.repeat(40);
const good=()=>({
  sourceHead:head,sourceTree:'b'.repeat(40),workflowStatus:'completed',
  workflowConclusion:'success',compilerSha256:'c'.repeat(64),
  artifactSha256:'d'.repeat(64),compilerExecuted:true,nativeGuestExecuted:true,
  scenarioIds:['AF01'],
  jobs:[{id:1,runnerId:10,conclusion:'success',requiredTestStep:'execute guest',
    steps:[{name:'execute guest',status:'completed',conclusion:'success'}]}]
});
test('apparently complete self-report is never an authenticated guest receipt',()=>{
  const v=validateActorFinalizationReceipt(head,good());
  assert.equal(v.shapeReady,true);
  assert.equal(v.independentlyAuthenticated,false);
  assert.equal(v.parityCertified,false);
});
test('zero-step, unassigned runner, and duplicated required test remain denied',()=>{
  const empty=good();empty.jobs[0].steps=[];
  assert.ok(validateActorFinalizationReceipt(head,empty).errors.includes('ZERO_EXECUTED_STEPS'));
  const noRunner=good();noRunner.jobs[0].runnerId=null;
  assert.ok(validateActorFinalizationReceipt(head,noRunner).errors.includes('RUNNER_NOT_ASSIGNED'));
  const duplicate=good();duplicate.jobs[0].steps.push({name:'execute guest',status:'completed',conclusion:'success'});
  assert.ok(validateActorFinalizationReceipt(head,duplicate).errors.includes('UNSAFE_OR_DUPLICATE_TEST_STEP'));
});
test('wrong head and failed companion cannot turn host-only data into parity',()=>{
  const mismatch=good();mismatch.sourceHead='e'.repeat(40);
  assert.ok(validateActorFinalizationReceipt(head,mismatch).errors.includes('EXACT_HEAD_MISMATCH'));
  const failing=good();failing.jobs[0].steps.push({name:'compile',status:'completed',conclusion:'failure'});
  assert.ok(validateActorFinalizationReceipt(head,failing).errors.includes('INCOMPLETE_OR_FAILED_JOB_STEP'));
});
test('offline release gate cannot assert release readiness from supplied flags',()=>{
  const gate=actorFinalizationReleaseGate({
    backend:'llvm',strictAot:true,sanitized:true,shapeReady:true,independentlyAuthenticated:true
  });
  assert.equal(gate.ready,false);
  assert.equal(gate.independentProviderVerificationRequired,true);
});
