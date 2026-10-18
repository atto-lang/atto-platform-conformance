import test from "node:test";
import assert from "node:assert/strict";
import {assessRun,readAllJobs} from "../bin/diagnose-actions.mjs";
const SHA="a".repeat(40);
const run={id:123,run_attempt:2,status:"completed",conclusion:"failure",head_sha:SHA};
const step=(name,conclusion="success",status="completed")=>({name,status,conclusion});
const job=(steps,{status="completed",conclusion="failure",head_sha=SHA,runner_id=5}={})=>
  ({id:10,name:"harness",status,conclusion,head_sha,runner_id,steps});
const assess=(jobs,override={})=>assessRun({...run,...override},{total_count:jobs.length,jobs});

test("explicit empty steps are an observed no-step failure, not quota diagnosis",()=>{
 const out=assess([job([],{runner_id:null})]);
 assert.equal(out.classification,"OBSERVED_NO_STEP_FAILURE");
 assert.equal(out.jobs[0].step_count,0);
 assert.equal(out.root_cause_established,false);
 assert.equal(out.permits_merging,false);
});
test("unavailable/null steps are UNOBSERVED, not an observed no-step failure",()=>{
 for(const s of [null,undefined]){
  const out=assess([job(s,{runner_id:null})]);
  assert.equal(out.classification,"UNOBSERVED_FAILURE");
  assert.equal(out.jobs[0].step_count,null);
  assert.equal(out.jobs[0].failed_step_count,null);
 }
});
test("a completed failing execution step is observable with its exact step name",()=>{
 const out=assess([job([step("Checkout"),step("Compile Rust","failure")])]);
 assert.equal(out.classification,"EXECUTED_STEP_FAILURE");
 assert.equal(out.jobs[0].failed_step_count,1);
 assert.equal(out.jobs[0].failed_steps[0].name,"Compile Rust");
});
test("successful checkout followed by failed job does not imply failed tests",()=>{
 const out=assess([job([step("Checkout")])]);
 assert.equal(out.classification,"FAILED_JOB_WITHOUT_FAILED_STEP");
 assert.equal(out.failed_step_count,0);
});
test("runner lifecycle step failure is observed but cannot be called a test failure",()=>{
 const out=assess([job([step("Set up job","failure")])]);
 assert.equal(out.classification,"EXECUTED_STEP_FAILURE");
 assert.equal(out.jobs[0].failed_steps[0].housekeeping,true);
});
test("timed-out executed step is distinct from a step that failed",()=>{
 const out=assess([job([step("Compile native","timed_out")])]);
 assert.equal(out.classification,"EXECUTED_STEP_TIMEOUT");
});
test("skipped and cancelled jobs are separately identified without assuming execution",()=>{
 assert.equal(assess([job(null,{conclusion:"skipped"})]).classification,"SKIPPED");
 assert.equal(assess([job(null,{conclusion:"cancelled"})]).classification,"CANCELLED");
});
test("pending or queued job wins over unavailable steps",()=>{
 for(const status of ["queued","waiting","in_progress"]){
  const out=assess([job(null,{status,conclusion:null})]);
  assert.equal(out.classification,"PENDING_OR_QUEUED");
 }
});
test("a skipped-only steps list is not an explicitly empty steps array",()=>{
 const out=assess([job([step("Skipped test","skipped")])]);
 assert.equal(out.classification,"FAILED_JOB_WITH_NO_EXECUTED_STEP");
 assert.equal(out.jobs[0].step_count,1);
});
test("completed-successful execution has no compiler parity or merge authorization",()=>{
 const out=assess([job([step("Actual test")],{conclusion:"success"})],{conclusion:"success"});
 assert.equal(out.classification,"EXECUTED_STEPS_SUCCEEDED");
 assert.equal(out.permits_merging,false);
 assert.equal(out.all_job_head_shas_verified,true);
});
test("run and job head SHA mismatch never verify the head",()=>{
 const out=assess([job([step("Actual test")],{conclusion:"success",head_sha:"b".repeat(40)})],{conclusion:"success"});
 assert.equal(out.all_job_head_shas_verified,false);
 assert.equal(out.jobs[0].head_sha_match,"UNKNOWN_OR_MISMATCH");
});
test("missing head SHA never becomes verified",()=>{
 const out=assess([job([step("Actual test")],{conclusion:"success",head_sha:null})],{conclusion:"success"});
 assert.equal(out.all_job_head_shas_verified,false);
});
test("failed job classification remains meaningful when another job is unobserved",()=>{
 const out=assess([job([step("Test","failure")]),{...job(null),id:11,name:"unknown"}]);
 assert.equal(out.classification,"EXECUTED_STEP_FAILURE");
 assert.deepEqual(out.job_classifications,["EXECUTED_STEP_FAILURE","UNOBSERVED_FAILURE"]);
});
test("explicit empty + unobserved jobs retain separate per-job classifications",()=>{
 const out=assess([job([]),{...job(null),id:11,name:"unknown"}]);
 assert.equal(out.classification,"UNOBSERVED_FAILURE");
 assert.equal(out.jobs[0].classification,"OBSERVED_NO_STEP_FAILURE");
 assert.equal(out.jobs[1].classification,"UNOBSERVED_FAILURE");
});
test("a successful job cannot countermand failed run conclusion",()=>{
 const out=assess([job([step("Test")],{conclusion:"success"})]);
 assert.equal(out.classification,"RUN_JOB_STATE_MISMATCH");
});
test("incomplete pagination, no jobs and invalid inputs are distinct",()=>{
 assert.equal(assessRun(run,{total_count:2,jobs:[job([])]}).classification,"INCOMPLETE_JOB_LIST");
 assert.equal(assess([]).classification,"NO_JOBS_RECORDED");
 for(const [r,j] of [[null,{}],[{},{}],[run,{}],[run,{jobs:{}}]])
   assert.throws(()=>assessRun(r,j),/invalid GitHub/);
});
test("pagination retrieves all pages rather than certifying only first",async()=>{
 const calls=[];
 const first=Array.from({length:100},(_,i)=>({id:i+1}));
 const out=await readAllJobs("/repos/a/b/actions/runs/123",async path=>{
  calls.push(path);return path.endsWith("page=1")?{total_count:101,jobs:first}:{total_count:101,jobs:[{id:101}]};
 });
 assert.equal(out.jobs.length,101);
 assert.equal(calls.length,2);
});
test("pagination rejects changing totals and missing pages",async()=>{
 await assert.rejects(readAllJobs("/x",async path=>path.endsWith("page=1")
  ?{total_count:101,jobs:Array(100).fill({})}:{total_count:102,jobs:[{}]}),/pagination/);
 await assert.rejects(readAllJobs("/x",async()=>({total_count:150,jobs:[]})),/pagination/);
});
test("completion of workflow does not turn null/empty steps into tests",()=>{
 for(const steps of [null,[]]){
  const out=assess([job(steps)],{status:"completed",conclusion:"failure"});
  assert.notEqual(out.classification,"EXECUTED_STEP_FAILURE");
  assert.equal(out.failed_step_count,0);
 }
});
