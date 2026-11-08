import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPullRequest, assessWave, validRepoName} from '../src/merge-wave-readiness-v1.mjs';

const H='a'.repeat(40), B='b'.repeat(40), OLD='c'.repeat(40);
const approved=(who='ORESoftware',state='APPROVED',sha=H,time='2026-11-07T23:08:00Z')=>
  ({user:{login:who},state,commit_id:sha,submitted_at:time});
const step=(name='Test',more={})=>({name,status:'completed',conclusion:'success',number:1,...more});
function sample(){return {
  repository:'ores-truffle-oreslang/attolang-tests', number:15,expectedHead:H,expectedBaseSha:B,
  requiredStepNames:['Test'], pr:{number:15,state:'open',merged:false,merged_at:null,draft:false,mergeable:true,
    user:{login:'the1mills'},head:{sha:H},base:{sha:B,ref:'main',repo:{full_name:'ores-truffle-oreslang/attolang-tests'}}},
  reviews:[approved()],runs:[{id:11,event:'pull_request',head_sha:H,status:'completed',conclusion:'success',run_attempt:1,
    repository:{full_name:'ores-truffle-oreslang/attolang-tests'},head_repository:{full_name:'ores-truffle-oreslang/attolang-tests'},
    pull_requests:[{number:15,base:{repo:{full_name:'ores-truffle-oreslang/attolang-tests'}}}]}],
  jobsByRun:{11:[{id:101,run_id:11,name:'native tests',runner_id:202,run_attempt:1,conclusion:'success',steps:[step()]}]}
}}
const invalid=(name, mutate, code)=>test(name,()=>{
 const input=sample();mutate(input);const result=assessPullRequest(input);
 assert.equal(result.readyForIndependentMergeDecision,false,JSON.stringify(result));
 assert.ok(result.blockers.includes(code),JSON.stringify(result.blockers));
 assert.equal(result.blockers.length, new Set(result.blockers).size,'blocker codes are unique');
 assert.equal(result.mergeAuthorized,undefined,'pure assessor cannot issue merge authorization');
});

test('positive realistic GitHub REST shapes produce only an advisory readiness verdict',()=>{
 const r=assessPullRequest(sample()); assert.equal(r.readyForIndependentMergeDecision,true);
 assert.equal(r.executedSuccessfulStepCount,1);assert.deepEqual(r.blockers,[]);
});
test('reviewer matching is case insensitive but self approvals never qualify',()=>{
 const x=sample();x.reviews=[approved('oResoFtWaRe')];
 assert.equal(assessPullRequest(x).readyForIndependentMergeDecision,true);
 x.reviews=[approved('THE1MILLS')];
 assert.ok(assessPullRequest(x).blockers.includes('MISSING_EXACT_HEAD_INDEPENDENT_APPROVAL'));
});
test('newer approval restores earlier changes request by the same reviewer',()=>{
 const x=sample();x.reviews=[approved('ORESoftware','CHANGES_REQUESTED',H,'2026-11-07T21:00:00Z'),approved('ORESoftware')];
 assert.equal(assessPullRequest(x).readyForIndependentMergeDecision,true);
});
test('an unrelated unsubmitted PENDING review is not submitted approval or a veto',()=>{
 const x=sample();x.reviews.push({user:{login:'reviewer'},state:'PENDING',submitted_at:null});
 assert.equal(assessPullRequest(x).readyForIndependentMergeDecision,true);
});
test('a COMMENTED review from author never supplies approval',()=>{
 const x=sample();x.reviews=[approved('the1mills','COMMENTED')];
 assert.ok(assessPullRequest(x).blockers.includes('MISSING_EXACT_HEAD_INDEPENDENT_APPROVAL'));
});
test('latest same-reviewer DISMISSED review revokes prior approval',()=>{
 const x=sample();x.reviews.push(approved('ORESoftware','DISMISSED',H,'2026-11-07T23:09:00Z'));
 assert.ok(assessPullRequest(x).blockers.includes('MISSING_EXACT_HEAD_INDEPENDENT_APPROVAL'));
});
test('out-of-order older approval cannot undo later changes request',()=>{
 const x=sample();x.reviews=[approved('ORESoftware','CHANGES_REQUESTED',H,'2026-11-07T23:09:00Z'),approved()];
 assert.ok(assessPullRequest(x).blockers.includes('ACTIVE_CHANGES_REQUESTED'));
});
test('two independent reviewers: one approval plus one active changes request is a hold',()=>{
 const x=sample();x.reviews.push(approved('another-reviewer','CHANGES_REQUESTED'));
 assert.ok(assessPullRequest(x).blockers.includes('ACTIVE_CHANGES_REQUESTED'));
});
test('multiple independent approvals are admitted if neither has active changes request',()=>{
 const x=sample();x.reviews.push(approved('the-second-reviewer'));
 assert.equal(assessPullRequest(x).readyForIndependentMergeDecision,true);
});

const cases = [
 ['null PR snapshot',x=>x.pr=null,'MISSING_PROVIDER_PR'],
 ['merged true',x=>x.pr.merged=true,'NOT_OPEN_UNMERGED'],
 ['merged timestamp even if state open',x=>x.pr.merged_at='2026-11-07T23:00:00Z','NOT_OPEN_UNMERGED'],
 ['closed PR',x=>x.pr.state='closed','NOT_OPEN_UNMERGED'],
 ['draft PR',x=>x.pr.draft=true,'DRAFT_OR_UNKNOWN'],
 ['missing mergeability',x=>delete x.pr.mergeable,'NOT_MERGEABLE'],
 ['false mergeability',x=>x.pr.mergeable=false,'NOT_MERGEABLE'],
 ['missing head',x=>delete x.pr.head,'HEAD_CHANGED'],
 ['stale source head',x=>x.pr.head.sha=OLD,'HEAD_CHANGED'],
 ['wrong PR number in provider response',x=>x.pr.number=99,'PR_NUMBER_MISMATCH'],
 ['wrong base repository in provider response',x=>x.pr.base.repo.full_name='other/repo','BASE_REPOSITORY_MISMATCH'],
 ['missing pinned base',x=>delete x.expectedBaseSha,'STALE_OR_UNPINNED_BASE'],
 ['base sha drift',x=>x.pr.base.sha=OLD,'STALE_OR_UNPINNED_BASE'],
 ['PR stacked on unmerged dependency branch',x=>x.pr.base.ref='feature','NOT_MAIN_BASED'],
 ['parent not merged',x=>x.expectedParentMerged=false,'PARENT_NOT_MERGED'],
 ['unknown PR author',x=>x.pr.user={login:0},'UNKNOWN_AUTHOR'],
 ['null PR author',x=>x.pr.user=null,'UNKNOWN_AUTHOR'],
 ['missing reviews from provider',x=>delete x.reviews,'MISSING_PROVIDER_REVIEWS'],
 ['missing independent approval',x=>x.reviews=[],'MISSING_EXACT_HEAD_INDEPENDENT_APPROVAL'],
 ['nontrusted independent approval',x=>x.reviews=[approved('anonymous')],'MISSING_EXACT_HEAD_INDEPENDENT_APPROVAL'],
 ['author account cannot approve',x=>x.reviews=[approved('the1mills')],'MISSING_EXACT_HEAD_INDEPENDENT_APPROVAL'],
 ['stale approval commit',x=>x.reviews=[approved('ORESoftware','APPROVED',OLD)],'MISSING_EXACT_HEAD_INDEPENDENT_APPROVAL'],
 ['active changes requested',x=>x.reviews=[approved('ORESoftware','CHANGES_REQUESTED')],'ACTIVE_CHANGES_REQUESTED'],
 ['malformed reviewer login',x=>x.reviews[0].user.login=42,'MALFORMED_REVIEW'],
 ['missing review timestamp',x=>x.reviews[0].submitted_at=null,'MALFORMED_REVIEW'],
 ['unsupported review state',x=>x.reviews[0].state='SECRET_APPROVED','UNKNOWN_REVIEW_STATE'],
 ['invalid date 2026-02-30',x=>x.reviews[0].submitted_at='2026-02-30T23:00:00Z','MALFORMED_REVIEW_TIME'],
 ['timezone-free review timestamp',x=>x.reviews[0].submitted_at='2026-11-07T23:00:00','MALFORMED_REVIEW_TIME'],
 ['empty trusted reviewer policy',x=>x.trustedReviewers=[],'INVALID_TRUSTED_REVIEWER_POLICY'],
 ['null trusted reviewer policy',x=>x.trustedReviewers=null,'INVALID_TRUSTED_REVIEWER_POLICY'],
 ['duplicate required test name',x=>x.requiredStepNames=['Test','Test'],'MISSING_REQUIRED_TEST_STEP_POLICY'],
 ['blank required test name',x=>x.requiredStepNames=['  '],'MISSING_REQUIRED_TEST_STEP_POLICY'],
 ['no run list',x=>x.runs=[],'NO_PROVIDER_RUNS'],
 ['unrelated head sha',x=>x.runs[0].head_sha=OLD,'NO_EXACT_HEAD_PR_RUN'],
 ['workflow dispatch cannot replace PR CI',x=>x.runs[0].event='workflow_dispatch','NO_EXACT_HEAD_PR_RUN'],
 ['failed CI',x=>x.runs[0].conclusion='failure','UNSUCCESSFUL_OR_PENDING_RUN'],
 ['pending CI',x=>x.runs[0].status='queued','UNSUCCESSFUL_OR_PENDING_RUN'],
 ['invalid run id',x=>x.runs[0].id=0,'MALFORMED_RUN_IDENTITY'],
 ['zero run attempt',x=>x.runs[0].run_attempt=0,'MALFORMED_RUN_IDENTITY'],
 ['run repo mismatch',x=>x.runs[0].repository.full_name='other/repo','RUN_REPOSITORY_MISMATCH'],
 ['run source repo mismatch',x=>x.runs[0].head_repository.full_name='other/repo','RUN_HEAD_REPOSITORY_MISMATCH'],
 ['run PR association mismatch',x=>x.runs[0].pull_requests[0].number=42,'RUN_NOT_ASSOCIATED_WITH_PR'],
 ['run PR base repository mismatch',x=>x.runs[0].pull_requests[0].base.repo.full_name='other/repo','RUN_NOT_ASSOCIATED_WITH_PR'],
 ['duplicate run identity',x=>x.runs.push({...x.runs[0]}),'DUPLICATE_RUN_IDENTITY'],
 ['job list absent',x=>x.jobsByRun[11]=[],'MISSING_PROVIDER_JOBS'],
 ['duplicate job names',x=>x.jobsByRun[11].push({...x.jobsByRun[11][0],id:102}),'DUPLICATE_OR_MISSING_JOB_NAME'],
 ['duplicate job ids',x=>x.jobsByRun[11].push({...x.jobsByRun[11][0],name:'other'}),'DUPLICATE_OR_INVALID_JOB_ID'],
 ['job bound to wrong run',x=>x.jobsByRun[11][0].run_id=12,'JOB_RUN_ID_MISMATCH'],
 ['job attempt mismatch',x=>x.jobsByRun[11][0].run_attempt=2,'RUN_ATTEMPT_MISMATCH'],
 ['job failed',x=>x.jobsByRun[11][0].conclusion='failure','JOB_FAILED_OR_UNKNOWN'],
 ['runner id missing',x=>delete x.jobsByRun[11][0].runner_id,'RUNNER_NOT_ADMITTED'],
 ['runner id zero',x=>x.jobsByRun[11][0].runner_id=0,'RUNNER_NOT_ADMITTED'],
 ['runner id negative',x=>x.jobsByRun[11][0].runner_id=-9,'RUNNER_NOT_ADMITTED'],
 ['steps null',x=>x.jobsByRun[11][0].steps=null,'ZERO_EXECUTED_STEPS'],
 ['steps empty',x=>x.jobsByRun[11][0].steps=[],'ZERO_EXECUTED_STEPS'],
 ['duplicate step names',x=>x.jobsByRun[11][0].steps.push(step('Test',{number:2})),'DUPLICATE_OR_MISSING_STEP_NAME'],
 ['duplicate step numbers',x=>x.jobsByRun[11][0].steps.push(step('another')),'DUPLICATE_OR_INVALID_STEP_NUMBER'],
 ['invalid step number',x=>x.jobsByRun[11][0].steps[0].number=0,'DUPLICATE_OR_INVALID_STEP_NUMBER'],
 ['step failed',x=>x.jobsByRun[11][0].steps[0].conclusion='failure','STEP_NOT_SUCCESSFUL'],
 ['step skipped',x=>x.jobsByRun[11][0].steps[0].conclusion='skipped','STEP_NOT_SUCCESSFUL'],
 ['step unfinished',x=>x.jobsByRun[11][0].steps[0].status='in_progress','STEP_NOT_SUCCESSFUL'],
 ['only setup, no test',x=>x.jobsByRun[11][0].steps[0].name='Set up job','MISSING_REQUIRED_EXECUTED_TEST_STEP'],
 ['single skipped job',x=>x.jobsByRun[11][0].conclusion='skipped','NO_EXECUTED_SUCCESSFUL_STEPS'],
 ['path traversal as owner',x=>x.repository='../evil','INVALID_IDENTITY'],
 ['path traversal as repo',x=>x.repository='org/..','INVALID_IDENTITY'],
 ['blank repo identifier',x=>x.repository='','INVALID_IDENTITY'],
 ['fractional PR number',x=>x.number=0.5,'INVALID_IDENTITY'],
];
for (const [name,mutate,code] of cases) invalid(name,mutate,code);

test('same instant conflicting APPROVED and CHANGES_REQUESTED remains blocked in both orders',()=>{
 for (const reversed of [false,true]) {
  const x=sample();x.reviews=[approved(),approved('ORESoftware','CHANGES_REQUESTED')];
  if (reversed) x.reviews.reverse();
  const r=assessPullRequest(x);assert.ok(r.blockers.includes('AMBIGUOUS_LATEST_REVIEW'));
  assert.ok(r.blockers.includes('ACTIVE_CHANGES_REQUESTED'));
 }
});
test('same instant conflicting commits also remains blocked in both orders',()=>{
 for (const reversed of [false,true]) {
  const x=sample();x.reviews=[approved(),approved('ORESoftware','APPROVED',OLD)];
  if (reversed) x.reviews.reverse();
  const r=assessPullRequest(x);assert.ok(r.blockers.includes('AMBIGUOUS_LATEST_REVIEW'));
 }
});
test('safe formatting variants of submitted review timestamps work',()=>{
 const x=sample();x.reviews[0].submitted_at='2026-11-07T23:08:00.123Z';
 assert.equal(assessPullRequest(x).readyForIndependentMergeDecision,true);
});
test('failed extra run for same head rejects even if one good run exists',()=>{
 const x=sample();x.runs.push({...x.runs[0],id:12,conclusion:'failure'});
 assert.ok(assessPullRequest(x).blockers.includes('UNSUCCESSFUL_OR_PENDING_RUN'));
});
test('source mismatch on unrelated run is ignored, but not counted as evidence',()=>{
 const x=sample();x.runs.push({...x.runs[0],id:12,head_sha:OLD,conclusion:'failure'});
 assert.equal(assessPullRequest(x).readyForIndependentMergeDecision,true);
});
test('required steps may be spread across two passing exact-head runs',()=>{
 const x=sample();x.requiredStepNames=['Test','Security regression'];
 x.runs.push({...x.runs[0],id:12});
 x.jobsByRun[12]=[{...x.jobsByRun[11][0],id:102,run_id:12,name:'security',steps:[step('Security regression')]}];
 const r=assessPullRequest(x);assert.equal(r.readyForIndependentMergeDecision,true);assert.equal(r.executedSuccessfulStepCount,2);
});
test('a zero-step second run is not outweighed by the first passing run',()=>{
 const x=sample();x.runs.push({...x.runs[0],id:12});
 x.jobsByRun[12]=[{...x.jobsByRun[11][0],id:102,run_id:12,steps:[]}];
 assert.ok(assessPullRequest(x).blockers.includes('ZERO_EXECUTED_STEPS'));
});
test('valid five-PR, three-repo wave never authorizes merge',()=>{
 const a=assessPullRequest(sample());const entries=Array.from({length:5},(_,i)=>({...a,number:15+i,repository:'org/repo'+Math.min(i,2)}));
 const r=assessWave(entries);assert.equal(r.readyForHumanFinalReview,true);assert.equal(r.mergeAuthorized,false);
});
test('wave fails if fifth ready PR missing, and counts three repos only among ready',()=>{
 const a=assessPullRequest(sample());const entries=Array.from({length:5},(_,i)=>({...a,number:15+i,repository:'org/repo'+Math.min(i,2)}));
 entries[4]={...entries[4],readyForIndependentMergeDecision:false};
 const r=assessWave(entries);assert.equal(r.readyForHumanFinalReview,false);assert.equal(r.readyCount,4);
 assert.ok(r.blockers.includes('INSUFFICIENT_READY_PRS'));
});
test('duplicate repo/PR tuple fails regardless of where it appears',()=>{
 const a=assessPullRequest(sample());const entries=Array.from({length:5},(_,i)=>({...a,number:15+i,repository:'org/repo'+Math.min(i,2)}));
 entries[4]={...entries[0]};assert.ok(assessWave(entries).blockers.includes('DUPLICATE_PR_IDENTITY'));
});
test('wave floor cannot be reduced through options',()=>{
 const a=assessPullRequest(sample());
 assert.throws(()=>assessWave([a],{minimumPRs:1,minimumRepos:1}),/cannot be lowered/);
});
test('wave requires provider assessments array',()=>assert.throws(()=>assessWave(null),TypeError));
test('repository parser admits real names but rejects dot segments',()=>{
 for (const name of ['ores-truffle-oreslang/oreslang-platform-conformance','foo/bar_1.0','foo/attolang']) assert.equal(validRepoName(name),true);
 for (const name of ['foo/..','../foo','foo/.','foo/bar/baz','foo%2fbar/baz','foo?x=1/bar','foo/#fragment','']) assert.equal(validRepoName(name),false,name);
});

test('deterministic mutation matrix: no single critical gate removal is accepted',()=>{
 const critical = cases.filter(x=>!x[2].startsWith('UNKNOWN_') && !x[2].startsWith('MALFORMED_'));
 let seed=0x5eed1234;
 for (let i=0;i<256;i++) {
   seed=(Math.imul(seed,1664525)+1013904223)>>>0;
   const [name,mutate]=critical[seed%critical.length];
   const x=sample();mutate(x);
   const r=assessPullRequest(x);
   assert.equal(r.readyForIndependentMergeDecision,false,'mutation admitted ('+i+'): '+name);
 }
});
