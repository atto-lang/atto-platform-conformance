import test from 'node:test';
import assert from 'node:assert/strict';
import {collectBoundRun,assessBoundRun,readBoundedGitHubJson,WORKFLOW,REQUIRED_STEPS} from '../src/verified-actions.mjs';

const repo='ores-truffle-oreslang/oreslang-platform-conformance';
const head='b7a948b94b5068c16970354eda5ad53cd23a4831',id=38996243957,pr=63;
const req=()=>({runId:id,expectedHead:head,expectedPr:pr,attempt:1});
const sample=()=>({
 run:{id,head_sha:head,run_attempt:1,status:'completed',conclusion:'failure',repository:{full_name:repo},
  event:'pull_request',workflow_id:WORKFLOW.id,path:WORKFLOW.path,head_repository:{full_name:repo},head_branch:'feature-review',
  pull_requests:[{number:pr,head:{sha:head}}]},
 jobs:[{id:117289330521,run_id:id,run_attempt:1,head_sha:head,status:'completed',conclusion:'failure',
   name:WORKFLOW.job,workflow_name:WORKFLOW.name,steps:[]}],artifacts:[]
});
const step=(name,conclusion='success')=>({name,status:'completed',conclusion});
const full=()=>{
 const s=sample();s.jobs[0].steps=REQUIRED_STEPS.map(x=>step(x));
 s.run.conclusion='success';s.jobs[0].conclusion='success';return s;
};
const report=(data)=>({id:12345,name:WORKFLOW.artifact,size_in_bytes:1024,expired:false,
 workflow_run:{id,head_sha:head}});
const mock=(data,seen)=>async (url,init)=>{
 seen.push({url,method:init.method,redirect:init.redirect});
 const payload=url.endsWith('/jobs?per_page=100')?{total_count:data.jobs.length,jobs:data.jobs}:
   url.endsWith('/artifacts?per_page=100')?{total_count:data.artifacts.length,artifacts:data.artifacts}:data.run;
 return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});
};
test('51 / exact pinned workflow, reviewed PR and source head accept zero-step diagnosis',()=>{
 const r=assessBoundRun(sample(),req());
 assert.equal(r.status,'NO_EXECUTED_TEST_EVIDENCE');
 assert.equal(r.workflowId,WORKFLOW.id);assert.equal(r.pr,pr);
 assert.equal(r.releaseCertified,false);assert.equal(r.sourceCompilerExecuted,false);
});
test('51 / same commit in a different workflow is rejected',()=>{
 for(const modify of [s=>s.run.workflow_id++,s=>s.run.path='.github/workflows/other.yml',
  s=>s.jobs[0].name='unrelated-job',s=>s.jobs[0].workflow_name='unrelated-name']){
  const x=sample();modify(x);assert.throws(()=>assessBoundRun(x,req()),/verified-actions/);
 }
});
test('51 / forks, unrelated PRs, stale PR head and non-PR events rejected',()=>{
 for(const modify of [s=>s.run.head_repository.full_name='fork/repo',
 s=>s.run.pull_requests[0].number=62,s=>s.run.pull_requests[0].head.sha='0'.repeat(40),
 s=>s.run.pull_requests=[],s=>s.run.event='workflow_dispatch']){
  const x=sample();modify(x);assert.throws(()=>assessBoundRun(x,req()),/verified-actions/);
 }
});
test('51 / expected PR required and cannot be silently inferred from run ID',()=>{
 assert.throws(()=>assessBoundRun(sample(),{runId:id,expectedHead:head}),/positive expected PR/);
 assert.throws(()=>assessBoundRun(sample(),{...req(),expectedPr:64}),/binding/);
});
test('52 / full ordered completed steps plus one artifact stay metadata-only',()=>{
 const x=full();x.artifacts.push(report(x));
 const r=assessBoundRun(x,req());
 assert.equal(r.status,'HOST_STEPS_AND_ARTIFACT_METADATA_ONLY');
 assert.equal(r.completedSteps,REQUIRED_STEPS.length);
 assert.equal(r.matchingHostArtifactMetadata,true);assert.equal(r.reportContentsValidated,false);
 assert.equal(r.backendParityCertified,false);
});
test('52 / synthetic perfect steps without report artifact are blocked',()=>{
 const r=assessBoundRun(full(),req());
 assert.equal(r.status,'HOST_REPORT_MISSING');assert.equal(r.hostConformanceCertified,false);
});
test('52 / partial, reordered, skipped or failed steps cannot claim successful host evidence',()=>{
 const mutators=[
  x=>x.jobs[0].steps.pop(),
  x=>[x.jobs[0].steps[2],x.jobs[0].steps[3]]=[x.jobs[0].steps[3],x.jobs[0].steps[2]],
  x=>x.jobs[0].steps[2].conclusion='failure',
  x=>x.jobs[0].steps[6].conclusion='skipped',
  x=>x.jobs[0].steps[0].status='queued'
 ];
 for(const edit of mutators){
  const x=full();x.artifacts=[report(x)];edit(x);
  assert.equal(assessBoundRun(x,req()).status,'PARTIAL_EXECUTION_NOT_HOST_PROOF');
 }
});
test('52 / duplicate step names and duplicate artifacts are rejected',()=>{
 const x=full();x.jobs[0].steps.push(step(REQUIRED_STEPS[0]));
 assert.throws(()=>assessBoundRun(x,req()),/duplicate/);
 const a=full();a.artifacts=[report(a),report(a)];
 assert.throws(()=>assessBoundRun(a,req()),/duplicate artifact/);
});
test('53 / zero completed steps with attached artifact metadata fail closed',()=>{
 const x=sample();x.artifacts=[report(x)];
 assert.throws(()=>assessBoundRun(x,req()),/without executed steps/);
});
test('53 / artifact linked to wrong source revision is rejected',()=>{
 const x=full();x.artifacts=[report(x)];x.artifacts[0].workflow_run.head_sha='0'.repeat(40);
 assert.throws(()=>assessBoundRun(x,req()),/artifact head/);
});
test('53 / queued and skipped steps are not proof of test execution',()=>{
 const x=sample();x.jobs[0].steps=[{name:'Set up Node 22',status:'queued',conclusion:null},
  {name:'Check out integration driver',status:'completed',conclusion:'skipped'}];
 const r=assessBoundRun(x,req());
 assert.equal(r.status,'NO_EXECUTED_TEST_EVIDENCE');
});
test('54 / bounded streaming collector requests only exact three GitHub URLs',async()=>{
 const seen=[];const r=await collectBoundRun({...req(),fetchImpl:mock(sample(),seen)});
 assert.equal(r.status,'NO_EXECUTED_TEST_EVIDENCE');assert.equal(seen.length,3);
 assert.ok(seen.every(x=>x.method==='GET'&&x.redirect==='error'&&x.url.startsWith('https://api.github.com/repos/'+repo+'/actions/runs/'+id)));
});
test('54 / oversized declared Content-Length is rejected without reading body',async()=>{
 const f=async()=>new Response('{"ok":true}',{headers:{'content-type':'application/json','content-length':'9999999'}});
 await assert.rejects(readBoundedGitHubJson('https://api.github.com/repos/'+repo+'/actions/runs/'+id,{fetchImpl:f,maxBytes:128}),/content length/);
});
test('54 / streamed response over strict byte budget rejects, never calls .text()',async()=>{
 const f=async()=>({status:200,headers:{get:k=>k==='content-type'?'application/json':null},
  text:()=>{throw Error('unsafe text read')},
  body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(200)));c.close()}})});
 await assert.rejects(readBoundedGitHubJson('https://api.github.com/repos/'+repo+'/actions/runs/'+id,{fetchImpl:f,maxBytes:128}),/byte budget/);
});
test('54 / HTML, unauthorized, redirect, missing reader and invalid UTF8 deny',async()=>{
 const u='https://api.github.com/repos/'+repo+'/actions/runs/'+id;
 const bad=[
  async()=>new Response('Forbidden',{status:403}),
  async()=>new Response('<html>',{headers:{'content-type':'text/html'}}),
  async()=>({status:200,url:'https://evil.invalid/',headers:{get:()=>null}}),
  async()=>({status:200,headers:{get:k=>k==='content-type'?'application/json':null},body:null}),
  async()=>({status:200,headers:{get:k=>k==='content-type'?'application/json':null},
    body:new ReadableStream({start(c){c.enqueue(new Uint8Array([0xff]));c.close()}})})
 ];
 for(const fetchImpl of bad)await assert.rejects(readBoundedGitHubJson(u,{fetchImpl,maxBytes:128}),/verified-actions/);
});
test('55 / truncated job and artifact pagination refuses false completeness',async()=>{
 const sampleData=sample();const base='https://api.github.com/repos/'+repo+'/actions/runs/'+id;
 const custom=async url=>{
  if(url===base)return new Response(JSON.stringify(sampleData.run),{headers:{'content-type':'application/json'}});
  const o=url.includes('/jobs?')?{total_count:2,jobs:sampleData.jobs}:{total_count:0,artifacts:[]};
  return new Response(JSON.stringify(o),{headers:{'content-type':'application/json'}});
 };
 await assert.rejects(collectBoundRun({...req(),fetchImpl:custom}),/pagination/);
});
test('55 / exact live-observation shape never returns certified source backend parity',()=>{
 const x=sample(),r=assessBoundRun(x,req());
 assert.equal(r.sourceCompilerExecuted,false);assert.equal(r.guestExecuted,false);
 assert.equal(r.backendParityCertified,false);assert.match(r.contentSha256,/^[a-f0-9]{64}$/);
});
test('55 / CLI refuses a report without a reviewed PR and never creates an output',async()=>{
 const {spawnSync}=await import('node:child_process');
 const {mkdtemp,access,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const folder=await mkdtemp(join(tmpdir(),'ores-verified-ci-'));
 try{
  const output=join(folder,'report.json');
  const r=spawnSync(process.execPath,[new URL('../bin/audit.mjs',import.meta.url).pathname,'--run-id='+id,'--head='+head,'--output='+output],{encoding:'utf8',env:{PATH:process.env.PATH,HOME:process.env.HOME}});
  assert.equal(r.status,2);
  await assert.rejects(access(output),{code:'ENOENT'});
 } finally {await rm(folder,{recursive:true,force:true})}
});
test('52 / contradictory failed workflow or job cannot promote perfect step lists',()=>{
 const runFailed=full();runFailed.artifacts=[report(runFailed)];runFailed.run.conclusion='failure';
 assert.equal(assessBoundRun(runFailed,req()).status,'PARTIAL_EXECUTION_NOT_HOST_PROOF');
 const jobFailed=full();jobFailed.artifacts=[report(jobFailed)];jobFailed.jobs[0].conclusion='failure';
 assert.equal(assessBoundRun(jobFailed,req()).status,'PARTIAL_EXECUTION_NOT_HOST_PROOF');
});
