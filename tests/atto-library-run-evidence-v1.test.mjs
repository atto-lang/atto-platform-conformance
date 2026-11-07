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
