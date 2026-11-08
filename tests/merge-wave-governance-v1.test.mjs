import test from 'node:test';
import assert from 'node:assert/strict';
import {assessGovernance,governanceFingerprint} from '../src/merge-wave-governance-v1.mjs';
const H='a'.repeat(40),B='b'.repeat(40);
const approval=(user='ORESoftware',sha=H,time='2026-11-07T23:00:00Z',state='APPROVED')=>({
 user:{login:user},state,commit_id:sha,submitted_at:time
});
const fixture=()=>({
 repository:'org/repo',head:H,
 pr:{head:{sha:H},base:{ref:'main',sha:B},user:{login:'the1mills'}},
 branch:{name:'main',protected:true,commit:{sha:B}},
 reviews:[approval()],
 protection:{required_pull_request_reviews:{required_approving_review_count:1},
   required_status_checks:{checks:[{context:'CI',app_id:15368}]},
   enforce_admins:{enabled:true}},
 rules:[],checkRuns:[{id:5,name:'CI',head_sha:H,status:'completed',conclusion:'success',
   app:{slug:'github-actions',id:15368}}]
});
test('protected main plus current independent approval and executed check is advisory ready',()=>{
 const r=assessGovernance(fixture());assert.equal(r.readyForHumanGovernanceReview,true);
 assert.equal(r.mergeAuthorized,false);assert.equal(r.validApprovals,1);
});
test('two distinct trusted approvals satisfy quorum of two',()=>{
 const f=fixture();f.trustedReviewers=['ORESoftware','reviewer'];
 f.protection.required_pull_request_reviews.required_approving_review_count=2;
 f.reviews.push(approval('reviewer'));
 assert.equal(assessGovernance(f).readyForHumanGovernanceReview,true);
});
test('ruleset quorum composes with classic requirement',()=>{
 const f=fixture();f.rules=[{type:'pull_request',parameters:{required_approving_review_count:2}}];
 assert.ok(assessGovernance(f).blockers.includes('APPROVAL_QUORUM_NOT_MET'));
});
test('ruleset required check must also pass on exact head',()=>{
 const f=fixture();f.rules=[{type:'required_status_checks',parameters:{
 required_status_checks:[{context:'Security',integration_id:15368}]}}];
 f.checkRuns.push({id:6,name:'Security',head_sha:H,status:'completed',conclusion:'success',
 app:{id:15368,slug:'github-actions'}});
 assert.equal(assessGovernance(f).readyForHumanGovernanceReview,true);
});
const negatives=[
 ['missing main branch metadata',f=>f.branch=null,'MAIN_BRANCH_METADATA_UNVERIFIED'],
 ['main branch unprotected',f=>f.branch.protected=false,'MAIN_NOT_PROTECTED'],
 ['main branch protection unknown',f=>delete f.branch.protected,'MAIN_PROTECTION_UNVERIFIED'],
 ['main head moved after PR base pin',f=>f.branch.commit.sha=H,'MAIN_BASE_SHA_CHANGED'],
 ['PR base SHA moved without head change',f=>f.pr.base.sha=H,'MAIN_BASE_SHA_CHANGED'],
 ['malformed branch commit',f=>f.branch.commit.sha='not-a-commit','MAIN_BASE_SHA_CHANGED'],

 ['missing branch protection',f=>f.protection=null,'BRANCH_PROTECTION_UNVERIFIED'],
 ['missing rules provider',f=>f.rules=null,'EFFECTIVE_RULES_UNVERIFIED'],
 ['missing checks provider',f=>f.checkRuns=null,'CHECK_RUNS_UNVERIFIED'],
 ['missing review provider',f=>f.reviews=null,'REVIEWS_UNVERIFIED'],
 ['administrator bypass not enforced',f=>f.protection.enforce_admins.enabled=false,'ADMIN_ENFORCEMENT_UNVERIFIED'],
 ['unknown administrator policy',f=>delete f.protection.enforce_admins,'ADMIN_ENFORCEMENT_UNVERIFIED'],
 ['author self-approval',f=>f.reviews=[approval('the1mills')],'APPROVAL_QUORUM_NOT_MET'],
 ['no approval',f=>f.reviews=[],'APPROVAL_QUORUM_NOT_MET'],
 ['stale approval',f=>f.reviews=[approval('ORESoftware',B)],'APPROVAL_QUORUM_NOT_MET'],
 ['untrusted account approval',f=>f.reviews=[approval('anonymous')],'APPROVAL_QUORUM_NOT_MET'],
 ['dismissed review',f=>f.reviews[0].dismissed_at='2026-11-07T23:01:00Z','DISMISSED_APPROVAL'],
 ['changes requested',f=>f.reviews=[approval('ORESoftware',H,'2026-11-07T23:00:00Z','CHANGES_REQUESTED')],'ACTIVE_CHANGES_REQUESTED'],
 ['commented review',f=>f.reviews=[approval('ORESoftware',H,'2026-11-07T23:00:00Z','COMMENTED')],'APPROVAL_QUORUM_NOT_MET'],
 ['conflicting simultaneous reviews',f=>f.reviews.push(approval('ORESoftware',H,'2026-11-07T23:00:00Z','CHANGES_REQUESTED')),'AMBIGUOUS_REVIEW_TIMELINE'],
 ['unparseable review date',f=>f.reviews[0].submitted_at='not-time','INVALID_REVIEW_TIMELINE'],
 ['missing reviewer name',f=>delete f.reviews[0].user,'INVALID_REVIEW_TIMELINE'],
 ['empty trusted reviewer policy',f=>f.trustedReviewers=[],'TRUSTED_REVIEWERS_UNVERIFIED'],
 ['no required approval rule',f=>delete f.protection.required_pull_request_reviews,'NO_VALID_REVIEW_COUNT_RULE'],
 ['zero required approval count',f=>f.protection.required_pull_request_reviews.required_approving_review_count=0,'NO_VALID_REVIEW_COUNT_RULE'],
 ['malformed review count',f=>f.protection.required_pull_request_reviews.required_approving_review_count='one','NO_VALID_REVIEW_COUNT_RULE'],
 ['unverified CODEOWNERS requirement',f=>f.protection.required_pull_request_reviews.require_code_owner_reviews=true,'CODEOWNER_REVIEW_UNVERIFIED'],
 ['unverified last push approval',f=>f.protection.required_pull_request_reviews.require_last_push_approval=true,'LAST_PUSH_APPROVAL_UNVERIFIED'],
 ['unverified review threads',f=>f.protection.required_conversation_resolution={enabled:true},'REVIEW_THREADS_UNVERIFIED'],
 ['explicit bypass actor',f=>f.protection.required_pull_request_reviews.bypass_pull_request_allowances={users:['admin']},'REVIEW_BYPASS_ACTORS_PRESENT'],
 ['merge queue requirement',f=>f.rules=[{type:'merge_queue'}],'MERGE_QUEUE_REQUIRED'],
 ['unknown restrictive rule',f=>f.rules=[{type:'required_deployments'}],'UNKNOWN_RESTRICTIVE_RULE'],
 ['ruleset CODEOWNERS requirement',f=>f.rules=[{type:'pull_request',parameters:{required_approving_review_count:1,require_code_owner_review:true}}],'CODEOWNER_REVIEW_UNVERIFIED'],
 ['ruleset last push requirement',f=>f.rules=[{type:'pull_request',parameters:{required_approving_review_count:1,require_last_push_approval:true}}],'LAST_PUSH_APPROVAL_UNVERIFIED'],
 ['ruleset team review requirement',f=>f.rules=[{type:'pull_request',parameters:{required_approving_review_count:1,required_reviewers:[{reviewer:{id:3},minimum_approvals:1}]}}],'REQUIRED_TEAM_REVIEW_UNVERIFIED'],
 ['ruleset conversation requirement',f=>f.rules=[{type:'pull_request',parameters:{required_approving_review_count:1,required_review_thread_resolution:true}}],'REVIEW_THREADS_UNVERIFIED'],
 ['missing required status rule',f=>delete f.protection.required_status_checks,'NO_REQUIRED_CHECKS'],
 ['required status not present',f=>f.checkRuns=[],'REQUIRED_CHECK_AMBIGUOUS_OR_MISSING'],
 ['duplicate required status',f=>f.checkRuns.push({...f.checkRuns[0],id:6}),'REQUIRED_CHECK_AMBIGUOUS_OR_MISSING'],
 ['failed check',f=>f.checkRuns[0].conclusion='failure','REQUIRED_CHECK_NOT_SUCCESSFUL_ON_HEAD'],
 ['skipped check',f=>f.checkRuns[0].conclusion='skipped','REQUIRED_CHECK_NOT_SUCCESSFUL_ON_HEAD'],
 ['pending check',f=>f.checkRuns[0].status='in_progress','REQUIRED_CHECK_NOT_SUCCESSFUL_ON_HEAD'],
 ['check on stale head',f=>f.checkRuns[0].head_sha=B,'REQUIRED_CHECK_NOT_SUCCESSFUL_ON_HEAD'],
 ['required check wrong app ID',f=>f.checkRuns[0].app.id=2,'REQUIRED_CHECK_WRONG_APP'],
 ['unverified check app source',f=>{f.protection.required_status_checks={contexts:['CI']};f.checkRuns[0].app.slug='unknown'},'REQUIRED_CHECK_SOURCE_UNVERIFIED'],
 ['duplicate required context name',f=>f.protection.required_status_checks.checks.push({context:'CI',app_id:15368}),'MALFORMED_OR_DUPLICATE_CHECK_RULE'],
 ['malformed ruleset checks',f=>f.rules=[{type:'required_status_checks',parameters:{required_status_checks:null}}],'MALFORMED_RULESET_CHECKS'],
 ['PR head changed',f=>f.pr.head.sha=B,'POLICY_PR_IDENTITY_MISMATCH'],
 ['PR base retargeted',f=>f.pr.base.ref='feature','POLICY_PR_IDENTITY_MISMATCH']
];
for(const [name,mutate,blocker] of negatives)
 test('deny '+name,()=>{
   const f=fixture();mutate(f);const r=assessGovernance(f);
   assert.equal(r.readyForHumanGovernanceReview,false,JSON.stringify(r));
   assert.ok(r.blockers.includes(blocker),JSON.stringify(r.blockers));
   assert.equal(r.mergeAuthorized,false);
 });
test('later commented review supersedes approval',()=>{
 const f=fixture();f.reviews.push(approval('ORESoftware',H,'2026-11-07T23:02:00Z','COMMENTED'));
 assert.ok(assessGovernance(f).blockers.includes('APPROVAL_QUORUM_NOT_MET'));
});
test('latest changes requested wins independently of returned array order',()=>{
 const f=fixture();f.reviews=[approval('ORESoftware',H,'2026-11-07T23:02:00Z','CHANGES_REQUESTED'),approval()];
 assert.ok(assessGovernance(f).blockers.includes('ACTIVE_CHANGES_REQUESTED'));
});
test('fingerprint stable when rules and checks arrays reorder',()=>{
 const f=fixture();f.rules=[{type:'pull_request',parameters:{required_approving_review_count:1}},{type:'non_fast_forward'}];
 f.checkRuns.push({...f.checkRuns[0],id:7,name:'Security'});
 const copy=structuredClone(f);copy.rules.reverse();copy.checkRuns.reverse();
 assert.equal(governanceFingerprint(f),governanceFingerprint(copy));
});
test('fingerprint changes when required review count or check conclusion changes',()=>{
 const f=fixture(),original=governanceFingerprint(f);
 f.protection.required_pull_request_reviews.required_approving_review_count=2;
 assert.notEqual(governanceFingerprint(f),original);
 f.protection.required_pull_request_reviews.required_approving_review_count=1;
 f.checkRuns[0].conclusion='failure';
 assert.notEqual(governanceFingerprint(f),original);
});
test('fingerprint rejects missing policy material',()=>{
 assert.throws(()=>governanceFingerprint({rules:[],checkRuns:[]}),/Incomplete/);
});


test('invalid calendar date in approval is rejected without implicit rollover',()=>{
 const f=fixture();f.reviews[0].submitted_at='2026-02-30T23:00:00Z';
 const r=assessGovernance(f);
 assert.ok(r.blockers.includes('INVALID_REVIEW_TIMELINE'));
 assert.equal(r.readyForHumanGovernanceReview,false);
});
test('timezone-free and timezone-shifted review dates are not canonical UTC evidence',()=>{
 for(const time of ['2026-11-07T23:00:00','2026-11-07T23:00:00+00:00']){
   const f=fixture();f.reviews[0].submitted_at=time;
   assert.ok(assessGovernance(f).blockers.includes('INVALID_REVIEW_TIMELINE'));
 }
});
