import test from "node:test";
import assert from "node:assert/strict";
import { assessRun } from "../bin/diagnose-actions.mjs";
const run = {id: 123, status: "completed", conclusion: "failure", head_sha: "a".repeat(40)};
const job = (id, steps, conclusion = "failure", status = "completed") =>
  ({id, name: "harness", status, conclusion, runner_id: steps.length ? 5 : 0, steps});

test("zero-step failure does not diagnose billing or prove CI", () => {
  const out = assessRun(run, {total_count:1, jobs:[job(1, [])]});
  assert.equal(out.classification, "NO_EXECUTED_STEPS");
  assert.equal(out.root_cause_established, false);
  assert.equal(out.permits_merging, false);
  assert.equal(out.jobs[0].step_count, 0);
});
test("failure after steps is distinct from pre-step failure", () => {
  const out = assessRun(run, {total_count:1, jobs:[job(1, [{conclusion:"success"},{conclusion:"failure"}])]});
  assert.equal(out.classification, "EXECUTED_STEPS_WITH_FAILURE");
  assert.equal(out.jobs[0].failed_step_count, 1);
});
test("completed successful steps do not attest compiler parity", () => {
  const out = assessRun({...run,conclusion:"success"}, {
    total_count:1,jobs:[job(1,[{conclusion:"success"}],"success")],
  });
  assert.equal(out.classification, "EXECUTED_STEPS_SUCCEEDED");
  assert.equal(out.permits_merging, false);
});
test("incomplete job pagination cannot certify success", () => {
  const out = assessRun(run, {total_count:2,jobs:[job(1,[{conclusion:"success"}],"success")]});
  assert.equal(out.classification, "INCOMPLETE_JOB_LIST");
});
test("no jobs and queued jobs are separate states", () => {
  assert.equal(assessRun(run, {total_count:0,jobs:[]}).classification, "NO_JOBS_RECORDED");
  assert.equal(assessRun(run, {total_count:1,jobs:[job(2,[],null,"queued")]}).classification, "IN_PROGRESS_OR_QUEUED");
});
test("reject missing or malformed payloads", () => {
  for(const [r,j] of [[null,{}],[{},{}],[run,{}],[run,{jobs:{}}]]) {
    assert.throws(() => assessRun(r,j), /invalid GitHub/);
  }
});
