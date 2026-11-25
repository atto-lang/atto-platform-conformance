import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotFreshness, qualifyReviewTimeline} from '../tools/merge-wave-review-timeline.mjs';
const A='a'.repeat(40), B='b'.repeat(40);
const NOW=Date.parse('2026-11-06T19:00:00Z');
function fixture() {
  return {repo:'ores-truffle-oreslang/oreslang-source.java',base_sha:B,head_sha:A,author:'the1mills',author_id:2148448,as_of:'2026-11-06T19:00:00Z',reviews_complete:true,review_count:1,
    reviewer_policy:{repo:'ores-truffle-oreslang/oreslang-source.java',base_sha:B,base_ref:'main',protection_readable:true,protected:true,require_codeowners:true,dismiss_stale_reviews:true,bypass_count:0,required_approvals:1,eligible_reviewer_ids:[2000012,2000013]},
    reviews:[{id:12,reviewer_id:2000012,login:'outside-reviewer',state:'APPROVED',commit_sha:A,submitted_at:'2026-11-06T18:59:00Z'}]};
}
function blocked(name,mutate,code) {test(name,()=>{const v=fixture();mutate(v);assert(qualifyReviewTimeline(v,{now:NOW}).blockers.includes(code));});}
test('single current-head independent approval qualifies only as snapshot',()=>{
 const v=qualifyReviewTimeline(fixture(),{now:NOW});
 assert.equal(v.status,'REVIEW_SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK');
 assert.deepEqual(v.blockers,[]);
 assert.match(v.note,/refresh github/i);
});
blocked('reject missing history completeness',v=>v.reviews_complete=false,'REVIEW_HISTORY_INCOMPLETE');
blocked('reject missing review',v=>v.reviews=[],'REVIEW_HISTORY_INVALID');
blocked('reject oversized review list',v=>v.reviews=Array(1001).fill(v.reviews[0]),'REVIEW_HISTORY_INVALID');
blocked('reject self approval by ID with changed login',v=>v.reviews[0].reviewer_id=v.author_id,'REVIEW_INDEPENDENT_APPROVAL_MISSING');
blocked('reject author self approval by login',v=>v.reviews[0].login='the1mills','REVIEW_INDEPENDENT_APPROVAL_MISSING');
blocked('reject disallowed ORESoftware ID with alias',v=>v.reviews[0].reviewer_id=11139560,'REVIEW_INDEPENDENT_APPROVAL_MISSING');
blocked('reject disallowed ORESoftware login',v=>v.reviews[0].login='ORESoftware','REVIEW_INDEPENDENT_APPROVAL_MISSING');
blocked('reject review from stale head',v=>v.reviews[0].commit_sha=B,'REVIEW_INDEPENDENT_APPROVAL_MISSING');
blocked('reject changed reviewer state on later review',v=>v.reviews.push({...v.reviews[0],id:13,state:'CHANGES_REQUESTED',submitted_at:'2026-11-06T18:59:30Z'}),'REVIEW_CHANGES_REQUESTED');
blocked('reject outstanding change request by another reviewer',v=>v.reviews.push({...v.reviews[0],id:13,reviewer_id:2000013,login:'another',state:'CHANGES_REQUESTED',submitted_at:'2026-11-06T18:59:30Z'}),'REVIEW_CHANGES_REQUESTED');
blocked('reject dismissed prior approval',v=>v.reviews.push({...v.reviews[0],id:13,state:'DISMISSED',submitted_at:'2026-11-06T18:59:30Z'}),'REVIEW_INDEPENDENT_APPROVAL_MISSING');
test('later comment retains earlier exact-head approval',()=>{
 const v=fixture();v.reviews.push({...v.reviews[0],id:13,state:'COMMENTED',submitted_at:'2026-11-06T18:59:30Z'});v.review_count=2;
 assert.equal(qualifyReviewTimeline(v,{now:NOW}).status,'REVIEW_SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK');
});
blocked('reject duplicate review ID',v=>v.reviews.push({...v.reviews[0]}),'REVIEW_RECORD_INVALID');
blocked('reject identity alias conflicting for same ID',v=>v.reviews.push({...v.reviews[0],id:13,login:'different-reviewer',submitted_at:'2026-11-06T18:59:30Z'}),'REVIEW_IDENTITY_CONFLICT');
blocked('reject same-millisecond ambiguous ordering',v=>v.reviews.push({...v.reviews[0],id:13,state:'CHANGES_REQUESTED'}),'REVIEW_ORDER_AMBIGUOUS');
blocked('reject review after snapshot',v=>v.reviews[0].submitted_at='2026-11-06T19:01:00Z','REVIEW_AFTER_SNAPSHOT');
blocked('reject missing reviewer ID',v=>delete v.reviews[0].reviewer_id,'REVIEW_RECORD_INVALID');
blocked('reject missing review ID',v=>delete v.reviews[0].id,'REVIEW_RECORD_INVALID');
blocked('reject missing reviewer timestamp',v=>delete v.reviews[0].submitted_at,'REVIEW_RECORD_INVALID');
blocked('reject fake reviewer state',v=>v.reviews[0].state='GREEN','REVIEW_RECORD_INVALID');
blocked('reject missing author numeric identity',v=>delete v.author_id,'REVIEW_IDENTITY_INVALID');
blocked('reject malformed author login',v=>v.author='<script>','REVIEW_IDENTITY_INVALID');
blocked('reject stale snapshot',v=>v.as_of='2026-11-06T18:50:00Z','SNAPSHOT_STALE');
blocked('reject future snapshot',v=>v.as_of='2026-11-06T19:02:00Z','SNAPSHOT_FROM_FUTURE');
blocked('reject unsupported timestamp',v=>v.as_of='yesterday','SNAPSHOT_TIME_INVALID');

test('strict calendar rejects impossible snapshots instead of Date.parse rollover',()=>{
  const invalid=[
    '2026-02-30T19:00:00Z',
    '2024-02-30T19:00:00Z',
    '2026-04-31T19:00:00Z',
    '2026-11-31T19:00:00Z',
    '2026-11-06T24:00:00Z',
    '2026-11-06T19:60:00Z',
    '2026-11-06T19:00:60Z',
    '2026-11-06T19:00:00+24:00',
    '2026-11-06T19:00:00+00:60',
    '2026-13-06T19:00:00Z'
  ];
  for(const value of invalid){
    const parsed=Date.parse(value);
    const now=Number.isFinite(parsed)?parsed:NOW;
    assert.equal(snapshotFreshness(value,now).reason,'SNAPSHOT_TIME_INVALID',value);
  }
});
test('strict date validity permits legitimate leap day and fractional offset dates',()=>{
  for(const value of [
    '2024-02-29T19:00:00Z',
    '2000-02-29T19:00:00Z',
    '2026-11-06T19:00:00.123456+01:30',
    '2026-11-06T19:00:00-05:00'
  ]){
    assert.equal(snapshotFreshness(value,Date.parse(value)).ok,true,value);
  }
});
test('impossible calendar reviewer submission cannot supply an eligible approval',()=>{
  for(const value of [
    '2026-02-30T18:59:00Z',
    '2026-04-31T18:59:00Z',
    '2026-11-06T24:00:00Z',
    '2026-11-06T18:59:00+24:00'
  ]){
    const v=fixture();
    v.reviews[0].submitted_at=value;
    const r=qualifyReviewTimeline(v,{now:NOW});
    assert.equal(r.status,'BLOCKED',value);
    assert(r.blockers.includes('REVIEW_RECORD_INVALID'),JSON.stringify(r));
  }
});
test('simultaneously invalid snapshot and submission fail closed',()=>{
  const v=fixture();
  v.as_of='2026-02-30T19:00:00Z';
  v.reviews[0].submitted_at='2026-02-30T18:59:00Z';
  const r=qualifyReviewTimeline(v,{now:Date.parse('2026-03-02T19:00:00Z')});
  assert(r.blockers.includes('SNAPSHOT_TIME_INVALID'));
  assert(r.blockers.includes('REVIEW_RECORD_INVALID'));
});

test('accepts post-change-request reapproval at exact head',()=>{
 const v=fixture();v.reviews.unshift({...v.reviews[0],id:13,state:'CHANGES_REQUESTED',submitted_at:'2026-11-06T18:58:00Z'});v.review_count=2;
 assert.deepEqual(qualifyReviewTimeline(v,{now:NOW}).blockers,[]);
});
test('accepts non-chronological review inventory with correct latest state',()=>{
 const v=fixture();v.reviews.push({...v.reviews[0],id:13,state:'CHANGES_REQUESTED',submitted_at:'2026-11-06T18:58:00Z'});v.review_count=2;
 assert.deepEqual(qualifyReviewTimeline(v,{now:NOW}).blockers,[]);
});
test('rejects malformed input without throwing',()=>{
 assert.equal(qualifyReviewTimeline(null,{now:NOW}).status,'BLOCKED');
 assert.equal(qualifyReviewTimeline([],{now:NOW}).status,'BLOCKED');
});
test('freshness boundaries',()=>{
 assert.equal(snapshotFreshness('2026-11-06T18:55:00Z',NOW).ok,true);
 assert.equal(snapshotFreshness('2026-11-06T18:54:59Z',NOW).ok,false);
 assert.equal(snapshotFreshness('2026-11-06T19:00:30Z',NOW).ok,true);
 assert.equal(snapshotFreshness('2026-11-06T19:00:31Z',NOW).ok,false);
});
blocked('reject same login reused by different IDs',v=>v.reviews.push({...v.reviews[0],id:14,reviewer_id:2000014,submitted_at:'2026-11-06T18:59:30Z'}),'REVIEW_IDENTITY_CONFLICT');
blocked('malformed author type blocks rather than throwing',v=>v.author=42,'REVIEW_IDENTITY_INVALID');

// Adversarial reviewer-policy and complete-history binding cases.
{
const A='a'.repeat(40), B='b'.repeat(40), NOW=Date.parse('2026-11-06T19:00:00Z');
function fixture() {
  return {
    repo:'ores-truffle-oreslang/oreslang-source.java',base_sha:B,head_sha:A,author:'the1mills',author_id:2148448,
    as_of:'2026-11-06T19:00:00Z',reviews_complete:true,review_count:1,
    reviewer_policy:{repo:'ores-truffle-oreslang/oreslang-source.java',base_sha:B,base_ref:'main',
      protection_readable:true,protected:true,require_codeowners:true,dismiss_stale_reviews:true,
      bypass_count:0,required_approvals:1,eligible_reviewer_ids:[2000012,2000013]},
    reviews:[{id:12,reviewer_id:2000012,login:'outside-reviewer',state:'APPROVED',commit_sha:A,submitted_at:'2026-11-06T18:59:00Z'}]
  }
}
function blocked(name,change,kind){
 test(name,()=>{const x=fixture();change(x);const r=qualifyReviewTimeline(x,{now:NOW});assert(r.blockers.includes(kind),JSON.stringify(r))});
}
test('valid bound reviewer policy qualifies only advisory',()=>{
 const v=qualifyReviewTimeline(fixture(),{now:NOW});
 assert.equal(v.status,'REVIEW_SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK');
});
blocked('absent policy',v=>delete v.reviewer_policy,'REVIEW_POLICY_INVALID');
blocked('unprotected branch',v=>v.reviewer_policy.protected=false,'REVIEW_POLICY_INVALID');
blocked('unreadable policy',v=>v.reviewer_policy.protection_readable=false,'REVIEW_POLICY_INVALID');
blocked('missing CODEOWNERS',v=>v.reviewer_policy.require_codeowners=false,'REVIEW_POLICY_INVALID');
blocked('stale approvals not dismissed',v=>v.reviewer_policy.dismiss_stale_reviews=false,'REVIEW_POLICY_INVALID');
blocked('bypass enabled',v=>v.reviewer_policy.bypass_count=1,'REVIEW_POLICY_INVALID');
blocked('policy for other repo',v=>v.reviewer_policy.repo='other/hello','REVIEW_POLICY_INVALID');
blocked('policy for another base sha',v=>v.reviewer_policy.base_sha=A,'REVIEW_POLICY_INVALID');
blocked('repo and base unknown',v=>{delete v.repo; delete v.base_sha},'REVIEW_POLICY_INVALID');
blocked('no eligible reviewer IDs',v=>v.reviewer_policy.eligible_reviewer_ids=[],'REVIEW_POLICY_INVALID');
blocked('duplicate eligible reviewer IDs',v=>v.reviewer_policy.eligible_reviewer_ids=[2000012,2000012],'REVIEW_POLICY_INVALID');
blocked('self allowed in policy',v=>v.reviewer_policy.eligible_reviewer_ids=[2148448],'REVIEW_POLICY_INVALID');
blocked('operator allowed in policy',v=>v.reviewer_policy.eligible_reviewer_ids=[11139560],'REVIEW_POLICY_INVALID');
blocked('reviewer outside allowed roster',v=>{v.reviewer_policy.eligible_reviewer_ids=[2000013]},'REVIEW_INDEPENDENT_APPROVAL_MISSING');
blocked('two approvals needed but only one',v=>v.reviewer_policy.required_approvals=2,'REVIEW_INDEPENDENT_APPROVAL_MISSING');
blocked('zero approvals requested',v=>v.reviewer_policy.required_approvals=0,'REVIEW_POLICY_INVALID');
blocked('unbounded approval count',v=>v.reviewer_policy.required_approvals=200,'REVIEW_POLICY_INVALID');
blocked('missing review total',v=>delete v.review_count,'REVIEW_HISTORY_INCOMPLETE');
blocked('truncated review inventory',v=>v.review_count=2,'REVIEW_HISTORY_INCOMPLETE');
test('two distinct approved eligible reviewers meet 2 approvals',()=>{
 const v=fixture();v.reviewer_policy.required_approvals=2;
 v.reviews.push({id:13,reviewer_id:2000013,login:'different-reviewer',state:'APPROVED',commit_sha:A,submitted_at:'2026-11-06T18:59:05Z'});v.review_count=2;
 assert.equal(qualifyReviewTimeline(v,{now:NOW}).status,'REVIEW_SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK');
});
test('a single reviewer cannot double-count by submitting twice',()=>{
 const v=fixture();v.reviewer_policy.required_approvals=2;
 v.reviews.push({...v.reviews[0],id:13,submitted_at:'2026-11-06T18:59:05Z'});v.review_count=2;
 assert(qualifyReviewTimeline(v,{now:NOW}).blockers.includes('REVIEW_INDEPENDENT_APPROVAL_MISSING'));
});
}

// Strict source-identity type checks and full-history timestamp consistency.

test('reject object-valued PR head even when it coerces to exact matching SHA',()=>{
  const v=fixture(), spoof={toString:()=>A};
  v.head_sha=spoof; v.reviews[0].commit_sha=spoof;
  assert(qualifyReviewTimeline(v,{now:NOW}).blockers.includes('REVIEW_IDENTITY_INVALID'));
});
test('reject object-valued base SHA shared by input and policy',()=>{
  const v=fixture(), spoof={toString:()=>B};
  v.base_sha=spoof; v.reviewer_policy.base_sha=spoof;
  assert(qualifyReviewTimeline(v,{now:NOW}).blockers.includes('REVIEW_POLICY_INVALID'));
});
test('reject object-valued repository shared by input and policy',()=>{
  const v=fixture(), spoof={toString:()=>v.repo};
  v.reviewer_policy.repo=spoof; v.repo=spoof;
  assert(qualifyReviewTimeline(v,{now:NOW}).blockers.includes('REVIEW_POLICY_INVALID'));
});
test('reject object-valued reviewer commit even when regex would coerce it',()=>{
  const v=fixture(); v.reviews[0].commit_sha={toString:()=>A};
  assert(qualifyReviewTimeline(v,{now:NOW}).blockers.includes('REVIEW_RECORD_INVALID'));
});
test('reject historical timestamp collision with intervening newer review',()=>{
  const v=fixture();
  v.reviews=[
    {...v.reviews[0],id:31,state:'COMMENTED',submitted_at:'2026-11-06T18:58:00Z'},
    {...v.reviews[0],id:32,state:'COMMENTED',submitted_at:'2026-11-06T18:58:30Z'},
    {...v.reviews[0],id:33,state:'CHANGES_REQUESTED',submitted_at:'2026-11-06T18:58:00Z'},
    {...v.reviews[0],id:34,submitted_at:'2026-11-06T18:59:00Z'}
  ]; v.review_count=v.reviews.length;
  assert(qualifyReviewTimeline(v,{now:NOW}).blockers.includes('REVIEW_ORDER_AMBIGUOUS'));
});
test('accept unordered review inventory with distinct timestamps',()=>{
  const v=fixture();
  v.reviews.push({...v.reviews[0],id:35,state:'COMMENTED',submitted_at:'2026-11-06T18:58:30Z'});
  v.reviews.unshift({...v.reviews[0],id:36,state:'CHANGES_REQUESTED',submitted_at:'2026-11-06T18:58:00Z'});
  v.review_count=v.reviews.length;
  assert.equal(qualifyReviewTimeline(v,{now:NOW}).status,'REVIEW_SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK');
});


// A COMMENTED review is feedback, not a state transition that resolves a prior
// CHANGES_REQUESTED review or revokes a current-head approval.
test('change request followed by a comment stays blocking',()=>{
 const v=fixture();
 v.reviews.push({id:13,reviewer_id:2000013,login:'second-reviewer',state:'CHANGES_REQUESTED',commit_sha:A,submitted_at:'2026-11-06T18:59:10Z'});
 v.reviews.push({id:14,reviewer_id:2000013,login:'second-reviewer',state:'COMMENTED',commit_sha:A,submitted_at:'2026-11-06T18:59:20Z'});
 v.review_count=3;
 const r=qualifyReviewTimeline(v,{now:NOW});
 assert(r.blockers.includes('REVIEW_CHANGES_REQUESTED'),JSON.stringify(r));
});
test('comment from approved reviewer does not revoke approval',()=>{
 const v=fixture();
 v.reviews.push({...v.reviews[0],id:13,state:'COMMENTED',submitted_at:'2026-11-06T18:59:20Z'});
 v.review_count=2;
 assert.deepEqual(qualifyReviewTimeline(v,{now:NOW}).blockers,[]);
});
test('change request followed by an explicit approval clears the request',()=>{
 const v=fixture();
 v.reviews.push({id:13,reviewer_id:2000013,login:'second-reviewer',state:'CHANGES_REQUESTED',commit_sha:A,submitted_at:'2026-11-06T18:59:05Z'});
 v.reviews.push({id:14,reviewer_id:2000013,login:'second-reviewer',state:'COMMENTED',commit_sha:A,submitted_at:'2026-11-06T18:59:10Z'});
 v.reviews.push({id:15,reviewer_id:2000013,login:'second-reviewer',state:'APPROVED',commit_sha:A,submitted_at:'2026-11-06T18:59:20Z'});
 v.review_count=4;
 assert.deepEqual(qualifyReviewTimeline(v,{now:NOW}).blockers,[]);
});
test('distinct dismissal event cannot impersonate a dismissal of earlier request',()=>{
 const v=fixture();
 v.reviews.push({id:13,reviewer_id:2000013,login:'second-reviewer',state:'CHANGES_REQUESTED',commit_sha:A,submitted_at:'2026-11-06T18:59:05Z'});
 v.reviews.push({id:14,reviewer_id:2000013,login:'second-reviewer',state:'DISMISSED',commit_sha:A,submitted_at:'2026-11-06T18:59:20Z'});
 v.review_count=3;
 const r=qualifyReviewTimeline(v,{now:NOW});
 assert(r.blockers.includes('REVIEW_DISMISSAL_AMBIGUOUS'),JSON.stringify(r));
 assert(r.blockers.includes('REVIEW_CHANGES_REQUESTED'),JSON.stringify(r));
});
test('non-chronological comment cannot hide an outstanding request',()=>{
 const v=fixture();
 v.reviews.push({id:13,reviewer_id:2000013,login:'second-reviewer',state:'COMMENTED',commit_sha:A,submitted_at:'2026-11-06T18:59:20Z'});
 v.reviews.push({id:14,reviewer_id:2000013,login:'second-reviewer',state:'CHANGES_REQUESTED',commit_sha:A,submitted_at:'2026-11-06T18:59:05Z'});
 v.review_count=3;
 assert(qualifyReviewTimeline(v,{now:NOW}).blockers.includes('REVIEW_CHANGES_REQUESTED'));
});
test('dismissal after exact-head approval removes effective approval',()=>{
 const v=fixture();
 v.reviews.push({...v.reviews[0],id:13,state:'DISMISSED',submitted_at:'2026-11-06T18:59:20Z'});
 v.review_count=2;
 assert(qualifyReviewTimeline(v,{now:NOW}).blockers.includes('REVIEW_INDEPENDENT_APPROVAL_MISSING'));
});

test('out-of-order dismissal cannot hide an earlier change request',()=>{
 const v=fixture();
 v.reviews.push({id:14,reviewer_id:2000013,login:'second-reviewer',state:'DISMISSED',commit_sha:A,submitted_at:'2026-11-06T18:59:20Z'});
 v.reviews.push({id:13,reviewer_id:2000013,login:'second-reviewer',state:'CHANGES_REQUESTED',commit_sha:A,submitted_at:'2026-11-06T18:59:05Z'});
 v.review_count=3;
 const r=qualifyReviewTimeline(v,{now:NOW});
 assert(r.blockers.includes('REVIEW_DISMISSAL_AMBIGUOUS'),JSON.stringify(r));
 assert(r.blockers.includes('REVIEW_CHANGES_REQUESTED'),JSON.stringify(r));
});
test('stale-head reapproval cannot release the outstanding change request',()=>{
 const v=fixture();
 v.reviews.push({id:13,reviewer_id:2000013,login:'second-reviewer',state:'CHANGES_REQUESTED',commit_sha:A,submitted_at:'2026-11-06T18:59:05Z'});
 v.reviews.push({id:14,reviewer_id:2000013,login:'second-reviewer',state:'APPROVED',commit_sha:B,submitted_at:'2026-11-06T18:59:20Z'});
 v.review_count=3;
 const r=qualifyReviewTimeline(v,{now:NOW});
 assert(r.blockers.includes('REVIEW_STALE_REAPPROVAL'),JSON.stringify(r));
 assert(r.blockers.includes('REVIEW_CHANGES_REQUESTED'),JSON.stringify(r));
});
