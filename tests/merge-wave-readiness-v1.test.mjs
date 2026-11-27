import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPullRequest, assessWave} from '../src/merge-wave-readiness-v1.mjs';
const head = 'a'.repeat(40);
const base = 'c'.repeat(40);
const github = () => ({
 repository:'ores-truffle-oreslang/merge-probe',number:8,expectedHead:head,expectedBaseSha:base,requiredStepNames:['run tests'],requiredWorkflows:[{workflowId:7,workflowName:'CI',jobName:'source-free',testStepName:'run tests'}],
 pr:{state:'open',merged:false,draft:false,mergeable:true,head:{sha:head},
   base:{ref:'main',sha:base},user:{login:'the1mills'}},
 reviews:[{user:{login:'ORESoftware'},state:'APPROVED',commit_id:head,submitted_at:'2026-11-07T22:00:00Z'}],
 runs:[{id:9,head_sha:head,event:'pull_request',status:'completed',conclusion:'success',run_attempt:1,workflow_id:7,name:'CI'}],
 jobsByRun:{9:[{name:'source-free',run_id:9,runner_id:12,conclusion:'success',run_attempt:1,
   steps:[{name:'run tests',status:'completed',conclusion:'success'}]}]}
});
const evalCase = mutate => {const input=github();mutate(input);return assessPullRequest(input);};
test('valid provider-returned approval and stepful run meet advisory gate',()=>{
 const x=assessPullRequest(github());assert.equal(x.readyForIndependentMergeDecision,true);assert.equal(x.executedSuccessfulStepCount,1);
});
test('missing and self approval do not count',()=>{
 assert.ok(evalCase(x=>x.reviews=[]).blockers.includes('MISSING_EXACT_HEAD_INDEPENDENT_APPROVAL'));
 assert.ok(evalCase(x=>x.reviews[0].user.login='the1mills').blockers.includes('MISSING_EXACT_HEAD_INDEPENDENT_APPROVAL'));
});
test('review on previous commit is not exact-head approval',()=>{
 assert.ok(evalCase(x=>x.reviews[0].commit_id='b'.repeat(40)).blockers.includes('MISSING_EXACT_HEAD_INDEPENDENT_APPROVAL'));
});
test('later changes-requested supersedes earlier approval from same reviewer',()=>{
 assert.ok(evalCase(x=>x.reviews.push({...x.reviews[0],state:'CHANGES_REQUESTED',submitted_at:'2026-11-07T23:00:00Z'})).blockers.includes('ACTIVE_CHANGES_REQUESTED'));
});
test('a different reviewer active changes-requested also blocks',()=>{
 assert.ok(evalCase(x=>x.reviews.push({user:{login:'other'},state:'CHANGES_REQUESTED',submitted_at:'2026-11-07T22:01:00Z'})).blockers.includes('ACTIVE_CHANGES_REQUESTED'));
});
test('draft, dirty and stacked PRs cannot pass',()=>{
 assert.ok(evalCase(x=>x.pr.draft=true).blockers.includes('DRAFT_OR_UNKNOWN'));
 assert.ok(evalCase(x=>x.pr.mergeable=false).blockers.includes('NOT_MERGEABLE'));
 assert.ok(evalCase(x=>x.pr.base.ref='some-parent').blockers.includes('NOT_MAIN_BASED'));
 assert.ok(evalCase(x=>x.expectedParentMerged=false).blockers.includes('PARENT_NOT_MERGED'));
});
test('head drift and merged PR cannot pass',()=>{
 assert.ok(evalCase(x=>x.pr.head.sha='b'.repeat(40)).blockers.includes('HEAD_CHANGED'));
 assert.ok(evalCase(x=>x.pr.merged=true).blockers.includes('NOT_OPEN_UNMERGED'));
});
test('no provider runs and wrong event/head are not evidence',()=>{
 assert.ok(evalCase(x=>x.runs=[]).blockers.includes('NO_EXACT_HEAD_PR_RUN'));
 assert.ok(evalCase(x=>x.runs[0].event='workflow_dispatch').blockers.includes('NO_EXACT_HEAD_PR_RUN'));
});
test('failing and pending runs reject even if steps looked successful',()=>{
 assert.ok(evalCase(x=>x.runs[0].conclusion='failure').blockers.includes('UNSUCCESSFUL_OR_PENDING_RUN'));
 assert.ok(evalCase(x=>x.runs[0].status='queued').blockers.includes('UNSUCCESSFUL_OR_PENDING_RUN'));
});
test('zero-step runner admission failure rejects',()=>{
 const x=evalCase(x=>{x.jobsByRun[9][0].steps=null;x.jobsByRun[9][0].runner_id=0});
 assert.ok(x.blockers.includes('RUNNER_NOT_ADMITTED'));
 assert.ok(x.blockers.includes('NO_EXECUTED_SUCCESSFUL_STEPS'));
});
test('nonzero runner with zero steps still rejects',()=>{
 assert.ok(evalCase(x=>x.jobsByRun[9][0].steps=[]).blockers.includes('ZERO_EXECUTED_STEPS'));
});
test('duplicate job and step names are denied',()=>{
 assert.ok(evalCase(x=>x.jobsByRun[9].push({...x.jobsByRun[9][0]})).blockers.includes('DUPLICATE_OR_MISSING_JOB_NAME'));
 assert.ok(evalCase(x=>x.jobsByRun[9][0].steps.push({...x.jobsByRun[9][0].steps[0]})).blockers.includes('DUPLICATE_OR_MISSING_STEP_NAME'));
});
test('attempt mismatch is denied',()=>{
 assert.ok(evalCase(x=>x.jobsByRun[9][0].run_attempt=2).blockers.includes('RUN_ATTEMPT_MISMATCH'));
});
test('skipped-only job is not executable evidence',()=>{
 const result=evalCase(x=>{x.jobsByRun[9][0].conclusion='skipped';x.jobsByRun[9][0].steps=[]});
 assert.ok(result.blockers.includes('NO_EXECUTED_SUCCESSFUL_STEPS'));
});
test('five ready PRs from fewer than three repos cannot pass',()=>{
 const a=assessPullRequest(github());const prs=Array.from({length:5},(_,i)=>({...a,number:i+1}));
 const wave=assessWave(prs);assert.equal(wave.readyForHumanFinalReview,false);
 assert.ok(wave.blockers.includes('INSUFFICIENT_DISTINCT_REPOS'));
});
test('five in three repos pass advisory but NEVER authorize a merge',()=>{
 const a=assessPullRequest(github());const prs=Array.from({length:5},(_,i)=>({...a,number:i+1,repository:'org/repo'+Math.min(i,2)}));
 const wave=assessWave(prs);assert.equal(wave.readyForHumanFinalReview,true);assert.equal(wave.mergeAuthorized,false);
});
test('duplicate PR identities fail wave admission',()=>{
 const a=assessPullRequest(github());const wave=assessWave([a,a,a,a,a]);
 assert.ok(wave.blockers.includes('DUPLICATE_PR_IDENTITY'));
});
test('unfenced base drift and absence of required test policy fail closed',()=>{
 assert.ok(evalCase(x=>x.pr.base.sha='d'.repeat(40)).blockers.includes('STALE_OR_UNPINNED_BASE'));
 assert.ok(evalCase(x=>x.requiredStepNames=[]).blockers.includes('MISSING_REQUIRED_TEST_STEP_POLICY'));
});
test('successful setup-only steps do not meet required semantic tests',()=>{
 const result=evalCase(x=>x.jobsByRun[9][0].steps[0].name='Set up job');
 assert.ok(result.blockers.includes('MISSING_REQUIRED_EXECUTED_TEST_STEP'));
});
