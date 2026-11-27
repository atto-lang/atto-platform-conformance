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
  run_url:'https://api.github.com/repos/'+p.repository+'/actions/runs/'+p.runId,
  url:'https://api.github.com/repos/'+p.repository+'/actions/jobs/144002',
  html_url:'https://github.com/'+p.repository+'/actions/runs/'+p.runId+'/job/144002',
  started_at:iso(0), completed_at:iso(4), steps
};
const run = {
  id:p.runId, workflow_id:p.workflowId, path:p.workflowPath,
  head_sha:p.sourceHead,head_branch:p.branch,
  repository:{id:p.repositoryId,full_name:p.repository,private:true,owner:{id:p.repositoryOwnerId}},
  head_repository:{id:p.repositoryId,full_name:p.repository,private:true,owner:{id:p.repositoryOwnerId}},
  event:'push',run_attempt:14,status:'completed',conclusion:'success',
  created_at:'2026-11-02T05:45:07Z',updated_at:'2026-11-07T01:00:08Z',
  run_started_at:'2026-11-07T01:00:00Z'
};
const workflow={sha:p.workflowBlob,path:p.workflowPath,type:'file'};
const page={total_count:1,jobs:[job]};
const sourceCommit={
  sha:p.sourceHead,
  url:'https://api.github.com/repos/'+p.repository+'/commits/'+p.sourceHead,
  commit:{tree:{sha:p.sourceTree}}
};
const log = [
  '2026-11-07T01:00:00Z Current runner version: 2.338.2',
  '2026-11-07T01:00:00Z Hosted Compute Agent',
  '2026-11-07T01:00:00Z Image: ubuntu-24.04',
  '2026-11-07T01:00:00Z Complete job name: runner-admission',
  '2026-11-07T01:00:00.2500000Z ##[group]Run set -euo pipefail',
  '2026-11-07T01:00:01.2500000Z SOURCE_FREE_RUNNER_ADMITTED=1',
  '2026-11-07T01:00:02.2500000Z SOURCE_FREE_TWO_STEPS_EXECUTED=1'
].join('\n');
const base = {run,page,job,workflow,sourceCommit,log};
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
  assert.equal(actual.receipt.sourceTreeSha,p.sourceTree);
  assert.equal(actual.receipt.repositoryId,p.repositoryId);
  assert.equal(actual.receipt.runnerCheckoutTreeVerified,false);
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
  v.run.run_started_at='2024-02-29T01:00:00Z';
  v.job.started_at='2024-02-29T01:00:00Z';
  v.job.completed_at='2024-02-29T01:00:04Z';
  v.job.steps.forEach((step,i)=>{
    step.started_at='2024-02-29T01:00:0'+i+'Z';
    step.completed_at='2024-02-29T01:00:0'+(i+1)+'Z';
  });
  v.log=v.log.replaceAll('2026-11-07','2024-02-29');
  v.page.jobs[0]=JSON.parse(JSON.stringify(v.job));
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


test('source repository and head repository must actually be private',()=>{
 const v=copy();v.run.repository.private=false;
 assert.ok(errors(v).includes('private-repository-evidence'));
 const f=copy();f.run.head_repository.private=null;
 assert.ok(errors(f).includes('private-repository-evidence'));
});
test('self-hosted runner cannot impersonate a GitHub-hosted Ubuntu label',()=>{
 const v=copy();v.job.runner_group_id=38;v.job.runner_group_name='Self Hosted';
 assert.ok(errors(v).includes('github-hosted-runner-group'));
 const n=copy();n.job.labels.push('self-hosted');
 assert.ok(errors(n).includes('pinned-hosted-runner-label'));
 const m=copy();m.job.runner_name='github-hosted-agent'; 
 assert.ok(errors(m).includes('github-hosted-runner-name'));
});
test('runner group or runner name metadata tampering is denied',()=>{
 for(const [key,val,reason] of [
   ['runner_group_id',null,'github-hosted-runner-group'],
   ['runner_group_name','GitHub Actions Test','github-hosted-runner-group'],
   ['runner_name','GitHub Actions 999002','github-hosted-runner-name']
 ]){
   const v=copy();v.job[key]=val;
   assert.ok(errors(v).includes(reason),key);
 }
});
test('hosted compute and exact image need observed prefixed log headers',()=>{
 for(const [fragment,expected] of [
   ['Hosted Compute Agent','hosted-compute-agent-header'],
   ['Image: ubuntu-24.04','hosted-runner-image-header'],
   ['Complete job name: runner-admission','pinned-job-log-header'],
   ['Current runner version: 2.338.2','runner-version-header']
 ]){
   const v=copy();v.log=v.log.split('\n').filter(x=>!x.includes(fragment)).join('\n');
   assert.ok(errors(v).includes(expected),fragment);
 }
});
test('fake hosted image header printed from user code does not count as runner preamble',()=>{
 const v=copy();
 v.log=v.log.replace('2026-11-07T01:00:00Z Hosted Compute Agent','');
 v.log += '\n2026-11-07T01:00:03Z Hosted Compute Agent';
 assert.ok(errors(v).includes('hosted-compute-agent-header'));
});
test('source-free job must contain precisely four expected steps, never checkout',()=>{
 const v=copy();v.job.steps.splice(1,0,{...v.job.steps[1],name:'Checkout private source',number:2});
 assert.ok(errors(v).includes('exact-source-free-step-count'));
 assert.ok(errors(v).includes('exact-source-free-step-inventory'));
 const n=copy();n.job.steps[0].name='Checkout private source';
 assert.ok(errors(n).includes('exact-source-free-step-inventory'));
});
test('step completion cannot be outside the containing job lifetime',()=>{
 const v=copy();v.job.steps[2].completed_at='2026-11-07T02:00:03Z';
 assert.ok(errors(v).includes('step-within-job-lifetime'));
 const n=copy();n.job.started_at='2026-11-07T02:00:00Z';
 assert.ok(errors(n).includes('step-within-job-lifetime'));
});
test('job timeline must reside within trusted GitHub run creation and update',()=>{
 const v=copy();v.run.created_at='2026-11-07T02:00:00Z';
 assert.ok(errors(v).includes('job-within-pinned-run-lifetime'));
 const n=copy();n.run.updated_at='2026-11-07T00:59:00Z';
 assert.ok(errors(n).includes('job-within-pinned-run-lifetime'));
});
test('calendar-invalid GitHub run time cannot provide a valid execution proof',()=>{
 const v=copy();v.run.created_at='2026-02-30T01:00:00Z';
 assert.ok(errors(v).includes('valid-run-lifetime'));
 const n=copy();n.run.updated_at='2026-11-31T01:00:00Z';
 assert.ok(errors(n).includes('valid-run-lifetime'));
});
test('marker must be timestamped and within the corresponding executed step',()=>{
 const v=copy();v.log=v.log.replace('2026-11-07T01:00:01.2500000Z SOURCE_FREE_RUNNER_ADMITTED=1',
  '2026-11-07T01:00:08Z SOURCE_FREE_RUNNER_ADMITTED=1');
 assert.ok(errors(v).includes('marker-tied-to-executed-step-SOURCE_FREE_RUNNER_ADMITTED=1'));
 const n=copy();n.log=n.log.replace('2026-11-07T01:00:01.2500000Z SOURCE_FREE_RUNNER_ADMITTED=1',
  'SOURCE_FREE_RUNNER_ADMITTED=1');
 assert.ok(errors(n).includes('unattributed-output-SOURCE_FREE_RUNNER_ADMITTED=1'));
});
test('markers cannot appear in reversed timestamp order',()=>{
 const v=copy();
 v.log=v.log.replace('2026-11-07T01:00:01.2500000Z SOURCE_FREE_RUNNER_ADMITTED=1',
  '2026-11-07T01:00:03.2500000Z SOURCE_FREE_RUNNER_ADMITTED=1');
 assert.ok(errors(v).includes('marker-chronological-order'));
});
test('raw unprefixed duplicate markers are not ignored',()=>{
 const v=copy();v.log += '\nSOURCE_FREE_TWO_STEPS_EXECUTED=1';
 assert.ok(errors(v).includes('unattributed-output-SOURCE_FREE_TWO_STEPS_EXECUTED=1'));
});


test('pinned numeric repository ID rejects same-name repo replacement',()=>{
  for(const part of ['repository','head_repository']){
    const v=copy();v.run[part].id=p.repositoryId+1;
    assert.ok(errors(v).includes('pinned-repository-identity'),part);
  }
});
test('pinned owner ID rejects repository moved to another organization',()=>{
  for(const part of ['repository','head_repository']){
    const v=copy();v.run[part].owner.id=p.repositoryOwnerId+1;
    assert.ok(errors(v).includes('pinned-organization-identity'),part);
  }
});
test('Git commit source tree is independent, immutable and required',()=>{
  const v=copy();v.sourceCommit.commit.tree.sha='f'.repeat(40);
  assert.ok(errors(v).includes('immutable-source-git-tree'));
  const n=copy();n.sourceCommit.sha='f'.repeat(40);
  assert.ok(errors(n).includes('immutable-source-git-tree'));
  const missing=copy();delete missing.sourceCommit;
  assert.ok(errors(missing).includes('immutable-source-git-tree'));
});
test('Git commit API origin must be bound to the same source repository',()=>{
  const v=copy();
  v.sourceCommit.url='https://api.github.com/repos/attacker/fake/commits/'+p.sourceHead;
  assert.ok(errors(v).includes('source-commit-api-origin'));
});
test('missing source commit tree object fails closed without exceptions',()=>{
  for(const replacement of [null,{},[],{sha:p.sourceHead},{commit:null}]){
    const v=copy();v.sourceCommit=replacement;
    assert.equal(qualify(v).ok,false);
  }
});
test('independent job list cannot claim failure if job detail claims success',()=>{
  const v=copy();v.page.jobs[0].conclusion='failure';
  assert.ok(errors(v).includes('job-page-detail-conclusion'));
  const n=copy();n.page.jobs[0].status='queued';
  assert.ok(errors(n).includes('job-page-detail-status'));
});
test('job list cannot claim assigned hosted runner when job detail disagrees',()=>{
  for(const [field,value] of [
    ['runner_id',0],
    ['runner_name',''],
    ['runner_group_id',44],
    ['runner_group_name','self-hosted'],
  ]){
    const v=copy();v.page.jobs[0][field]=value;
    assert.ok(errors(v).includes('job-page-detail-'+field),field);
  }
});
test('independent job-list and detail SHA or attempt mismatch is denied',()=>{
  for(const [field,value] of [
    ['run_attempt',15],
    ['run_id',p.runId+1],
    ['head_sha','a'.repeat(40)],
    ['name','other-job']
  ]){
    const v=copy();v.page.jobs[0][field]=value;
    assert.ok(errors(v).includes('job-page-detail-'+field),field);
  }
});
test('a zero-step list cannot be paired with a four-step detail',()=>{
  const v=copy();v.page.jobs[0].steps=[];
  assert.ok(errors(v).includes('job-page-detail-steps'));
  const n=copy();delete n.page.jobs[0].steps;
  assert.ok(errors(n).includes('job-page-detail-steps'));
});
test('job-list step summary cannot hide failure or skipped work',()=>{
  for(const [field,value] of [
    ['conclusion','failure'],['status','in_progress'],
    ['number',12],['name','Skip gate'],
    ['started_at','2026-02-30T01:00:00Z'],
    ['completed_at',null]
  ]){
    const v=copy();v.page.jobs[0].steps[2][field]=value;
    assert.ok(errors(v).includes('job-page-detail-steps'),field);
  }
});
test('job-list timestamps must agree with job-detail timestamps',()=>{
  for(const field of ['started_at','completed_at']){
    const v=copy();v.page.jobs[0][field]='2026-11-07T02:00:00Z';
    assert.ok(errors(v).includes('job-page-detail-'+field),field);
  }
});
test('job-list requested runner labels must match job detail in order',()=>{
  const v=copy();v.page.jobs[0].labels=['ubuntu-22.04'];
  assert.ok(errors(v).includes('job-page-detail-labels'));
  const n=copy();n.page.jobs[0].labels.push('self-hosted');
  assert.ok(errors(n).includes('job-page-detail-labels'));
});
test('job detail URLs must target original source org, run and job',()=>{
  for(const field of ['run_url','url','html_url']){
    const v=copy();
    v.job[field]=v.job[field].replace('ores-truffle-oreslang','attacker-org');
    v.page.jobs[0][field]=v.job[field];
    assert.ok(errors(v).includes('canonical-job-api-urls'),field);
  }
});
test('missing job API origin fields cannot be silently ignored',()=>{
  for(const field of ['run_url','url','html_url']){
    const v=copy();delete v.job[field];delete v.page.jobs[0][field];
    assert.ok(errors(v).includes('job-page-detail-'+field));
    assert.ok(errors(v).includes('canonical-job-api-urls'));
  }
});
test('run-attempt start must be Gregorian-valid and within the run interval',()=>{
  for(const value of ['2026-02-30T01:00:00Z','2026-11-07T02:00:00Z',null]){
    const v=copy();v.run.run_started_at=value;
    assert.ok(errors(v).includes('valid-attempt-start'));
  }
});
test('an older job cannot be reused as proof for a newer successful attempt',()=>{
  const v=copy();v.run.run_started_at='2026-11-07T01:00:05Z';
  assert.ok(errors(v).includes('job-after-current-attempt-start'));
});
test('source tree evidence is not guest checkout or host attestation',()=>{
  const receipt=qualify(copy());
  assert.equal(receipt.ok,true);
  assert.equal(receipt.receipt.sourceTreeSha,p.sourceTree);
  assert.equal(receipt.receipt.sourceCommitTreeResolved,true);
  assert.equal(receipt.receipt.runnerCheckoutTreeVerified,false);
  assert.equal(receipt.receipt.guestTestsExecuted,false);
  assert.equal(receipt.receipt.backendParity,'NOT_EXECUTED');
});
