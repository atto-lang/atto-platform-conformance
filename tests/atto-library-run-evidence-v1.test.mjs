import test from "node:test";
import assert from "node:assert/strict";
import {classifyAttoRun} from "../lib/atto-library-run-evidence-v1.mjs";

const head = "a".repeat(40);
const run = () => ({
  id: 42304693725, head_sha: head, run_attempt: 1,
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
});
test("run still in progress, missing jobs and incomplete steps are not PASS", () => {
  assert.equal(classify({...run(), status: "in_progress", conclusion: null}).classification, "IN_PROGRESS");
  assert.equal(classify(run(), []).classification, "NOT_EXECUTED");
  const step = job(); step.steps[1].status = "queued"; step.steps[1].conclusion = null;
  assert.equal(classify(run(), [step]).classification, "NO_REQUIRED_EXECUTION");
});


test("job snapshots cannot be substituted from a different run, retry or source head", () => {
  for (const [field, bad] of [["run_id", 1], ["run_attempt", 2], ["head_sha", "b".repeat(40)]]) {
    for (const value of [bad, undefined]) {
      const j = job(); j[field] = value;
      assert.deepEqual(classify(run(), [j]), {classification: "UNTRUSTED_EVIDENCE",
        reason: "JOB_RUN_ATTEMPT_HEAD_MISMATCH", executedSteps: 0});
    }
  }
  const retryRun = {...run(), run_attempt: 2};
  const retryJob = {...job(), run_attempt: 2};
  assert.equal(classify(retryRun, [retryJob]).classification, "EXECUTED_STEPS_UNVERIFIED");
});
test("terminal failure steps cannot be hidden by contradictory green job metadata", () => {
  for (const conclusion of ["timed_out", "startup_failure", "action_required", "stale"]) {
    const j = job();
    j.steps.push({number: 3, name: "Additional execution", status: "completed", conclusion});
    assert.equal(classify(run(), [j]).classification, "EXECUTION_FAILED");
  }
});


test("queued empty jobs are pending, and skipped steps are not execution", () => {
  const pending = classify({...run(), status: "queued", conclusion: null},
    [{...job(), status: "queued", conclusion: null, runner_id: 0, steps: []}]);
  assert.deepEqual(pending, {classification: "IN_PROGRESS", reason: "RUN_OR_JOB_INCOMPLETE", executedSteps: 0});
  const j = job();
  j.steps.push({number: 3, name: "Skipped optional job step", status: "completed", conclusion: "skipped"});
  assert.equal(classify(run(), [j]).executedSteps, 2);
  j.steps[1].conclusion = "skipped";
  assert.equal(classify(run(), [j]).classification, "NO_REQUIRED_EXECUTION");
  assert.equal(classify(run(), [j]).executedSteps, 1);
});
