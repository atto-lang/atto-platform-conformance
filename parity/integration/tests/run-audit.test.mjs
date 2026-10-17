import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {collectRun,classifyRun,validateRequest} from '../src/run-audit.mjs';
const head='92de646a31161763a8ee5475d64f55bd3454171f',repository='ores-truffle-oreslang/oreslang-platform-conformance',runId=38994392059;
const base=()=>({run:{id:runId,head_sha:head,run_attempt:1,status:'completed',conclusion:'failure',repository:{full_name:repository},event:'pull_request'},
 jobs:[{id:117283591225,run_id:runId,run_attempt:1,head_sha:head,status:'completed',conclusion:'failure',steps:[]}],artifacts:[]});
const select=()=>({repository,runId,expectedHead:head,attempt:1});
const jsonResponse=(o)=>({status:200,text:async()=>JSON.stringify(o)});
const requester=(data,urls)=>async url=>{urls.push(url);return jsonResponse(url.endsWith('/jobs?per_page=100')?{total_count:data.jobs.length,jobs:data.jobs}:url.endsWith('/artifacts?per_page=100')?{total_count:data.artifacts.length,artifacts:data.artifacts}:data.run)};
test('46 classify independently observed zero-step failed job with no artifacts as no execution',()=>{
 const result=classifyRun(base(),select());
 assert.equal(result.classification,'NO_EXECUTED_TEST_EVIDENCE');
 assert.equal(result.recordedStepCount,0);assert.deepEqual(result.artifacts,[]);assert.equal(result.releaseCertified,false);assert.match(result.reportSha256,/^[a-f0-9]{64}$/);
});
test('46 no step records cannot become a passing test claim even if GitHub says success',()=>{
 const d=base();d.run.conclusion='success';d.jobs[0].conclusion='success';assert.equal(classifyRun(d,select()).classification,'NO_EXECUTED_TEST_EVIDENCE');
});
test('47 rejects stale head, run ID, attempt, foreign repo and event',()=>{
 const edits=[d=>d.run.head_sha='0'.repeat(40),d=>d.run.id++,d=>d.run.run_attempt=2,d=>d.run.repository.full_name='other/repo',d=>d.run.event='push'];
 for(const edit of edits){const d=base();edit(d);assert.throws(()=>classifyRun(d,select()),/actions-audit/)}
});
test('47 rejects duplicate, cross-run and forged job identities',()=>{
 const d=base();d.jobs.push({...d.jobs[0]});assert.throws(()=>classifyRun(d,select()),/duplicate/);
 for(const edit of [j=>j.run_id++,j=>j.head_sha='0'.repeat(40),j=>j.run_attempt=3]){
  const c=base();edit(c.jobs[0]);assert.throws(()=>classifyRun(c,select()),/identity/);
 }
});
test('48 read-only API collection validates exact URLs and refuses partial pagination',async()=>{
 const urls=[];const result=await collectRun({...select(),fetchImpl:requester(base(),urls)});
 assert.equal(result.classification,'NO_EXECUTED_TEST_EVIDENCE');assert.equal(urls.length,3);assert.ok(urls.every(x=>x.startsWith('https://api.github.com/repos/'+repository+'/actions/runs/'+runId)));
 const wrong=base();wrong.jobs=[];await assert.rejects(collectRun({...select(),fetchImpl:requester(wrong,[])}),/pagination/);
});
test('48 API refuses errors, malformed responses and redirects instead of guessing',async()=>{
 for(const f of [async()=>({status:403,text:async()=>''}),async()=>({status:200,text:async()=>'<html>'}),async()=>({status:200,text:async()=>'{'.repeat(1048577)})])
  await assert.rejects(collectRun({...select(),fetchImpl:f}),/actions-audit/);
});
test('48 successful API run with actual steps is still not certified guest execution',async()=>{
 const d=base();d.run.conclusion='success';d.jobs[0].conclusion='success';d.jobs[0].steps=[{name:'Checkout',status:'completed',conclusion:'success'}];
 const report=await collectRun({...select(),fetchImpl:requester(d,[])});
 assert.equal(report.classification,'STEPS_RECORDED_NOT_COMPILER_PROOF');assert.equal(report.backendParityCertified,false);assert.equal(report.compilerExecuted,false);
});
test('49 output excludes raw logs, tokens and step details',()=>{
 const d=base();d.jobs[0].steps=[{name:'a',status:'completed',conclusion:'failure',secret:'PRIVATE_TOKEN_VALUE'}];
 const report=classifyRun(d,select());assert.equal(JSON.stringify(report).includes('PRIVATE_TOKEN_VALUE'),false);
 assert.equal(report.jobs[0].recordedSteps,1);assert.equal(report.logsExamined,false);
});
test('49 linked workflow artifact must match exact run',()=>{
 const d=base();d.artifacts=[{id:12,name:'host-report',size_in_bytes:200,expired:false,workflow_run:{id:runId+2}}];
 assert.throws(()=>classifyRun(d,select()),/artifact/);
});
test('50 CLI missing token is an API failure; cannot write invented report',async()=>{
 const tmp=await mkdtemp(join(tmpdir(),'ores-actionsaudit-'));
 try{
  const output=join(tmp,'audit.json');
  const proc=spawnSync(process.execPath,[new URL('../bin/audit.mjs',import.meta.url).pathname,'--run-id='+runId,'--head='+head,'--output='+output],{encoding:'utf8',env:{PATH:process.env.PATH,HOME:process.env.HOME}});
  // Environment may have outside network access; no response is independently trusted without a valid read-only token.
  assert.notEqual(proc.status,0);
  await assert.rejects(readFile(output),/ENOENT/);
 }finally{await rm(tmp,{recursive:true,force:true})}
});
test('50 malformed selected run/head/attempt cannot trigger API requests',async()=>{
 for(const q of [{...select(),runId:0},{...select(),expectedHead:'bad'},{...select(),attempt:-1},{...select(),repository:'untrusted/repo'}]){
  assert.throws(()=>validateRequest(q),/actions-audit/);
 }
});

test('46 listed but unexecuted queued or skipped steps are not test execution',()=>{
 const d=base();d.jobs[0].steps=[{name:'Checkout',status:'queued',conclusion:null},{name:'Skipped',status:'completed',conclusion:'skipped'}];
 const a=classifyRun(d,select());assert.equal(a.recordedStepCount,2);assert.equal(a.jobs[0].completedSteps,0);assert.equal(a.classification,'NO_EXECUTED_TEST_EVIDENCE');
});
test('48 a completed failing step remains an observed noncertifying failure',()=>{
 const d=base();d.jobs[0].steps=[{name:'Compile',status:'completed',conclusion:'failure'}];
 const a=classifyRun(d,select());assert.equal(a.jobs[0].completedSteps,1);assert.equal(a.classification,'JOB_EXECUTED_WITH_ERRORS_OR_PARTIAL_STEPS');
 assert.equal(a.releaseCertified,false);
});
