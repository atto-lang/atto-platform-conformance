import test from "node:test";
import assert from "node:assert/strict";
import {validateActorFinalizationReceipt as validate} from "../src/actor-finalization-evidence-v1.mjs";

const HEAD="a".repeat(40);
const completed=(name="Native guest",conclusion="success")=>({
 name,status:"completed",conclusion
});
function receipt(){
 return {sourceHead:HEAD,sourceTree:"b".repeat(40),
  workflowStatus:"completed",workflowConclusion:"success",
  jobs:[{id:17,runnerId:12,conclusion:"success",requiredTestStep:"Native guest",
   steps:[completed()]}],
  compilerSha256:"c".repeat(64),artifactSha256:"d".repeat(64),
  compilerExecuted:true,nativeGuestExecuted:true,scenarioIds:["AF01"]
 };
}

test("one successful guest step cannot mask an additional failed or unfinished step",()=>{
 for(const extra of [
  completed("Additional", "failure"),
  completed("Additional", "cancelled"),
  {name:"Additional",status:"in_progress",conclusion:null},
  {name:"Additional",status:"queued",conclusion:null},
  {name:"Additional",status:"completed",conclusion:null}
 ]){
  const r=receipt();r.jobs[0].steps.push(extra);
  const status=validate(HEAD,r);
  assert.equal(status.shapeReady,false,JSON.stringify(extra));
  assert.ok(status.errors.includes("INCOMPLETE_OR_FAILED_JOB_STEP"));
  assert.equal(status.parityCertified,false);
 }
});

test("completed skipped or neutral setup steps are non-execution evidence but do not invalidate the required success",()=>{
 const r=receipt();
 r.jobs[0].steps.unshift(completed("Optional setup","skipped"));
 r.jobs[0].steps.push(completed("Optional summary","neutral"));
 const status=validate(HEAD,r);
 assert.equal(status.shapeReady,true);
 assert.equal(status.independentlyAuthenticated,false);
 assert.equal(status.parityCertified,false);
});
