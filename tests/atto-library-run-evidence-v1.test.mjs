import test from "node:test";
import assert from "node:assert/strict";
import {classifyAttoRun} from "../lib/atto-library-run-evidence-v1.mjs";

const head = "a".repeat(40);
const run = () => ({
  id: 42304693725, head_sha: head, run_attempt: 1,
  path: ".github/workflows/atto-library-profiles-v1.yml",
  status: "completed", conclusion: "success"
});
const job = () => ({
  id: 128190944565, name: "core-baremetal", runner_id: 123,
  run_id: 42304693725, run_attempt: 1, head_sha: head,
  status: "completed", conclusion: "success",
  steps: [
    {number: 1, name: "Verify exact source revision", status: "completed", conclusion: "success"},
    {number: 2, name: "Compile .atto, link and boot QEMU", status: "completed", conclusion: "success"}
  ]
});
const classify = (r = run(), j = [job()]) => classifyAttoRun({
  run: r, jobs: j, expectedHead: head, expectedJob: "core-baremetal",
  expectedWorkflowPath: ".github/workflows/atto-library-profiles-v1.yml",
  requiredSteps: ["Verify exact source revision", "Compile .atto, link and boot QEMU"]
});

test("zero or null GitHub steps are runner admission failure, never compiler pass", () => {
  for (const steps of [null, undefined, []]) {
    const result = classify({...run(), conclusion: "failure"}, [{...job(), conclusion: "failure", steps, runner_id: 0}]);
    assert.deepEqual(result, {classification: "RUNNER_ADMISSION_FAILURE",
      reason: "ZERO_REPORTED_JOB_STEPS", executedSteps: 0});
  }
});
test("failed completed workflow with no created jobs is not a runner failure",()=>{
  const out = classify({...run(),conclusion:"failure"},[]);
  assert.equal(out.classification,"WORKFLOW_JOB_CREATION_FAILURE");
  assert.equal(out.reason,"COMPLETED_FAILED_RUN_WITH_ZERO_JOBS");
  assert.equal(out.executedSteps,0);
});
test("missing jobs before workflow completion means in-progress, not a pass",()=>{
  const out = classify({...run(),status:"queued",conclusion:null},[]);
  assert.equal(out.classification,"IN_PROGRESS");
  assert.equal(out.executedSteps,0);
});
test("zero-step classification distinguishes queued jobs from failed runner admission",()=>{
  const waiting = {...run(), status:"queued", conclusion:null};
  const queued = {...job(), status:"queued", conclusion:null, steps:[], runner_id:0};
  assert.equal(classify(waiting,[queued]).classification,"IN_PROGRESS");
  const inProgress = {...job(), status:"in_progress", conclusion:null, steps:null, runner_id:0};
  assert.equal(classify({...run(),status:"in_progress",conclusion:null},[inProgress]).classification,"IN_PROGRESS");
});
test("completed zero-step green metadata is not an admission failure",()=>{
  assert.equal(classify(run(),[{...job(),steps:[],runner_id:0}]).classification,"UNTRUSTED_EVIDENCE");
});
test("completed zero-step job allocated to a runner has missing evidence",()=>{
  assert.equal(classify({...run(),conclusion:"failure"},
    [{...job(),steps:null,runner_id:99,conclusion:"failure"}]).classification,
    "UNTRUSTED_EVIDENCE");
});
test("genuine zero-step failed runner admission remains classified",()=>{
  assert.equal(classify({...run(),conclusion:"failure"},
    [{...job(),steps:[],runner_id:0,conclusion:"failure"}]).classification,
    "RUNNER_ADMISSION_FAILURE");
});
test("skipped required compiler step cannot be counted as executed",()=>{
  const x=job(); x.steps[1].conclusion="skipped";
  assert.equal(classify(run(),[x]).classification,"NO_REQUIRED_EXECUTION");
});

test("skipped setup and required steps do not inflate executed-step count", () => {
  const j = job();
  j.steps[0].conclusion = "skipped";
  j.steps[1].conclusion = "skipped";
  const out = classify(run(),[j]);
  assert.equal(out.classification,"NO_REQUIRED_EXECUTION");
  assert.equal(out.executedSteps,0);
});
test("neutral completed steps do not count as executed compiler commands", () => {
  const j = job();
  j.steps[0].conclusion = "neutral";
  j.steps[1].conclusion = "neutral";
  const out = classify(run(),[j]);
  assert.equal(out.classification,"NO_REQUIRED_EXECUTION");
  assert.equal(out.executedSteps,0);
});
test("unknown zero-step runner identity is untrusted, not verified admission failure", () => {
  for (const runner_id of [undefined,null,-1,1]) {
    const out = classify({...run(),conclusion:"failure"},
      [{...job(),runner_id,steps:[],conclusion:"failure"}]);
    assert.equal(out.classification,"UNTRUSTED_EVIDENCE");
    assert.equal(out.executedSteps,0);
  }
});
test("cancelled zero-step run is not a runner-admission failure",()=>{
 for (const cancelled of [
   {run:"cancelled", job:"cancelled"},
   {run:"cancelled", job:"failure"},
   {run:"failure",job:"cancelled"},
 ]) {
   const result=classify({...run(),conclusion:cancelled.run},
      [{...job(),steps:[],runner_id:0,conclusion:cancelled.job}]);
   assert.equal(result.classification,"NOT_EXECUTED");
   assert.equal(result.reason,"CANCELLED_WITHOUT_JOB_STEPS");
 }
});
test("skipped zero-step job cannot be confused with failed runner admission",()=>{
 const out=classify({...run(),conclusion:"success"},
   [{...job(),conclusion:"skipped",runner_id:0,steps:[]}]);
 assert.equal(out.classification,"NOT_EXECUTED");
 assert.equal(out.executedSteps,0);
});
test("ambiguous zero-step outcomes cannot be attributed to runner admission",()=>{
 for(const [runConclusion,jobConclusion] of [
   ["timed_out","timed_out"],["failure",null],["failure","neutral"],
   ["success","failure"],["failure","success"]
 ]) {
   const out=classify({...run(),conclusion:runConclusion},
     [{...job(),conclusion:jobConclusion,runner_id:0,steps:[]}]);
   assert.equal(out.classification,"UNTRUSTED_EVIDENCE",
      runConclusion+" / "+jobConclusion);
 }
});
test("observed completed failed zero-step job with runner id zero remains admission failure", () => {
  const out = classify({...run(),conclusion:"failure"},
    [{...job(),runner_id:0,steps:[],conclusion:"failure"}]);
  assert.equal(out.classification,"RUNNER_ADMISSION_FAILURE");
  assert.equal(out.executedSteps,0);
});

test("a green metadata-only run is not guest execution or certified parity", () => {
  assert.equal(classify().classification, "EXECUTED_STEPS_UNVERIFIED");
  const j = job(); j.steps.pop();
  assert.equal(classify(run(), [j]).classification, "NO_REQUIRED_EXECUTION");
  const failed = job(); failed.steps[1].conclusion = "failure";
  assert.equal(classify({...run(), conclusion:"failure"}, [{...failed, conclusion:"failure"}]).classification,
    "EXECUTION_FAILED");
});
test("identity, attempt, duplicate-name and runner attacks are fail closed", () => {
  assert.throws(() => classify({...run(), head_sha: "b".repeat(40)}), /expected PR head/);
  assert.throws(() => classify({...run(), run_attempt: 0}), /identity/);
  assert.throws(() => classify({...run(), id: 0}), /identity/);
  assert.equal(classify(run(), [job(), job()]).classification, "UNTRUSTED_EVIDENCE");
  assert.equal(classify(run(), [{...job(), runner_id: 0}]).classification, "UNTRUSTED_EVIDENCE");
  const duplicate = job(); duplicate.steps.push({...duplicate.steps[1], number: 3});
  assert.equal(classify(run(), [duplicate]).classification, "UNTRUSTED_EVIDENCE");
  const forgedNumber = job(); forgedNumber.steps[1].number = 1;
  assert.equal(classify(run(), [forgedNumber]).classification, "UNTRUSTED_EVIDENCE");
  const idMismatch = job(); idMismatch.run_id += 1;
  assert.equal(classify(run(), [idMismatch]).classification, "UNTRUSTED_EVIDENCE");
  const attemptMismatch = job(); attemptMismatch.run_attempt += 1;
  assert.equal(classify(run(), [attemptMismatch]).classification, "UNTRUSTED_EVIDENCE");
  const headMismatch = job(); headMismatch.head_sha = "b".repeat(40);
  assert.equal(classify(run(), [headMismatch]).classification, "UNTRUSTED_EVIDENCE");
  const stepOrder = job(); stepOrder.steps.reverse();
  assert.equal(classify(run(), [stepOrder]).classification, "UNTRUSTED_EVIDENCE");
  const forgedStepState = job(); forgedStepState.steps[1].status = "queued";
  assert.equal(classify(run(), [forgedStepState]).classification, "UNTRUSTED_EVIDENCE");
  const forgedConclusion = job(); forgedConclusion.steps[1].conclusion = null;
  assert.equal(classify(run(), [forgedConclusion]).classification, "UNTRUSTED_EVIDENCE");
  assert.throws(() => classifyAttoRun({
    run: {...run(), path: ".github/workflows/unrelated.yml"},
    jobs: [job()], expectedHead: head, expectedJob: "core-baremetal",
    expectedWorkflowPath: ".github/workflows/atto-library-profiles-v1.yml",
    requiredSteps: ["Verify exact source revision"]
  }), /workflow path/);
});

test("run still in progress, missing jobs and incomplete steps are not PASS", () => {
  assert.equal(classify({...run(), status: "in_progress", conclusion: null}).classification, "IN_PROGRESS");
  assert.equal(classify(run(), []).classification, "NOT_EXECUTED");
  const step = job(); step.steps[1].status = "queued"; step.steps[1].conclusion = null;
  assert.equal(classify(run(), [step]).classification, "UNTRUSTED_EVIDENCE");
});
