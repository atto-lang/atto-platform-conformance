import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {classifyAttoRun} from "../lib/atto-library-run-evidence-v1.mjs";

const fixture = JSON.parse(readFileSync(fileURLToPath(
  new URL("../evidence/atto-library-source-only-runner-admission-20261107.json", import.meta.url)),
  "utf8"));

test("source-owned GitHub Actions attempt 1 and retry 2 both fail before any steps", () => {
  assert.equal(fixture.schemaVersion,1);
  assert.equal(fixture.classification,"SOURCE_OWNED_RUNNER_ADMISSION_FAILURE");
  assert.deepEqual(fixture.attempts.map(a=>a.run_attempt),[1,2]);
  assert.equal(fixture.run.id,42316175135);
  for(const attempt of fixture.attempts) {
    assert.equal(attempt.job.run_id,fixture.run.id);
    assert.equal(attempt.job.head_sha,fixture.head_sha);
    assert.equal(attempt.job.runner_id,0);
    assert.deepEqual(attempt.job.steps,[]);
    const result=classifyAttoRun({
      run:{...fixture.run,run_attempt:attempt.run_attempt},
      jobs:[attempt.job],expectedHead:fixture.head_sha,
      expectedJob:"source-contract",expectedWorkflowPath:fixture.path,
      requiredSteps:["Checkout immutable PR head"]
    });
    assert.deepEqual(result,{classification:"RUNNER_ADMISSION_FAILURE",
      reason:"ZERO_REPORTED_JOB_STEPS",executedSteps:0});
  }
  assert.equal(fixture.guestExecution,"NOT_EXECUTED");
});

test("cross-attempt job substitution never promotes a source-only job",()=>{
  for(const a of fixture.attempts) {
    const different=fixture.attempts.find(x=>x.run_attempt!==a.run_attempt);
    const job={...different.job,steps:[{number:1,name:"Checkout immutable PR head",
      status:"completed",conclusion:"success"}],runner_id:77,status:"completed",conclusion:"success"};
    const run={...fixture.run,run_attempt:a.run_attempt,status:"completed",conclusion:"success"};
    const result=classifyAttoRun({
      run,jobs:[job],expectedHead:fixture.head_sha,
      expectedJob:"source-contract",expectedWorkflowPath:fixture.path,
      requiredSteps:["Checkout immutable PR head"]
    });
    assert.equal(result.classification,"UNTRUSTED_EVIDENCE");
    assert.equal(result.reason,"JOB_RUN_ATTEMPT_OR_HEAD_MISMATCH");
  }
});
