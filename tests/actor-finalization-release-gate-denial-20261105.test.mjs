import test from 'node:test';
import assert from 'node:assert/strict';
import {validateActorFinalizationReceipt,actorFinalizationReleaseGate,
 ACTOR_FINALIZATION_BACKENDS} from '../src/actor-finalization-evidence-v1.mjs';

const head='a'.repeat(40);
const receipt=()=>({sourceHead:head,sourceTree:'b'.repeat(40),
 workflowStatus:'completed',workflowConclusion:'success',
 jobs:[{id:1,runnerId:1,conclusion:'success',requiredTestStep:'guest-test',
  steps:[{name:'guest-test',status:'completed',conclusion:'success'}]}],
 compilerSha256:'c'.repeat(64),artifactSha256:'d'.repeat(64),
 compilerExecuted:true,nativeGuestExecuted:true,scenarioIds:['AF01']});

test('structurally valid self-reported guest receipt never authenticates itself',()=>{
 const result=validateActorFinalizationReceipt(head,receipt());
 assert.equal(result.shapeReady,true);
 assert.equal(result.independentlyAuthenticated,false);
 assert.equal(result.parityCertified,false);
 const gate=actorFinalizationReleaseGate({backend:'java',shapeReady:true,
  independentlyAuthenticated:true});
 assert.equal(gate.shapeRequirementsMet,true);
 assert.equal(gate.ready,false);
 assert.equal(gate.independentProviderVerificationRequired,true);
});

test('step-less and duplicate-label receipts fail structural admission',()=>{
 const noSteps=receipt();
 noSteps.jobs[0].steps=[];
 assert.ok(validateActorFinalizationReceipt(head,noSteps).errors.includes('ZERO_EXECUTED_STEPS'));
 const dup=receipt();
 dup.jobs[0].steps.push({name:'guest-test',status:'completed',conclusion:'skipped'});
 assert.ok(validateActorFinalizationReceipt(head,dup).errors.includes('UNSAFE_OR_DUPLICATE_TEST_STEP'));
});

test('native backends have explicit AOT and sanitizer requirements despite self-report',()=>{
 assert.ok(ACTOR_FINALIZATION_BACKENDS.includes('net'));
 const net=actorFinalizationReleaseGate({backend:'net',shapeReady:true,independentlyAuthenticated:true});
 assert.ok(net.errors.includes('NET_NATIVE_AOT_REQUIRED'));
 const llvm=actorFinalizationReleaseGate({backend:'llvm',shapeReady:true,independentlyAuthenticated:true});
 assert.ok(llvm.errors.includes('NATIVE_SANITIZERS_REQUIRED'));
 assert.equal(net.ready,false);
 assert.equal(llvm.ready,false);
});
