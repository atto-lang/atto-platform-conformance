import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {classifyAttoRun} from "../lib/atto-library-run-evidence-v1.mjs";
const evidence=JSON.parse(readFileSync(fileURLToPath(
  new URL("../evidence/atto-library-workflow-admission-20261107.json",import.meta.url)), "utf8"));
function classify(snapshot,jobName) {
 const run={id:snapshot.run_id,head_sha:snapshot.head,
   run_attempt:snapshot.run_attempt,status:snapshot.status,
   conclusion:snapshot.conclusion,path:snapshot.path};
 const jobs=snapshot.jobs.map(j=>({...j,run_id:snapshot.run_id,
   run_attempt:snapshot.run_attempt,head_sha:snapshot.head}));
 return classifyAttoRun({run,jobs,expectedHead:snapshot.head,
   expectedWorkflowPath:snapshot.path,expectedJob:jobName,
   requiredSteps:["Checkout immutable PR head"]});
}
test("two actual malformed source-owned workflow runs reported zero created jobs",()=>{
 assert.equal(evidence.schemaVersion,1);
 assert.equal(evidence.before.length,2);
 for (const before of evidence.before){
   assert.deepEqual(before.jobs,[]);
   const output=classify(before,"bootstrap (clang++)");
   assert.equal(output.classification,"WORKFLOW_JOB_CREATION_FAILURE");
   assert.equal(output.executedSteps,0);
 }
});
test("after literal-safe YAML repair jobs exist but are unallocated and zero-step",()=>{
 assert.equal(evidence.after.length,2);
 const expected=["native-source-modules (ubuntu-24.04, linux-x64)",
   "bootstrap (clang++)"];
 for (let i=0;i<evidence.after.length;i++){
   const item=evidence.after[i];
   assert.equal(item.jobs.length,1);
   assert.equal(item.jobs[0].runner_id,0);
   assert.deepEqual(item.jobs[0].steps,[]);
   const output=classify(item,expected[i]);
   assert.equal(output.classification,"RUNNER_ADMISSION_FAILURE");
   assert.equal(output.executedSteps,0);
 }
 assert.equal(evidence.guestExecution,"NOT_EXECUTED");
});
test("missing job in a populated run remains target-not-executed, not workflow parse error",()=>{
 const item=evidence.after[0];
 assert.equal(classify(item,"non-existent-guested-test").classification,"NOT_EXECUTED");
});
test("failed no-job workflow cannot be forged into success by job absence",()=>{
 const item=evidence.before[0];
 const forged={...item,conclusion:"success"};
 assert.equal(classify(forged,"native-source-modules").classification,"NOT_EXECUTED");
});
