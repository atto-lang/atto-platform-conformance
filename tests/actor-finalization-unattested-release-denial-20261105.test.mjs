import test from 'node:test';
import assert from 'node:assert/strict';
import {validateActorFinalizationReceipt,validateActorFinalizationLedger,actorFinalizationReleaseGate,ACTOR_FINALIZATION_BACKENDS} from '../src/actor-finalization-evidence-v1.mjs';

const head='a'.repeat(40);
const receipt=()=>({
 sourceHead:head,sourceTree:'b'.repeat(40),workflowStatus:'completed',workflowConclusion:'success',
 compilerSha256:'c'.repeat(64),artifactSha256:'d'.repeat(64),
 compilerExecuted:true,nativeGuestExecuted:true,scenarioIds:['AF01'],
 jobs:[{id:11,runnerId:7,conclusion:'success',requiredTestStep:'guest-execution',
        steps:[{name:'guest-execution',status:'completed',conclusion:'success'}]}]
});
test('a perfect self-reported receipt remains independently unauthenticated',()=>{
 const r=validateActorFinalizationReceipt(head,receipt());
 assert.equal(r.shapeReady,true);
 assert.equal(r.independentlyAuthenticated,false);
 assert.equal(r.parityCertified,false);
});
test('runner denial, duplicate steps and failed execution cannot prove release',()=>{
 for(const [mutation,error] of [
  [r=>{r.jobs[0].steps=[];},'ZERO_EXECUTED_STEPS'],
  [r=>{r.jobs[0].runnerId=0;},'RUNNER_NOT_ASSIGNED'],
  [r=>{r.jobs[0].steps.push({...r.jobs[0].steps[0],conclusion:'skipped'});},'UNSAFE_OR_DUPLICATE_TEST_STEP'],
  [r=>{r.jobs[0].steps.push({name:'extra',status:'completed',conclusion:'failure'});},'INCOMPLETE_OR_FAILED_JOB_STEP']
 ]){
  const r=receipt();mutation(r);
  const x=validateActorFinalizationReceipt(head,r);
  assert.equal(x.shapeReady,false);
  assert.equal(x.errors.includes(error),true);
 }
});
test('complete backend ledger and offline flags still cannot self-certify parity',()=>{
 const ledger={backends:ACTOR_FINALIZATION_BACKENDS.map(backend=>({backend,status:'unverified'}))};
 assert.equal(validateActorFinalizationLedger(ledger).valid,true);
 assert.equal(validateActorFinalizationLedger(ledger).parityCertified,false);
 for(const backend of ['java','llvm','wasm','cranelift','net','forge']){
  const r=actorFinalizationReleaseGate({backend,strictAot:true,sanitized:true,
   independentlyAuthenticated:true,shapeReady:true});
  assert.equal(r.shapeRequirementsMet,true);
  assert.equal(r.ready,false);
 }
 ledger.backends[1].backend=ledger.backends[0].backend;
 assert.equal(validateActorFinalizationLedger(ledger).valid,false);
});