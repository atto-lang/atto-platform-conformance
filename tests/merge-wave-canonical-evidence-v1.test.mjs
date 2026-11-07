import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalizeMergeEvidence,canonicalizeMergeWave} from '../tools/merge-wave-canonical-evidence-v1.mjs';
import {collectLiveEvidence,readPages} from '../tools/merge-wave-live-evidence-v1.mjs';
import {bindMergeWaveGates} from '../tools/merge-wave-integrated-gates-v1.mjs';
const R='ores-truffle-oreslang/oreslang-source.java';
const H='a'.repeat(40),B='b'.repeat(40),T='c'.repeat(40),AT='2026-11-06T22:30:00Z';
const clone=x=>JSON.parse(JSON.stringify(x));
function pair(repo=R,number=7){
 const ids={head_sha:H,base_sha:B,tree_sha:T};
 return {audit:{schema_version:1,target:{repo,number},observed_at:AT,status:'BLOCKED',
  merge_authorized:false,compiler_guest_certified:false,facts:{...ids},
  gates:{review:{status:'BLOCKED',blockers:['NO_REVIEW']}},blockers:['REVIEW_GATE_BLOCKED']},
 live:{schema:1,target:{repo,number,...ids},as_of:AT,status:'BLOCKED',
  merge_authorized:false,guest_certified:false,reviews:{complete:true,observed:0},
  check_runs:{complete:true},workflow_runs:{complete:true},
  executions:[],gaps:['MAIN_NOT_PROTECTED']}};
}
const has=(r,c)=>r.blockers.includes(c);
const job=(p={})=>({run_id:120,attempt:1,job_id:300,runner_id:null,
 steps_count:0,state:'NOT_EXECUTED',...p});
test('consistent envelope stays BLOCKED without release certification',()=>{
 const r=canonicalizeMergeEvidence(pair());
 assert.equal(r.contract_valid,true);assert.equal(r.status,'BLOCKED');
 assert.equal(r.merge_authorized,false);assert.equal(r.guest_parity_certified,false);
 assert.equal(r.target.tree_sha,T);
});
test('zero-step runnerless jobs classify NOT_EXECUTED',()=>{
 for(const j of [job(),job({runner_id:0,steps_count:null})]){
  const x=pair();x.live.executions=[j];
  const r=canonicalizeMergeEvidence(x);
  assert.equal(r.ci.classification,'NOT_EXECUTED');
  assert.equal(r.ci.jobs[0].evidence_class,'NOT_EXECUTED');
  assert.equal(r.ci.execution_verified,false);
 }
});
test('reported successful runner remains UNATTESTED',()=>{
 const x=pair();x.live.executions=[job({runner_id:123,steps_count:4,state:'RUNNER_EXECUTED_SUCCESS'})];
 const r=canonicalizeMergeEvidence(x);
 assert.equal(r.ci.classification,'REPORTED_EXECUTION_UNATTESTED');
 assert.equal(r.merge_authorized,false);assert.equal(r.ci.execution_verified,false);
});
test('fake success with missing runner or steps blocks',()=>{
 for(const p of [{runner_id:null,steps_count:3},{runner_id:123,steps_count:0}]){
  const x=pair();x.live.executions=[job({...p,state:'RUNNER_EXECUTED_SUCCESS'})];
  assert(has(canonicalizeMergeEvidence(x),'JOB_EVIDENCE_CONTRADICTORY'));
 }
});
test('NOT_EXECUTED with runner or actual steps blocks',()=>{
 for(const p of [{runner_id:123},{steps_count:2}]){
  const x=pair();x.live.executions=[job(p)];
  assert(has(canonicalizeMergeEvidence(x),'JOB_EVIDENCE_CONTRADICTORY'));
 }
});
test('duplicate job across run attempts blocks',()=>{
 const x=pair();x.live.executions=[job(),job({attempt:2})];
 assert(has(canonicalizeMergeEvidence(x),'JOB_IDENTITY_DUPLICATE'));
});
test('unknown job state, invalid ID and excessive step counts block',()=>{
 for(const p of [{state:'SUCCESS'},{run_id:'120'},{job_id:0},{steps_count:129}]){
  const x=pair();x.live.executions=[job(p)];
  assert(has(canonicalizeMergeEvidence(x),'JOB_ENTRY_INVALID'));
 }
});
test('cross-module head/base/tree mismatch blocks',()=>{
 for(const key of ['head_sha','base_sha','tree_sha']){
  const x=pair();x.live.target[key]='d'.repeat(40);
  assert(has(canonicalizeMergeEvidence(x),'GIT_IDENTITY_CONFLICT'),key);
 }
});
test('repo/PR mismatches block',()=>{
 for(const patch of [{repo:'ores-truffle-oreslang/oreslang-source.llvm'},{number:8}]){
  const x=pair();Object.assign(x.live.target,patch);
  assert(has(canonicalizeMergeEvidence(x),'TARGET_CONFLICT'));
 }
});
test('object-coercing Git identities and repository values block',()=>{
 for(const key of ['head_sha','base_sha','tree_sha']){
  const x=pair();x.audit.facts[key]={toString:()=>H};
  assert(has(canonicalizeMergeEvidence(x),'GIT_IDENTITY_INVALID'));
 }
 const x=pair();x.audit.target.repo={toString:()=>R};
 assert(has(canonicalizeMergeEvidence(x),'TARGET_INVALID'));
});
test('invalid calendar timestamps and timezone offsets block',()=>{
 for(const value of ['2026-02-30T22:30:00Z','1900-02-29T22:30:00Z',
   '2026-11-06T24:30:00Z','2026-11-06T22:30:00+00:00']){
  const x=pair();x.audit.observed_at=x.live.as_of=value;
  assert(has(canonicalizeMergeEvidence(x),'OBSERVATION_TIME_INVALID'),value);
 }
});
test('valid leap day remains advisory; differing epochs block',()=>{
 const x=pair();x.audit.observed_at=x.live.as_of='2024-02-29T12:00:00Z';
 assert.equal(canonicalizeMergeEvidence(x).contract_valid,true);
 x.live.as_of='2024-02-29T12:00:01Z';
 assert(has(canonicalizeMergeEvidence(x),'OBSERVATION_EPOCH_MISMATCH'));
});
test('missing review/check/run inventories block',()=>{
 for(const key of ['reviews','check_runs','workflow_runs']){
  const x=pair();delete x.live[key];
  assert.equal(canonicalizeMergeEvidence(x).contract_valid,false,key);
 }
 const y=pair();y.live.reviews.complete=false;
 assert(has(canonicalizeMergeEvidence(y),'REVIEW_HISTORY_INCOMPLETE'));
});
test('forged authorization flags violate the advisory contract',()=>{
 for(const key of ['merge_authorized','compiler_guest_certified']){
  const x=pair();x.audit[key]=true;
  assert(has(canonicalizeMergeEvidence(x),'ADVISORY_CONTRACT_INVALID'));
 }
 const x=pair();x.live.guest_certified=true;
 assert(has(canonicalizeMergeEvidence(x),'ADVISORY_CONTRACT_INVALID'));
});
test('malformed input and getters fail closed',()=>{
 for(const x of [null,[],{}, {audit:[],live:{}},{audit:{},live:null}]){
  const r=canonicalizeMergeEvidence(x);
  assert.equal(r.contract_valid,false);assert.equal(r.status,'BLOCKED');
 }
 const x=pair();Object.defineProperty(x.audit,'facts',{get(){throw Error('poison')}});
 const r=canonicalizeMergeEvidence(x);
 assert.equal(r.contract_valid,false);
 assert(has(r,'INPUT_SHAPE_INVALID')||has(r,'SNAPSHOT_EVALUATION_FAILED'));
});
test('control bytes in untrusted blocker text are not serialized',()=>{
 const x=pair();x.live.gaps=['BAD\nsecret'];
 const r=canonicalizeMergeEvidence(x);
 assert(has(r,'BLOCKER_CODES_INVALID'));
 assert(!JSON.stringify(r).includes('BAD\\nsecret'));
});
test('five candidates across three repos never authorize',()=>{
 const names=[R,R,'ores-truffle-oreslang/oreslang-source.llvm',
  'ores-truffle-oreslang/oreslang-source.net','ores-truffle-oreslang/oreslang-source.net'];
 const out=canonicalizeMergeWave(names.map((r,i)=>pair(r,i+1)));
 assert.equal(out.count,5);assert.equal(out.distinct_repos,3);
 assert.equal(out.status,'BLOCKED');assert.equal(out.merge_authorized,false);
});
test('wave blocks duplicate PRs and insufficient repo diversity',()=>{
 const out=canonicalizeMergeWave([pair(),pair(),pair(),pair(),pair()]);
 assert(has(out,'WAVE_DUPLICATE_PR'));assert(has(out,'WAVE_REPOSITORY_DIVERSITY_INVALID'));
});
test('wave blocks missing/excess membership and invalid individual identity',()=>{
 for(const arr of [[],[pair()],[pair(),pair(),pair(),pair(),pair(),pair()]]){
  assert(has(canonicalizeMergeWave(arr),'WAVE_CARDINALITY_INVALID'));
 }
 const list=[pair(R,1),pair(R,2),pair('ores-truffle-oreslang/oreslang-source.llvm',1),
  pair('ores-truffle-oreslang/oreslang-source.net',1),
  pair('ores-truffle-oreslang/oreslang-source.net',2)];
 list[3].live.target.head_sha='d'.repeat(40);
 assert(has(canonicalizeMergeWave(list),'WAVE_MEMBER_CONTRACT_INVALID'));
});
function transport(executed=false){
 const base='/repos/'+R,paths=[];
 const pr={head:{sha:H,repo:{full_name:R,id:55}},
  base:{sha:B,ref:'main',repo:{full_name:R,id:55}},
  state:'open',draft:false,mergeable:true,user:{id:70,login:'dev-author'}};
 const run={id:120,run_attempt:2,head_sha:H,repository:{id:55},head_repository:{id:55},
  event:'pull_request',status:'completed',conclusion:executed?'success':'failure'};
 const j={id:300,run_id:120,run_attempt:2,head_sha:H,
  runner_id:executed?900:null,status:'completed',
  conclusion:executed?'success':'failure',name:'host test',
  steps:executed?[{number:1,name:'Execute host tests',status:'completed',conclusion:'success'}]:[]};
 const get=async path=>{
  paths.push(path);
  if(path===base+'/pulls/7')return clone(pr);
  if(path===base+'/branches/main')return {protected:false,commit:{sha:B}};
  if(path===base+'/branches/main/protection')throw Object.assign(Error('403'),{status:403});
  if(path===base+'/git/commits/'+H)return {sha:H,tree:{sha:T}};
  if(path===base+'/pulls/7/reviews?per_page=100&page=1')return [];
  if(path===base+'/commits/'+H+'/check-runs?per_page=100&page=1')return {total_count:0,check_runs:[]};
  if(path===base+'/actions/runs?head_sha='+H+'&per_page=100&page=1')return {total_count:1,workflow_runs:[run]};
  if(path===base+'/actions/runs/120/attempts/2/jobs?per_page=100&page=1')return {total_count:1,jobs:[j]};
  if(path===base+'/actions/jobs/300')return clone(j);
  throw Error('unexpected GET '+path);
 };
 const bridge=bindMergeWaveGates({
  collectLiveEvidence,readPages,
  qualifyReviewTimeline:()=>({status:'BLOCKED',blockers:['INDEPENDENT_REVIEW_MISSING']}),
  collectExactHeadEvidence:async p=>{
   const runs=await p.listRuns(R,H),jobs=await p.listJobs(R,120,2),steps=await p.listSteps(R,300);
   return {complete:runs.complete&&jobs.complete&&Array.isArray(steps.steps),records:[],gaps:[]};
  },
  qualifyCandidate:()=>[{kind:'test',reason:'RECEIPTS_MISSING'}]
 });
 return {get,paths,bridge};
}
test('real collector and real integration binder classify a zero-step failure',async()=>{
 const f=transport(),now=()=>AT;
 const live=await collectLiveEvidence({repo:R,number:7,get:f.get,now});
 const audit=await f.bridge.auditPR({repo:R,number:7,get:f.get,now});
 const r=canonicalizeMergeEvidence({audit,live});
 assert.equal(r.ci.classification,'NOT_EXECUTED');
 assert.equal(r.ci.jobs.length,1);
 assert.equal(r.ci.jobs[0].evidence_class,'NOT_EXECUTED');
 assert.equal(r.merge_authorized,false);
 assert(f.paths.length>15);
 assert(f.paths.every(x=>x.startsWith('/repos/'+R+'/')));
});
test('real collector and real binder keep reported successful jobs unauthenticated',async()=>{
 const f=transport(true),now=()=>AT;
 const live=await collectLiveEvidence({repo:R,number:7,get:f.get,now});
 const audit=await f.bridge.auditPR({repo:R,number:7,get:f.get,now});
 const r=canonicalizeMergeEvidence({audit,live});
 assert.equal(r.ci.classification,'REPORTED_EXECUTION_UNATTESTED');
 assert.equal(r.ci.execution_verified,false);
 assert.equal(r.guest_parity_certified,false);
});
