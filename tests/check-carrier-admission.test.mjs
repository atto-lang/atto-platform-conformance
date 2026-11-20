import test from 'node:test';
import assert from 'node:assert/strict';
import { assessAdmission, checkLiveAdmission, AdmissionFailure } from '../tools/check-carrier-admission.mjs';
const SHA = 'a'.repeat(40);
const expected = {repo:'example-org/canary',repoId:42,runId:123,headSha:SHA,
  workflowPath:'.github/workflows/source-free-canary.yml',workflowBlobSha:'b'.repeat(40),
  jobName:'source-free-check',proofStep:'ADMISSION_PROOF'};
const repo = {full_name:expected.repo,id:42,archived:false};
const run = {id:123,head_sha:SHA,repository:{full_name:expected.repo,id:42},path:expected.workflowPath,
  status:'completed',conclusion:'success',run_attempt:1,event:'push'};
const workflow = {sha:expected.workflowBlobSha,path:expected.workflowPath};
const job = {id:991,run_id:123,run_attempt:1,head_sha:SHA,name:expected.jobName,
  status:'completed',conclusion:'success',runner_id:777,runner_name:'runner-1',
  started_at:'2026-11-20T00:00:00Z',completed_at:'2026-11-20T00:00:02Z',
  steps:[{name:'ADMISSION_PROOF',status:'completed',conclusion:'success'}]};
const inputs=()=>({repository:structuredClone(repo),run:structuredClone(run),jobs:[structuredClone(job)],
  workflow:structuredClone(workflow),expected:structuredClone(expected)});

test('one synthetic positive is classified only as capacity, never guest parity',()=>{
  const result=assessAdmission(inputs());
  assert.equal(result.admitted,true);
  assert.equal(result.successful_step_count,1);
  assert.equal(result.classification,'SOURCE_FREE_CAPACITY_ONLY_NOT_COMPILER_PARITY');
});
const changes=[
 ['archived destination', x=>x.repository.archived=true],
 ['wrong repo',x=>x.run.repository.full_name='elsewhere/other'],
 ['wrong immutable repo id',x=>x.repository.id=43],
 ['wrong head',x=>x.run.head_sha='c'.repeat(40)],
 ['wrong workflow',x=>x.run.path='.github/workflows/dangerous.yml'],
 ['wrong workflow Git blob',x=>x.workflow.sha='c'.repeat(40)],
 ['failed run',x=>x.run.conclusion='failure'],
 ['queued run',x=>x.run.status='queued'],
 ['bad workflow event',x=>x.run.event='pull_request_target'],
 ['no job',x=>x.jobs=[]],
 ['duplicate named job',x=>x.jobs.push(structuredClone(x.jobs[0]))],
 ['wrong job run',x=>x.jobs[0].run_id=555],
 ['stale job attempt',x=>x.jobs[0].run_attempt=2],
 ['failed job',x=>x.jobs[0].conclusion='failure'],
 ['zero runner id',x=>x.jobs[0].runner_id=0],
 ['no runner name',x=>x.jobs[0].runner_name=''],
 ['missing times',x=>x.jobs[0].started_at=null],
 ['inverted times',x=>x.jobs[0].completed_at='2026-11-19T00:00:00Z'],
 ['no steps',x=>x.jobs[0].steps=[]],
 ['queued step',x=>x.jobs[0].steps[0].status='queued'],
 ['failed step',x=>x.jobs[0].steps[0].conclusion='failure'],
 ['wrong proof step',x=>x.jobs[0].steps[0].name='NOT_PROOF'],
 ['checkout step',x=>x.jobs[0].steps[0].name='actions/checkout and ADMISSION_PROOF'],
 ['extra failed step',x=>x.jobs[0].steps.push({name:'failed',status:'completed',conclusion:'failure'})],
 ['wrong expected repo id',x=>x.expected.repoId=666],
 ['missing immutable repo id',x=>delete x.expected.repoId],
 ['wrong expected SHA',x=>x.expected.headSha='c'.repeat(40)]
];
for(const [label,mutate] of changes)test('deny: '+label,()=>{
  const x=inputs();mutate(x);assert.throws(()=>assessAdmission(x),AdmissionFailure);
});

test('live probe denies absent token before making any network call',async()=>{
  let calls=0;
  await assert.rejects(checkLiveAdmission(expected,{token:'',fetchImpl:()=>{calls++;throw Error('network');}}),AdmissionFailure);
  assert.equal(calls,0);
});
test('live probe denies incomplete page of jobs',async()=>{
  const urls=[];
  const fetchImpl=async url=>{
    urls.push(url);
    if(url.endsWith('/repos/example-org/canary'))return {ok:true,json:async()=>repo};
    if(url.endsWith('/actions/runs/123'))return {ok:true,json:async()=>run};
    if(url.includes('/jobs?'))return {ok:true,json:async()=>({total_count:2,jobs:[job]})};
    throw Error('unexpected API '+url);
  };
  await assert.rejects(checkLiveAdmission(expected,{token:'test-token',fetchImpl}),AdmissionFailure);
  assert.equal(urls.length,3);
});
test('live probe fully validates 5 API resources when simulated',async()=>{
  const fetchImpl=async url=>({ok:true,json:async()=>{
    if(url.endsWith('/repos/example-org/canary'))return repo;
    if(url.endsWith('/actions/runs/123'))return run;
    if(url.includes('/jobs?'))return {total_count:1,jobs:[{name:job.name,id:job.id}]};
    if(url.endsWith('/actions/jobs/991'))return job;
    if(url.includes('/contents/'))return workflow;
    throw Error('unexpected '+url);
  }});
  const r=await checkLiveAdmission(expected,{token:'fake',fetchImpl});
  assert.equal(r.admitted,true);
});
