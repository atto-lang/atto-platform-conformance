import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIVATE_RUNNER_CONTROL as p,
  qualifySourceOrgPrivateRunner as qualify
} from '../verification/qualify-private-runner-admission-v1.mjs';

const iso = (i) => '2026-11-07T01:00:0' + i + 'Z';
const steps = [
  'Set up job','Check allocated runner','Verify second executed step','Complete job'
].map((name,i) => ({
  name, number:i+1,status:'completed',conclusion:'success',
  started_at:iso(i),completed_at:iso(i+1)
}));
const job = {
  id:144002, name:p.jobName, run_id:p.runId, run_attempt:14,
  head_sha:p.sourceHead, status:'completed', conclusion:'success',
  runner_id:999001, runner_name:'GitHub Actions 999001',
  runner_group_id:0, runner_group_name:'GitHub Actions',
  labels:['ubuntu-24.04'],
  started_at:iso(0), completed_at:iso(4), steps
};
const run = {
  id:p.runId, workflow_id:p.workflowId, path:p.workflowPath,
  head_sha:p.sourceHead,head_branch:p.branch,
  repository:{full_name:p.repository,private:true},
  head_repository:{full_name:p.repository,private:true},
  event:'push',run_attempt:14,status:'completed',conclusion:'success',
  created_at:'2026-11-02T05:45:07Z',updated_at:'2026-11-07T01:00:08Z'
};
const workflow={sha:p.workflowBlob,path:p.workflowPath,type:'file'};
const page={total_count:1,jobs:[job]};
const log = [
  '2026-11-07T01:00:00Z Current runner version: 2.338.2',
  '2026-11-07T01:00:00Z Hosted Compute Agent',
  '2026-11-07T01:00:00Z Image: ubuntu-24.04',
  '2026-11-07T01:00:00Z Complete job name: runner-admission',
  '2026-11-07T01:00:00.2500000Z ##[group]Run set -euo pipefail',
  '2026-11-07T01:00:01.2500000Z SOURCE_FREE_RUNNER_ADMITTED=1',
  '2026-11-07T01:00:02.2500000Z SOURCE_FREE_TWO_STEPS_EXECUTED=1'
].join('\n');
const base = {run,page,job,workflow,log};
const copy = () => JSON.parse(JSON.stringify(base));
const errors = data => qualify(data).errors;

test('fully correlated source-free canary qualifies admission only, not guest execution',()=>{
  const actual=qualify(copy());
  assert.deepEqual(actual.errors,[]);
  assert.equal(actual.ok,true);
  assert.equal(actual.receipt.evidenceClass,'SOURCE_FREE_PRIVATE_RUNNER_ADMISSION_ONLY');
  assert.equal(actual.receipt.executedSteps,4);
  assert.equal(actual.receipt.guestTestsExecuted,false);
  assert.equal(actual.receipt.backendParity,'NOT_EXECUTED');
  assert.equal(actual.receipt.sourceCheckout,false);
});

test('historical failed attempt 13 with zero runner and steps never qualifies',()=>{
  const v=copy();
  v.run.run_attempt=13;
  v.run.conclusion='failure';
  v.job.run_attempt=13;
  v.job.conclusion='failure';
  v.job.runner_id=0;
  v.job.runner_name='';
  v.job.steps=[];
  assert.ok(errors(v).includes('post-repair-run-attempt'));
  assert.ok(errors(v).includes('runner-admitted'));
  assert.ok(errors(v).includes('bounded-nonzero-job-steps'));
});

test('same-org public or cross-org control cannot satisfy private source-org run',()=>{
  for(const source of ['ores-truffle-oreslang/oreslang-cli','gha-indie-worker/gha-indie-worker-docs']){
    const v=copy();v.run.repository.full_name=source;
    assert.ok(errors(v).includes('source-repository'));
  }
  const v=copy();v.run.head_repository.full_name='gha-indie-worker/gha-indie-worker-docs';
  assert.ok(errors(v).includes('source-head-repository'));
});

test('workflow HEAD and Git blob are non-negotiable and pinned',()=>{
  for(const [key, value, reason] of [
    ['workflow_id',p.workflowId+1,'pinned-workflow-id'],
    ['path','.github/workflows/ci.yml','pinned-workflow-path'],
    ['head_sha','a'.repeat(40),'immutable-source-head'],
    ['head_branch','main','pinned-source-branch'],
    ['event','workflow_dispatch','source-free-trigger'],
  ]){const v=copy();v.run[key]=value;assert.ok(errors(v).includes(reason),key);}
  const v=copy();v.workflow.sha='f'.repeat(40);
  assert.ok(errors(v).includes('immutable-source-free-workflow-blob'));
});

test('independent job page must be bounded, complete and identify same job',()=>{
  for(const candidate of [{total_count:2,jobs:[job]}, {total_count:1,jobs:[]},null,{}]){
    const v=copy();v.page=candidate;
    assert.ok(errors(v).includes('complete-single-job-page'));
  }
  const v=copy();v.page.jobs[0].id+=1;
  assert.ok(errors(v).includes('job-page-detail-identity'));
});

test('forged runner ID or mismatched run attempt does not qualify',()=>{
  const v=copy();v.job.runner_id=0;
  assert.ok(errors(v).includes('runner-admitted'));
  const n=copy();n.job.run_attempt=15;
  assert.ok(errors(n).includes('job-run-attempt'));
  const m=copy();m.job.runner_name='';
  assert.ok(errors(m).includes('runner-identity'));
});

test('missing second executed step, duplicate steps and unsuccessful steps reject',()=>{
  const v=copy();v.job.steps=v.job.steps.filter(x=>x.name!==p.stepNames[1]);
  assert.ok(errors(v).includes('both-source-free-steps-executed'));
  const dupe=copy();dupe.job.steps.push({...dupe.job.steps[2],number:5});
  assert.ok(errors(dupe).includes('unique-step-name'));
  const failed=copy();failed.job.steps[2].conclusion='failure';
  assert.ok(errors(failed).includes('successful-executed-step'));
});

test('script text that merely mentions markers does not count as observed stdout',()=>{
  const v=copy();
  v.log="2026-11-07T01:00:01Z printf 'SOURCE_FREE_RUNNER_ADMITTED=1'\n"
    +"2026-11-07T01:00:02Z printf 'SOURCE_FREE_TWO_STEPS_EXECUTED=1'";
  assert.ok(errors(v).includes('observed-output-SOURCE_FREE_RUNNER_ADMITTED=1'));
  const repeated=copy();repeated.log=repeated.log+'\nSOURCE_FREE_RUNNER_ADMITTED=1';
  assert.ok(errors(repeated).includes('observed-output-SOURCE_FREE_RUNNER_ADMITTED=1'));
});

test('impossible Gregorian dates and overlapping steps reject',()=>{
  const v=copy();v.job.steps[1].started_at='2026-02-30T01:00:00Z';
  assert.ok(errors(v).includes('valid-step-times'));
  const overlap=copy();overlap.job.steps[2].started_at=iso(0);
  assert.ok(errors(overlap).includes('nonoverlapping-step-times'));
});

test('valid leap-day timestamps are permitted when run, job and stdout agree',()=>{
  const v=copy();
  v.run.created_at='2024-02-28T23:59:50Z';
  v.run.updated_at='2024-02-29T01:00:08Z';
  v.job.started_at='2024-02-29T01:00:00Z';
  v.job.completed_at='2024-02-29T01:00:04Z';
  v.job.steps.forEach((step,i)=>{
    step.started_at='2024-02-29T01:00:0'+i+'Z';
    step.completed_at='2024-02-29T01:00:0'+(i+1)+'Z';
  });
  v.log=v.log.replaceAll('2026-11-07','2024-02-29');
  assert.deepEqual(errors(v),[]);
});

test('oversized, missing or unobserved log markers reject',()=>{
  const v=copy();v.log='x'.repeat(262145);
  assert.ok(errors(v).includes('bounded-job-log'));
  const missing=copy();missing.log=missing.log.split('\n').slice(0,1).join('\n');
  assert.ok(errors(missing).includes('observed-output-SOURCE_FREE_TWO_STEPS_EXECUTED=1'));
});

test('no job/partial jobs/null shape can throw or count as success',()=>{
  for(const bad of [null,{},[],{id:p.runId}]){
    const v=copy();v.job=bad;
    assert.equal(qualify(v).ok,false);
  }
});
