import test from "node:test";
import assert from "node:assert/strict";
import {validateActorFinalizationReceipt} from "../src/actor-finalization-evidence-v1.mjs";

const HEAD="a".repeat(40);
function receipt(){return {
 sourceHead:HEAD,sourceTree:"b".repeat(40),
 workflowStatus:"completed",workflowConclusion:"success",
 jobs:[{id:17,runnerId:12,conclusion:"success",requiredTestStep:"Native guest",
   steps:[{name:"Native guest",status:"completed",conclusion:"success"}]}],
 compilerSha256:"c".repeat(64),artifactSha256:"d".repeat(64),
 compilerExecuted:true,nativeGuestExecuted:true,scenarioIds:["AF01"]
};}
const invalid=r=>{
 const status=validateActorFinalizationReceipt(HEAD,r);
 assert.equal(status.shapeReady,false);
 assert.equal(status.independentlyAuthenticated,false);
 assert.equal(status.parityCertified,false);
 assert.ok(status.errors.includes("REQUIRED_TEST_STEP_NOT_EXECUTED"),status.errors.join(","));
};

test("job success alone cannot elevate queued, failed or wrong named guest steps",()=>{
 for(const mutate of [
   job=>job.steps[0].status="in_progress",
   job=>job.steps[0].conclusion="failure",
   job=>job.steps[0].name="Setup only"
 ]){
   const r=receipt();mutate(r.jobs[0]);invalid(r);
 }
});

test("all claimed jobs require their own successful completed guest test step",()=>{
 const r=receipt();
 r.jobs.push({id:18,runnerId:13,conclusion:"success",
   requiredTestStep:"Native guest",steps:[{
     name:"Setup",status:"completed",conclusion:"success"
   }]});
 invalid(r);
 const good=validateActorFinalizationReceipt(HEAD,receipt());
 assert.equal(good.shapeReady,true);
 assert.equal(good.parityCertified,false);
});
