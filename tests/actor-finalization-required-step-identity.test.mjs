import test from "node:test";
import assert from "node:assert/strict";
import {validateActorFinalizationReceipt as validate} from "../src/actor-finalization-evidence-v1.mjs";

const HEAD="a".repeat(40);
function good(){
 return {sourceHead:HEAD,sourceTree:"b".repeat(40),
  workflowStatus:"completed",workflowConclusion:"success",
  jobs:[{id:17,runnerId:12,conclusion:"success",requiredTestStep:"Native guest",
    steps:[{name:"Native guest",status:"completed",conclusion:"success"}]}],
  compilerSha256:"c".repeat(64),artifactSha256:"d".repeat(64),
  compilerExecuted:true,nativeGuestExecuted:true,scenarioIds:["AF01"]
 };
}
test("AF20 named guest receipt requires exactly one completed required step",()=>{
 for(const conclusion of ["skipped","neutral","success"]){
  const receipt=good();
  receipt.jobs[0].steps.push({name:"Native guest",status:"completed",conclusion});
  const result=validate(HEAD,receipt);
  assert.equal(result.shapeReady,false,conclusion);
  assert.ok(result.errors.includes("UNSAFE_OR_DUPLICATE_TEST_STEP"));
  assert.equal(result.parityCertified,false);
 }
});
test("invisible and control characters cannot spoof step identities",()=>{
 for(const label of ["Run\u200bguest","Run\u202epass","Run\u0085pass","Run\npass"]){
  const receipt=good();
  receipt.jobs[0].steps.push({name:label,status:"completed",conclusion:"skipped"});
  const result=validate(HEAD,receipt);
  assert.equal(result.shapeReady,false,label);
  assert.ok(result.errors.includes("UNSAFE_OR_DUPLICATE_TEST_STEP"));
 }
 const receipt=good();receipt.jobs[0].steps.unshift({
  name:"Set up job",status:"completed",conclusion:"success"
 });
 assert.equal(validate(HEAD,receipt).shapeReady,true);
 assert.equal(validate(HEAD,receipt).parityCertified,false);
});
