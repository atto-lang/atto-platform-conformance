import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditGitHubReceipt } from '../bin/verify-scoped-local-github.mjs';
const contract = JSON.parse(readFileSync(new URL('../contracts/scoped-locals-v1.json', import.meta.url)));
const h40='a'.repeat(40), t40='b'.repeat(40), h256='c'.repeat(64);
const repo='ores-truffle-oreslang/oreslang-source.llvm';
function receipt() {
  return {
    schema:'attolang.scoped-local-evidence/1',backend:'llvm',repository:repo,
    prNumber:1389,headSha:h40,rootTreeSha:t40,checkedOutSha:h40,
    compiler:{sourceHeadSha:h40,binarySha256:h256,toolchain:'pinned llvmc'},
    workflow:{runId:7,attempt:2,headSha:h40,jobs:[{
      id:10,runnerId:20,conclusion:'success',steps:[{name:'compile guest',conclusion:'success'}],
    }]},
    scenarios:contract.scenarios.map(s=>({id:s.id,kind:s.kind,checks:[
      ...(s.kind==='compile'||s.kind==='compile-and-runtime'?[{
        phase:'compile-negative',executed:true,assertions:1,logSha256:h256,
        fixtureSha256:h256,jobId:10,exitCode:1,diagnostic:'error: invalid',stdoutBytes:0,artifacts:[],
      }]:[]),
      ...(s.kind!=='compile' ? [
        {phase:'compile-positive',executed:true,assertions:1,logSha256:h256,
          fixtureSha256:h256,jobId:10,exitCode:0,artifactSha256:h256},
        {phase:'guest-run',executed:true,assertions:1,logSha256:h256,
          fixtureSha256:h256,jobId:10,exitCode:0,artifactSha256:h256},
      ]:[]),
    ]})),
  };
}
function github() {
  return {
    pr:{number:1389,head:{sha:h40},base:{repo:{full_name:repo}}},
    commit:{sha:h40,tree:{sha:t40}},
    run:{id:7,run_attempt:2,repository:{full_name:repo},event:'pull_request',
      status:'completed',conclusion:'success',pull_requests:[{number:1389}]},
    jobs:{total_count:1,jobs:[{id:10,run_id:7,run_attempt:2,runner_id:20,status:'completed',
      conclusion:'success',steps:[{name:'compile guest',conclusion:'success'}]}]},
  };
}
function fakeFetch(facts, calls) {
  return async (url, options) => {
    calls.push({url,options});
    const path=new URL(url).pathname;
    const data=path.endsWith('/pulls/1389')?facts.pr:
      path.endsWith('/git/commits/'+h40)?facts.commit:
      path.endsWith('/actions/runs/7')?facts.run:
      path.includes('/attempts/2/jobs')?facts.jobs:undefined;
    if (!data) return {ok:false,status:404};
    return {ok:true,json:async()=>structuredClone(data)};
  };
}
async function check(mutateReceipt=()=>{},mutateFacts=()=>{}) {
  const r=receipt(),f=github(),calls=[];
  mutateReceipt(r);mutateFacts(f);
  return {v:await auditGitHubReceipt(r,contract,{fetchImpl:fakeFetch(f,calls),token:'test-token'}),calls};
}
test('readback only upgrades GitHub metadata, never guest or parity evidence',async()=>{
  const {v,calls}=await check();
  assert.equal(v.status,'GITHUB_METADATA_MATCH_GUEST_UNATTESTED');
  assert.equal(v.githubMetadataVerified,true);
  assert.equal(v.guestExecutionVerified,false);
  assert.equal(v.parityVerified,false);
  assert.equal(calls.length,4);
  assert.ok(calls.every(x=>x.url.startsWith('https://api.github.com/repos/'+repo)));
  assert.ok(calls.every(x=>x.options.redirect==='error'));
  assert.ok(calls.some(x=>x.url.includes('/attempts/2/jobs?')));
});
test('PR head and Git tree mismatch deny even when self report agrees',async()=>{
  for (const mutation of [
    f=>f.pr.head.sha='d'.repeat(40),
    f=>f.commit.tree.sha='e'.repeat(40),
    f=>f.pr.base.repo.full_name='other/foreign',
  ]) {
    const {v}=await check(()=>{},mutation);
    assert.equal(v.githubMetadataVerified,false);
    assert.ok(v.errors.some(e=>e.includes('MISMATCH')),JSON.stringify(v.errors));
  }
});
test('workflow mismatched attempt, event, repo or PR association reject',async()=>{
  for (const mutation of [
    f=>f.run.run_attempt=1,
    f=>f.run.event='workflow_dispatch',
    f=>f.run.repository.full_name='other/foreign',
    f=>f.run.pull_requests=[],
  ]) assert.equal((await check(()=>{},mutation)).v.githubMetadataVerified,false);
});
test('runner not allocated and null steps reject independently of receipt',async()=>{
  for (const mutation of [
    f=>f.jobs.jobs[0].runner_id=0,
    f=>f.jobs.jobs[0].steps=null,
    f=>f.jobs.jobs[0].conclusion='failure',
    f=>f.jobs.jobs[0].run_attempt=1,
  ]) assert.equal((await check(()=>{},mutation)).v.githubMetadataVerified,false);
});
test('job step replay and unbound scenario checks reject',async()=>{
  const a=await check(()=>{},f=>f.jobs.jobs[0].steps[0].name='unrelated');
  assert.ok(a.v.errors.some(e=>e.startsWith('JOB_STEPS_READBACK_MISMATCH')));
  const b=await check(r=>r.scenarios[0].checks[0].jobId=999);
  assert.ok(b.v.errors.some(e=>e.startsWith('UNBOUND_SCENARIO_JOB')));
});
test('provider 403/404 or API failure cannot promote',async()=>{
  for(const status of [403,404,429,500]) {
    const v=await auditGitHubReceipt(receipt(),contract,{fetchImpl:async()=>({ok:false,status})});
    assert.equal(v.githubMetadataVerified,false);
    assert.ok(v.errors.some(e=>e.includes(`GITHUB_HTTP_${status}`)));
  }
});
test('zero-step shape gate never performs network requests',async()=>{
  const r=receipt();r.workflow.jobs[0].steps=[];
  let called=false;
  const v=await auditGitHubReceipt(r,contract,{fetchImpl:async()=>{called=true;throw Error('should not call');}});
  assert.equal(called,false);
  assert.equal(v.githubMetadataVerified,false);
  assert.ok(v.errors.some(e=>e.startsWith('RUNNER_ADMISSION_FAILURE')));
});
test('duplicate API job IDs fail closed',async()=>{
  const {v}=await check(()=>{}, f=>{f.jobs.jobs.push({...f.jobs.jobs[0]});f.jobs.total_count=2;});
  assert.ok(v.errors.includes('DUPLICATE_PROVIDER_JOB'));
});
