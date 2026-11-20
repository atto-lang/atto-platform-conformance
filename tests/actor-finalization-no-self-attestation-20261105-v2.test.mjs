import test from "node:test";
import assert from "node:assert/strict";
import {validateActorFinalizationReceipt} from "../src/actor-finalization-evidence-v1.mjs";
const head="a".repeat(40);
const receipt=()=>({
 sourceHead:head,sourceTree:"b".repeat(40),
 workflowStatus:"completed",workflowConclusion:"success",
 jobs:[{id:31,runnerId:12,conclusion:"success",requiredTestStep:"Native guest",
  steps:[{name:"Native guest",status:"completed",conclusion:"success"}]}],
 compilerSha256:"c".repeat(64),artifactSha256:"d".repeat(64),
 compilerExecuted:true,nativeGuestExecuted:true,scenarioIds:["AF01"]
});
test("offline positive-shaped receipts never independently authenticate or parity certify",()=>{
 const r=receipt();
 r.independentlyAuthenticated=true;r.parityCertified=true;r.releaseReady=true;
 const result=validateActorFinalizationReceipt(head,r);
 assert.equal(result.shapeReady,true);
 assert.equal(result.independentlyAuthenticated,false);
 assert.equal(result.parityCertified,false);
});
test("zero-step and failed-step receipts reject purported successful native guest claims",()=>{
 for(const steps of [[],[{name:"Native guest",status:"completed",conclusion:"failure"}],
  [{name:"Native guest",status:"in_progress",conclusion:null}]]){
  const r=receipt();r.jobs[0].steps=steps;
  const result=validateActorFinalizationReceipt(head,r);
  assert.equal(result.shapeReady,false);
  assert.equal(result.parityCertified,false);
 }
});
