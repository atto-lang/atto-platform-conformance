import test from 'node:test';
import assert from 'node:assert/strict';
import {WAVES,validatePinnedWave,classifyJob,inspectOne,auditLive} from '../tools/wave-two-postmerge-intake-20261106.mjs';
const all=WAVES.flat(),t=all[0],A='a'.repeat(40);
function fake({unprotected=true,zeroSteps=true,approval=false}={}){
  const records={};
  for(const x of all){
    const root=`/repos/${x.repo}`;
    const branch={name:'main',commit:{sha:x.merge},protected:!unprotected};
    records[`${root}/pulls/${x.number}`]={number:x.number,state:'closed',merged:true,merge_commit_sha:x.merge,
      head:{sha:x.head,repo:{full_name:x.repo}},base:{ref:'main',repo:{full_name:x.repo}},user:{login:'author'}};
    records[`${root}/branches/main`]=branch;
    records[`${root}/compare/${x.merge}...main`]={merge_base_commit:{sha:x.merge},behind_by:0,ahead_by:0,status:'identical'};
    records[`${root}/pulls/${x.number}/reviews?per_page=100&page=1`]=approval?
      [{state:'APPROVED',commit_id:x.head,user:{login:'genuine-independent-reviewer'}}]:[];
    records[`${root}/branches/main/protection`]={
      required_pull_request_reviews:{required_approving_review_count:1,require_code_owner_reviews:true,dismiss_stale_reviews:true,
        bypass_pull_request_allowances:{users:[],teams:[],apps:[]}},
      enforce_admins:{enabled:true},required_status_checks:{strict:true,checks:[{context:'ci',app_id:15368}]},
      allow_force_pushes:{enabled:false},allow_deletions:{enabled:false}};
    const run={id:1000+x.number,head_sha:x.head,run_attempt:2,event:'pull_request',status:'completed',conclusion:zeroSteps?'failure':'success'};
    records[`${root}/actions/runs?head_sha=${x.head}&per_page=100&page=1`]={total_count:1,workflow_runs:[run]};
    records[`${root}/actions/runs/${run.id}/attempts/2/jobs?per_page=100&page=1`]={total_count:1,
      jobs:[{id:2000+x.number,run_id:run.id,run_attempt:2,head_sha:x.head,runner_id:zeroSteps?0:10,status:'completed',conclusion:zeroSteps?'failure':'success',
        steps:zeroSteps?[]:[{name:'Set up job',status:'completed',conclusion:'success'},
          {name:'Run real tests',status:'completed',conclusion:'success'}]}]};
  }
  const calls=[];
  const get=async path=>{calls.push(path);if(!(path in records))throw Error('404');return structuredClone(records[path]);};
  return {records,get,calls};
}
const key=x=>`/repos/${x.repo}`;
test('pins exactly two five-PR waves across nine distinct repositories',()=>{
  assert.equal(validatePinnedWave(),true);
  assert.equal(all.length,10);assert.equal(new Set(all.map(x=>x.repo)).size,9);
  assert.deepEqual(WAVES.map(w=>new Set(w.map(x=>x.repo)).size),[5,4]);
});
test('offline merge snapshot never authorizes release or guest parity',async()=>{
  const r=await auditLive(fake().get);
  assert.equal(r.status,'BLOCKED');assert.equal(r.merge_authorized,false);
  assert.equal(r.release_authorized,false);assert.equal(r.guest_parity_certified,false);
  assert.equal(r.pr_count,10);assert.equal(r.repo_count,9);
  assert(r.entries.every(x=>x.blockers.includes('MAIN_NOT_PROTECTED') && x.ci_state==='NOT_EXECUTED'));
});
test('even protected, independently reviewed, stepful candidate remains intake only',async()=>{
  const r=await auditLive(fake({unprotected:false,zeroSteps:false,approval:true}).get);
  assert.equal(r.status,'BLOCKED');
  assert(r.entries.every(x=>x.ci_state==='STEPFUL_UNCLASSIFIED'));
  assert(r.entries.every(x=>x.blockers.includes('POSTMERGE_RELEASE_ATTESTATION_REQUIRED')));
});
test('missing per-job runner never supplies executed test proof',()=>{
  const run={id:100,head_sha:A,run_attempt:1,status:'completed',conclusion:'failure'};
  const job={run_id:100,run_attempt:1,head_sha:A,runner_id:0,steps:[],status:'completed',conclusion:'failure'};
  assert.equal(classifyJob(run,job,A),'NOT_EXECUTED');
});
test('null steps cannot count as runner-backed tests',()=>{
  const r={id:10,head_sha:A,run_attempt:1};
  assert.equal(classifyJob(r,{run_id:10,run_attempt:1,runner_id:0,steps:null},A),'STEPS_UNOBSERVED');
});
test('failed executed job not a success',()=>{
  const run={id:10,head_sha:A,run_attempt:1,status:'completed',conclusion:'failure'};
  const job={run_id:10,run_attempt:1,runner_id:10,status:'completed',conclusion:'failure',steps:[{name:'Run tests',status:'completed',conclusion:'failure'}]};
  assert.equal(classifyJob(run,job,A),'EXECUTED_NON_SUCCESS');
});
test('setup-only job cannot masquerade as executed suite',()=>{
  const run={id:10,head_sha:A,run_attempt:1,status:'completed',conclusion:'success'};
  const job={run_id:10,run_attempt:1,runner_id:10,status:'completed',conclusion:'success',steps:[{name:'Set up job',status:'completed',conclusion:'success'},{name:'Post checkout',status:'completed',conclusion:'success'}]};
  assert.equal(classifyJob(run,job,A),'SETUP_ONLY');
});
test('run-attempt mismatch cannot reuse another attempt receipts',()=>{
  const run={id:10,head_sha:A,run_attempt:2};
  const job={run_id:10,run_attempt:1,runner_id:10,steps:[{name:'Run tests',status:'completed',conclusion:'success'}]};
  assert.equal(classifyJob(run,job,A),'IDENTITY_MISMATCH');
});
for(const [name,mutate,blocker] of [
  ['forged PR head',f=>f.records[`${key(t)}/pulls/${t.number}`].head.sha=A,'MERGE_IDENTITY_UNVERIFIED'],
  ['forged merge SHA',f=>f.records[`${key(t)}/pulls/${t.number}`].merge_commit_sha=A,'MERGE_IDENTITY_UNVERIFIED'],
  ['wrong PR base',f=>f.records[`${key(t)}/pulls/${t.number}`].base.ref='evil','MERGE_IDENTITY_UNVERIFIED'],
  ['broken ancestry',f=>f.records[`${key(t)}/compare/${t.merge}...main`].merge_base_commit.sha=A,'LANDED_SHA_NOT_PROVEN_ON_MAIN'],
  ['behind main',f=>f.records[`${key(t)}/compare/${t.merge}...main`].behind_by=1,'LANDED_SHA_NOT_PROVEN_ON_MAIN'],
  ['spoofed owner approval',f=>f.records[`${key(t)}/pulls/${t.number}/reviews?per_page=100&page=1`]=[{state:'APPROVED',commit_id:t.head,user:{login:'the1mills'}}],'INDEPENDENT_HEAD_REVIEW_UNVERIFIED'],
  ['stale head approval',f=>f.records[`${key(t)}/pulls/${t.number}/reviews?per_page=100&page=1`]=[{state:'APPROVED',commit_id:A,user:{login:'independent'}}],'INDEPENDENT_HEAD_REVIEW_UNVERIFIED'],
  ['swapped job run attempt',f=>f.records[`${key(t)}/actions/runs/${1000+t.number}/attempts/2/jobs?per_page=100&page=1`].jobs[0].run_attempt=1,'EXACT_HEAD_CI_NOT_EXECUTED_OR_UNPROVEN'],
  ['truncated run list',f=>f.records[`${key(t)}/actions/runs?head_sha=${t.head}&per_page=100&page=1`].total_count=50,'RUN_COVERAGE_UNVERIFIED'],
  ['truncated job list',f=>f.records[`${key(t)}/actions/runs/${1000+t.number}/attempts/2/jobs?per_page=100&page=1`].total_count=50,'JOB_COVERAGE_UNVERIFIED'],
  ['disabled strict checks',f=>f.records[`${key(t)}/branches/main/protection`].required_status_checks.strict=false,'PROTECTION_NOT_ENFORCED'],
  ['bypass user',f=>f.records[`${key(t)}/branches/main/protection`].required_pull_request_reviews.bypass_pull_request_allowances.users=[{login:'attacker'}],'PROTECTION_NOT_ENFORCED'],
  ['duplicate required check context',f=>f.records[`${key(t)}/branches/main/protection`].required_status_checks.checks.push({context:'ci',app_id:15368}),'PROTECTION_NOT_ENFORCED'],
]) test(name+' fails closed',async()=>{
  const f=fake({unprotected:false,zeroSteps:false,approval:true});mutate(f);
  const r=await inspectOne(f.get,t);assert(r.blockers.includes(blocker),JSON.stringify(r));
});
test('protection API unreadable is not an approval',async()=>{
  const f=fake({unprotected:false,zeroSteps:false,approval:true});
  delete f.records[`${key(t)}/branches/main/protection`];
  const r=await inspectOne(f.get,t);
  assert(r.blockers.includes('PROTECTION_UNREADABLE'));
  assert(r.blockers.includes('PROTECTION_NOT_ENFORCED'));
});
test('malformed three-repo quorum rejects all targets',()=>{
  assert.throws(()=>validatePinnedWave([[t],[t]]),/WAVE_QUORUM/);
  assert.throws(()=>validatePinnedWave([WAVES[0],WAVES[0]]),/DUPLICATE_PR/);
});
test('auditor never calls source-content, write, or cross-org endpoints',async()=>{
  const f=fake();await auditLive(f.get);
  assert(f.calls.every(p=>p.startsWith('/repos/ores-truffle-oreslang/')));
  assert(f.calls.every(p=>!/\/contents\/|\/git\/blobs\/|\/git\/trees\/|\/merges$|\/issues\/|\/check-runs\//.test(p)));
  assert(f.calls.every(p=>!/\/actions\/workflows\//.test(p)));
});
