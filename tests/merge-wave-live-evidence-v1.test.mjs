import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyJob,readPages,collectLiveEvidence,collectWaveEvidence} from '../tools/merge-wave-live-evidence-v1.mjs';
const A='a'.repeat(40), B='b'.repeat(40), C='c'.repeat(40);
const repo='ores-truffle-oreslang/oreslang-source.java';
const root=`/repos/${repo}`;
const deepCopy=v=>structuredClone(v);
function fake() {
  const pr={id:10,number:12,state:'open',draft:false,mergeable:true,user:{id:11,login:'author'},
    head:{sha:A,repo:{id:900,full_name:repo}},base:{ref:'main',sha:B,repo:{id:900,full_name:repo}}};
  const branch={name:'main',protected:true,commit:{sha:B}};
  const policy={required_pull_request_reviews:{require_code_owner_reviews:true,dismiss_stale_reviews:true,required_approving_review_count:1,
    bypass_pull_request_allowances:{users:[],teams:[],apps:[]}},
    required_status_checks:{strict:true,checks:[{context:'ci',app_id:15368}]},enforce_admins:{enabled:true}};
  const run={id:200,run_attempt:1,head_sha:A,event:'pull_request',repository:{id:900},head_repository:{id:900},status:'completed',conclusion:'success'};
  const job={id:300,name:'native guest tests',run_id:200,run_attempt:1,head_sha:A,status:'completed',conclusion:'success',runner_id:44,
    steps:[{number:1,name:'Set up job',status:'completed',conclusion:'success'},
      {number:2,name:'Run real suite',status:'completed',conclusion:'success'}]};
  const records={
    [`${root}/pulls/12`]:pr,
    [`${root}/branches/main`]:branch,
    [`${root}/branches/main/protection`]:policy,
    [`${root}/git/commits/${A}`]:{sha:A,tree:{sha:C}},
    [`${root}/pulls/12/reviews?per_page=100&page=1`]:[{id:70,user:{id:72,login:'external-reviewer'},state:'APPROVED',commit_id:A,submitted_at:'2026-11-06T19:00:00Z'}],
    [`${root}/commits/${A}/check-runs?per_page=100&page=1`]:{total_count:1,check_runs:[{id:71,name:'ci',app:{id:15368},head_sha:A,status:'completed',conclusion:'success'}]},
    [`${root}/actions/runs?head_sha=${A}&per_page=100&page=1`]:{total_count:1,workflow_runs:[run]},
    [`${root}/actions/runs/200/attempts/1/jobs?per_page=100&page=1`]:{total_count:1,jobs:[job]},
    [`${root}/actions/jobs/300`]:job
  };
  const calls=[];
  let prReads=0, branchReads=0;
  function get(path){
    calls.push(path);
    if (path===`${root}/pulls/12`)prReads++;
    if (path===`${root}/branches/main`)branchReads++;
    if (!(path in records)) {const err=Error('missing mocked path');err.status=404;throw err;}
    const stored=records[path];
    const value=typeof stored==='function'?stored({prReads,branchReads,calls}):stored;
    if (value && typeof value==='object' && value.throwStatus) {const err=Error('forbidden');err.status=value.throwStatus;throw err;}
    return deepCopy(value);
  }
  const collect=()=>collectLiveEvidence({repo,number:12,get,now:()=> '2026-11-06T19:00:00Z'});
  return {records,calls,pr,branch,policy,run,job,get,collect};
}
function has(snapshot,token){return snapshot.gaps.some(x=>x.includes(token));}
test('complete readable inventory is still BLOCKED, never merge or guest proof',async()=>{
  const f=fake();const x=await f.collect();
  assert.equal(x.status,'BLOCKED'); assert.equal(x.merge_authorized,false);
  assert.equal(x.guest_certified,false);assert.equal(x.target.tree_sha,C);
  assert.equal(x.reviews.observed,1);assert.equal(x.check_runs.observed.length,1);
  assert.equal(x.executions[0].state,'RUNNER_EXECUTED_SUCCESS');
  assert(has(x,'TEST_RECEIPTS_UNVERIFIED'));assert(has(x,'REVIEWER_AUTHORITY_REQUIRES_INDEPENDENT_VERIFICATION'));
  assert.equal(f.calls.filter(x=>x===`${root}/pulls/12`).length,2);
});
test('zero-step unallocated failure is NOT_EXECUTED, not test failure',async()=>{
 const f=fake();const j=f.records[`${root}/actions/jobs/300`];
 Object.assign(j,{steps:[],runner_id:0,conclusion:'failure'});
 const x=await f.collect();assert.equal(x.executions[0].state,'NOT_EXECUTED');assert(has(x,'NO_RUNNER_EXECUTED_SUCCESS'));
});
test('unobserved job steps do not become zero-step proof',async()=>{
 const f=fake();delete f.records[`${root}/actions/jobs/300`].steps;
 const x=await f.collect();assert.equal(x.executions[0].state,'STEPS_UNOBSERVED');
});
test('branch policy 403 is an explicit gate failure',async()=>{
 const f=fake();f.records[`${root}/branches/main/protection`]={throwStatus:403};
 const x=await f.collect();assert(has(x,'PROTECTION_UNREADABLE:403'));assert(has(x,'PROTECTION_POLICY_NOT_PROVEN'));assert.equal(x.protection.api_readable,false);
});
test('unprotected main is blocked independently of checks and reviews',async()=>{
 const f=fake();f.branch.protected=false;const x=await f.collect();assert(has(x,'MAIN_NOT_PROTECTED'));
});
test('missing protected-main codeowners requirement is blocked',async()=>{
 const f=fake();f.policy.required_pull_request_reviews.require_code_owner_reviews=false;
 assert(has(await f.collect(),'PROTECTION_POLICY_NOT_PROVEN'));
});
test('review bypass allowances cannot be ignored',async()=>{
 const f=fake();f.policy.required_pull_request_reviews.bypass_pull_request_allowances.users.push({login:'someone'});
 assert(has(await f.collect(),'REVIEW_BYPASS_NOT_PROVEN_EMPTY'));
});
test('required checks bind exact app issuer rather than name alone',async()=>{
 const f=fake();f.records[`${root}/commits/${A}/check-runs?per_page=100&page=1`].check_runs[0].app.id=22;
 assert(has(await f.collect(),'REQUIRED_CHECK_NOT_PROVEN:ci'));
});
test('check-run wrong HEAD cannot satisfy app-bound policy',async()=>{
 const f=fake();f.records[`${root}/commits/${A}/check-runs?per_page=100&page=1`].check_runs[0].head_sha=B;
 assert(has(await f.collect(),'REQUIRED_CHECK_NOT_PROVEN:ci'));
});
test('missing approval blocks even if run passed',async()=>{
 const f=fake();f.records[`${root}/pulls/12/reviews?per_page=100&page=1`]=[];
 assert(has(await f.collect(),'INDEPENDENT_REVIEW_NOT_PROVEN'));
});
test('outstanding changes requested blocks a favorable approval',async()=>{
 const f=fake();f.records[`${root}/pulls/12/reviews?per_page=100&page=1`].push({id:73,user:{id:74,login:'reviewer2'},state:'CHANGES_REQUESTED',commit_id:A,submitted_at:'2026-11-06T19:00:01Z'});
 assert(has(await f.collect(),'INDEPENDENT_REVIEW_NOT_PROVEN'));
});
test('invalid or missing review identity cannot satisfy approval',async()=>{
 const f=fake();delete f.records[`${root}/pulls/12/reviews?per_page=100&page=1`][0].user.id;
 const x=await f.collect();assert(has(x,'REVIEW_IDENTITY_UNVERIFIED'));assert(has(x,'INDEPENDENT_REVIEW_NOT_PROVEN'));
});
test('stale PR head between beginning and end blocks collected result',async()=>{
 const f=fake();f.records[`${root}/pulls/12`]=({prReads})=>prReads===1?f.pr:{...f.pr,head:{...f.pr.head,sha:B}};
 assert(has(await f.collect(),'PR_CHANGED_DURING_COLLECTION'));
});
test('branch moving during collection blocks snapshot',async()=>{
 const f=fake();f.records[`${root}/branches/main`]=({branchReads})=>branchReads===1?f.branch:{...f.branch,commit:{sha:C}};
 assert(has(await f.collect(),'BRANCH_CHANGED_DURING_COLLECTION'));
});
test('wrong run repository ID prevents job observation',async()=>{
 const f=fake();f.run.repository.id=9000;const x=await f.collect();
 assert(has(x,'RUN_IDENTITY_MISMATCH:200'));assert.equal(x.executions.length,0);
});
test('wrong job run attempt is unbound and never certified',async()=>{
 const f=fake();f.records[`${root}/actions/jobs/300`]={...f.job,run_attempt:2};
 const x=await f.collect();assert.equal(x.executions[0].state,'UNBOUND');
});
test('job-summary vs job-readback mutation is detected',async()=>{
 const f=fake();f.records[`${root}/actions/jobs/300`]={...f.job,id:301};
 assert(has(await f.collect(),'JOB_READBACK_MISMATCH'));
});
test('run scan cap always emits gap',async()=>{
 const f=fake();const x=f.records[`${root}/actions/runs?head_sha=${A}&per_page=100&page=1`];
 x.workflow_runs=Array.from({length:13},(_,i)=>({...f.run,id:200+i}));x.total_count=13;
 assert(has(await f.collect(),'RUN_SCAN_CAPPED'));
});
test('pagination with repeated GitHub IDs fails closed',async()=>{
 const get=async p=>[{id:1},{id:1}];const r=await readPages(get,`${root}/pulls/12/reviews`);
 assert.equal(r.complete,false);assert(r.gaps.some(x=>x.startsWith('PAGE_IDENTITY_OR_DUPLICATE')));
});
test('pagination refuses omitted total count for run listing',async()=>{
 const r=await readPages(async()=>({workflow_runs:[{id:1}]}),`${root}/actions/runs`,'workflow_runs');
 assert.equal(r.complete,false);assert(r.gaps.includes('PAGE_COUNT_UNVERIFIED:1'));
});
test('pagination refuses total drift even when pages are present',async()=>{
 let n=0;const first=Array.from({length:100},(_,i)=>({id:i+1}));
 const r=await readPages(async()=>{n++;return n===1?{total_count:101,jobs:first}:{total_count:102,jobs:[{id:101}]}},`${root}/actions/runs/2/jobs`,'jobs');
 assert.equal(r.complete,false);assert(r.gaps.some(x=>x.startsWith('PAGE_TOTAL_CHANGED')));
});
test('pagination refuses an endless full-page response',async()=>{
 const r=await readPages(async()=>Array.from({length:100},(_,i)=>({id:i+1})),`${root}/pulls/12/reviews`,null,{cap:2});
 assert.equal(r.complete,false);assert(r.gaps.includes('PAGINATION_UNBOUNDED_OR_UNOBSERVED'));
});
test('pagination refuses duplicate across pages',async()=>{
 let n=0;const first=Array.from({length:100},(_,i)=>({id:i+1}));
 const r=await readPages(async()=>{n++;return n===1?first:[{id:100}];},`${root}/pulls/12/reviews`);
 assert.equal(r.complete,false);
});
test('wrong run/attempt/head fails job classifier',()=>{
 const f=fake();for(const mutation of [{run_id:201},{run_attempt:2},{head_sha:B}]){
   assert.equal(classifyJob({...f.job,...mutation},f.run,A),'UNBOUND');
 }
});
test('housekeeping-only successful steps never count as executed test',()=>{
 const f=fake();const j={...f.job,steps:[{number:1,name:'Set up   job',status:'completed',conclusion:'success'}]};
 assert.equal(classifyJob(j,f.run,A),'NO_MEANINGFUL_STEP');
});
test('duplicate step number is malformed',()=>{
 const f=fake();const j={...f.job,steps:[...f.job.steps,{number:2,name:'More tests',status:'completed',conclusion:'success'}]};
 assert.equal(classifyJob(j,f.run,A),'STEPS_MALFORMED');
});
test('failed non-housekeeping suite was executed but not a success',()=>{
 const f=fake();const j={...f.job,conclusion:'failure',steps:[{number:1,name:'Native test',status:'completed',conclusion:'failure'}]};
 assert.equal(classifyJob(j,f.run,A),'RUNNER_EXECUTED_NON_SUCCESS');
});
test('invalid repo, number, and missing authenticated adapter fail input validation',async()=>{
 for(const x of [{repo:'evil/oreslang-source.java',number:12,get:async()=>{}},
    {repo,number:0,get:async()=>{}},{repo,number:12}])await assert.rejects(()=>collectLiveEvidence(x));
});
test('initial GitHub PR 404 returns blocked without authorization',async()=>{
 const x=await collectLiveEvidence({repo,number:12,get:async()=>{const e=Error('missing');e.status=404;throw e;}});
 assert.equal(x.merge_authorized,false);assert(x.gaps.includes('PR_UNOBSERVED:404'));
});
test('wave refuses fewer than five PRs',async()=>{
 const f=fake();await assert.rejects(()=>collectWaveEvidence({targets:[{repo,number:12}],get:f.get}));
});
test('wave refuses duplicate PR identities',async()=>{
 const f=fake();const targets=[{repo,number:12},{repo,number:12},
  {repo:'ores-truffle-oreslang/oreslang-source.llvm',number:12},
  {repo:'ores-truffle-oreslang/oreslang-source.net',number:12},
  {repo:'ores-truffle-oreslang/oreslang-source.wasm',number:12}];
 await assert.rejects(()=>collectWaveEvidence({targets,get:f.get}));
});
test('wave refuses five PRs in two repositories',async()=>{
 const f=fake();const targets=Array.from({length:5},(_,i)=>({repo:i<3?repo:'ores-truffle-oreslang/oreslang-source.llvm',number:i+1}));
 await assert.rejects(()=>collectWaveEvidence({targets,get:f.get}));
});
test('valid five-PR wave still cannot authorize merge, even if fetches fail',async()=>{
 const targets=['java','llvm','net','wasm','forge'].map((x,i)=>({repo:`ores-truffle-oreslang/oreslang-source.${x}`,number:i+1}));
 const x=await collectWaveEvidence({targets,get:async()=>{throw Object.assign(Error('missing'),{status:403});}});
 assert.equal(x.status,'BLOCKED');assert.equal(x.merge_authorized,false);
 assert.equal(x.count,5);assert.equal(x.distinct_repos,5);assert.equal(x.complete,false);
 assert(x.items.every(y=>y.status==='BLOCKED'));
});
test('policy changes between initial and final reads are detected',async()=>{
 const f=fake();let n=0;
 f.records[`${root}/branches/main/protection`]=()=>{
   n++;return n===1?f.policy:{...f.policy,required_status_checks:{strict:false,checks:[]}};
 };
 const x=await f.collect();assert(has(x,'PROTECTION_CHANGED_OR_UNOBSERVED_DURING_COLLECTION'));
});
test('a job completion that differs from its listing is not trusted',async()=>{
 const f=fake();f.records[`${root}/actions/jobs/300`]={...f.job,conclusion:'failure'};
 assert(has(await f.collect(),'JOB_READBACK_MISMATCH'));
});
test('missing final protection readback is blocked despite initial success',async()=>{
 const f=fake();let n=0;
 f.records[`${root}/branches/main/protection`]=()=>{n++;return n===1?f.policy:{throwStatus:403}};
 const x=await f.collect();assert(has(x,'FINAL_PROTECTION_UNREADABLE:403'));
});
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../bin/merge-wave-live-evidence-v1.mjs',import.meta.url));
const execCli=(args,token='')=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',
 env:{PATH:process.env.PATH,...(token?{GH_TOKEN:token}:{})},timeout:3000});
test('CLI refuses incomplete targets with nonzero exit',()=>{
 const p=execCli([repo]);assert.equal(p.status,2);assert.match(p.stderr,/usage:/i);
});
test('CLI refuses missing credentials without exposing tokens',()=>{
 const p=execCli([repo,'12']);assert.equal(p.status,2);
 assert.match(p.stderr,/GH_TOKEN or GITHUB_TOKEN/);
});
test('CLI rejects unsupported repository before making any HTTP call',()=>{
 const p=execCli(['untrusted-org/random','12'],'local-test-token');assert.equal(p.status,2);
 assert.match(p.stderr,/invalid read-only target/);assert.doesNotMatch(p.stderr,/local-test-token/);
});
test('CLI denies invalid wave cardinality before network',()=>{
 const p=execCli(['--wave',`${repo}#12`],'local-test-token');assert.equal(p.status,2);
});
test('CLI refuses duplicated wave identities before HTTP',()=>{
 const p=execCli(['--wave',`${repo}#12`,`${repo}#12`,
 'ores-truffle-oreslang/oreslang-source.llvm#1','ores-truffle-oreslang/oreslang-source.wasm#2',
 'ores-truffle-oreslang/oreslang-source.net#3'],'local-test-token');
 assert.equal(p.status,2);assert.match(p.stderr,/wave requires exactly 5 unique/);
});
test('a successful job cannot turn a failed workflow into execution success',()=>{
 const f=fake();const run={...f.run,conclusion:'failure'};
 assert.equal(classifyJob(f.job,run,A),'RUNNER_EXECUTED_NON_SUCCESS');
});
test('unreadable bypass allowances must not be assumed empty',async()=>{
 const f=fake();delete f.policy.required_pull_request_reviews.bypass_pull_request_allowances;
 assert(has(await f.collect(),'REVIEW_BYPASS_NOT_PROVEN_EMPTY'));
});
test('duplicate check contexts are ambiguous even if one check passed',async()=>{
 const f=fake();const r=f.records[`${root}/commits/${A}/check-runs?per_page=100&page=1`];
 r.check_runs.push({...r.check_runs[0],id:72,conclusion:'failure'});r.total_count=2;
 assert(has(await f.collect(),'REQUIRED_CHECK_AMBIGUOUS:ci'));
});
test('operator-controlled numeric reviewer ID cannot count even when login changes',async()=>{
 const f=fake();f.records[`${root}/pulls/12/reviews?per_page=100&page=1`][0].user.id=2148448;
 assert(has(await f.collect(),'INDEPENDENT_REVIEW_NOT_PROVEN'));
});
test('mergeability changing during collection invalidates snapshot',async()=>{
 const f=fake();f.records[`${root}/pulls/12`]=({prReads})=>prReads===1?f.pr:{...f.pr,mergeable:false};
 assert(has(await f.collect(),'PR_CHANGED_DURING_COLLECTION'));
});
