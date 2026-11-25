import test from 'node:test';
import assert from 'node:assert/strict';
import {assessActionsJob} from './verify-actions-evidence.mjs';
const head = 'a'.repeat(40);
const base = () => ({
  expected: {repositoryId: 1413795502, headSha: head,
    workflowPath: '.github/workflows/ci.yml', requiredSteps: ['npm test']},
  run: {id: 10, run_attempt: 2, repository: {id: 1413795502},
    head_repository: {id: 1413795502}, head_sha: head,
    path: '.github/workflows/ci.yml@refs/heads/main', event: 'push',
    status: 'completed', conclusion: 'success'},
  job: {id: 20, run_id: 10, run_attempt: 2, head_sha: head,
    runner_id: 1000001, runner_name: 'GitHub Actions 1000001',
    status: 'completed', conclusion: 'success',
    steps: [
      {number:1,name:'Set up job',status:'completed',conclusion:'success'},
      {number:2,name:'npm test',status:'completed',conclusion:'success'},
      {number:3,name:'Complete job',status:'completed',conclusion:'success'}]}
});
const deny = (mutate, regex) => {const x=base(); mutate(x); const out=assessActionsJob(x);
  assert.equal(out.classification, 'INVALID');
  if(regex) assert.match(out.errors.join(';'),regex);
};
test('successful metadata never certifies guest or tree: requires independent review',()=>{
  assert.deepEqual(assessActionsJob(base()),{classification:'REVIEW_REQUIRED',errors:[]});
});
test('zero-step failed runner admission is never passing execution',()=>{
  deny(x=>{x.job.steps=[];x.job.runner_id=0;x.job.conclusion='failure';x.run.conclusion='failure';},/zero substantive/);
});
test('fake all-housekeeping jobs do not count as work',()=>{
  deny(x=>{x.expected.requiredSteps=['Set up job'];x.job.steps.splice(1,1);},/zero substantive/);
});
test('exact head, repository, workflow and attempt are pinned',()=>{
  deny(x=>x.job.head_sha='b'.repeat(40),/exact run/);
  deny(x=>x.run.head_repository.id=99,/mismatches/);
  deny(x=>x.run.repository.id=99,/mismatches/);
  deny(x=>x.run.path='.github/workflows/other.yml@main',/mismatches/);
  deny(x=>x.job.run_attempt=1,/exact run/);
  deny(x=>x.run.run_attempt=1,/exact run/);
});
test('failed, skipped, duplicated or missing required steps are denied',()=>{
  deny(x=>x.job.steps[1].conclusion='skipped',/required executed/);
  deny(x=>x.job.steps.push({...x.job.steps[1],number:4}),/required executed/);
  deny(x=>x.job.steps[1].name='Other test',/required executed/);
  deny(x=>x.job.steps[1].number=1,/duplicated/);
  deny(x=>x.job.conclusion='cancelled',/successfully/);
  deny(x=>x.run.status='queued',/successfully/);
});
test('untrusted expected data and forged accessors are rejected',()=>{
  deny(x=>x.expected.requiredSteps=[],/trusted expectations/);
  deny(x=>x.expected.headSha='a'.repeat(39),/trusted expectations/);
  const x=base(); let calls=0;
  Object.defineProperty(x.job,'steps',{enumerable:true,get(){calls++;return [];}});
  assert.equal(assessActionsJob(x).classification,'INVALID');
  assert.equal(calls,0);
  assert.equal(assessActionsJob({...base(),run:Object.create(base().run)}).classification,'INVALID');
});
test('malformed input and step records fail closed without throwing',()=>{
  assert.equal(assessActionsJob(null).classification,'INVALID');
  assert.equal(assessActionsJob({}).classification,'INVALID');
  deny(x=>x.job.steps=[null],/step inventory/);
  deny(x=>x.job.steps=new Array(257).fill({number:1}),/step inventory/);
});
test('a failed duplicate with an identical required name is not acceptable',()=>{
  deny(x=>x.job.steps.push({number:4,name:'npm test',status:'completed',conclusion:'failure'}),/required executed/);
});
