import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyRunnerEvidence} from '../runner-evidence.mjs';

// Synthetic records only. There are NO private source files, commits or tokens.
const h = 'a'.repeat(40), repoId = 1357911;
const expected = Object.freeze({commitSha: h, repositoryId: repoId,
  workflow: 'Source-free runner evidence', event: 'push',
  requiredSteps: ['Checkout fixture', 'Execute synthetic unit tests']});
function fixture() {
  const run = {id: 42, repository: {id: repoId}, head_sha: h,
    name: expected.workflow, event: 'push', status: 'completed', conclusion: 'success'};
  const jobs = [{id: 31, run_id: 42, status: 'completed', conclusion: 'success',
    steps: [{number: 1, name: 'Checkout fixture', status: 'completed', conclusion: 'success'},
      {number: 2, name: 'Execute synthetic unit tests', status: 'completed', conclusion: 'success'}]}];
  return {run, jobs, expected: structuredClone(expected)};
}
function outcome(fn) { const o=fixture();fn(o);return classifyRunnerEvidence(o.run,o.jobs,o.expected); }
test('healthy metadata still makes no compiler/release claim', () => {
  const r=outcome(()=>{});assert.equal(r.status,'RUNNER_STEPS_OBSERVED');
  assert.equal(r.sourceCompatibilityVerified,false);assert.equal(r.releaseReady,false);
});
test('zero-step success refused',()=>assert.equal(outcome(x=>x.jobs[0].steps=[]).reason,'NO_EXECUTED_STEPS'));
test('null steps refused',()=>assert.equal(outcome(x=>x.jobs[0].steps=null).reason,'NO_EXECUTED_STEPS'));
test('failed run refused',()=>assert.equal(outcome(x=>x.run.conclusion='failure').reason,'RUN_NOT_SUCCESSFUL'));
test('queued run refused',()=>assert.equal(outcome(x=>x.run.status='queued').reason,'RUN_NOT_SUCCESSFUL'));
test('wrong SHA refused',()=>assert.equal(outcome(x=>x.run.head_sha='b'.repeat(40)).reason,'PROVENANCE_MISMATCH'));
test('wrong repo ID refused',()=>assert.equal(outcome(x=>x.run.repository.id=222).reason,'PROVENANCE_MISMATCH'));
test('ambiguous repo ID type refused',()=>assert.equal(outcome(x=>x.run.repository.id=String(repoId)).reason,'PROVENANCE_MISMATCH'));
test('wrong workflow refused',()=>assert.equal(outcome(x=>x.run.name='Other').reason,'PROVENANCE_MISMATCH'));
test('wrong trigger refused',()=>assert.equal(outcome(x=>x.run.event='workflow_dispatch').reason,'PROVENANCE_MISMATCH'));
test('job from another run refused',()=>assert.equal(outcome(x=>x.jobs[0].run_id=43).reason,'JOB_NOT_SUCCESSFUL'));
test('job without success refused',()=>assert.equal(outcome(x=>x.jobs[0].conclusion='failure').reason,'JOB_NOT_SUCCESSFUL'));
test('missing test step refused',()=>assert.equal(outcome(x=>x.jobs[0].steps.pop()).reason,'REQUIRED_TEST_STEP_MISSING'));
test('skipped test step refused',()=>assert.equal(outcome(x=>x.jobs[0].steps[1].conclusion='skipped').reason,'STEP_NOT_SUCCESSFUL'));
test('incomplete test step refused',()=>assert.equal(outcome(x=>x.jobs[0].steps[1].status='in_progress').reason,'STEP_NOT_SUCCESSFUL'));
test('duplicate step label refused',()=>assert.equal(outcome(x=>x.jobs[0].steps[1].name=x.jobs[0].steps[0].name).reason,'AMBIGUOUS_STEP_NAME'));
test('missing expected checks refused',()=>assert.equal(outcome(x=>x.expected.requiredSteps=[]).reason,'INVALID_EXPECTATIONS'));
test('duplicate expected checks refused',()=>assert.equal(outcome(x=>x.expected.requiredSteps=['A','A']).reason,'INVALID_EXPECTATIONS'));
test('invalid expectations SHA refused',()=>assert.equal(outcome(x=>x.expected.commitSha='HEAD').reason,'INVALID_EXPECTATIONS'));
test('no jobs refused',()=>assert.equal(outcome(x=>x.jobs=[]).reason,'JOB_NOT_SUCCESSFUL'));
