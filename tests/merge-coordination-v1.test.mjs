import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLease,serializeLease,parseLeaseComment,evaluateLeaseLedger,planMergeWave} from '../src/merge-coordination-v1.mjs';
const A='a'.repeat(40),B='b'.repeat(40);
const now='2026-11-08T15:00:00.000Z';
const lease=(x={})=>({claimId:'agent-lease-1',expiresAt:'2026-11-08T15:40:00.000Z',head:A,
  issuedAt:'2026-11-08T14:55:00.000Z',number:123,owner:'the1mills',paths:['src/foo.mjs'],repo:'org/repo',scope:'files',status:'active',...x});
const comment=(v=lease())=>({body:serializeLease(v),author:v.owner,createdAt:v.issuedAt});
const ledger=(a)=>evaluateLeaseLedger(a,{now,repo:'org/repo',number:123,head:A});
const p=(repo,n,extra={})=>({repo,number:n,head:A,base:'main',state:'open',draft:false,dependsOn:[],...extra});
test('canonical lease roundtrips and enforces actor login',()=>{
  const c=comment();assert.deepEqual(parseLeaseComment(c,{now}),lease());
  assert.equal(ledger([c]).active.length,1);
});
test('head drift blocks stale lease',()=>assert.ok(evaluateLeaseLedger([comment()],{now,repo:'org/repo',number:123,head:B}).blockers.includes('LEASE_HEAD_CHANGED')));
test('file-disjoint claims can coexist only as advisory',()=>{
 const v=lease({claimId:'second-lease',owner:'ORESoftware',paths:['src/bar.mjs']});
 const r=ledger([comment(),comment(v)]);
 assert.deepEqual(r.blockers,[]);assert.equal(r.exclusiveLockAcquired,false);assert.equal(r.mergeAuthorized,false);
});
test('same files and directory ancestors conflict',()=>{
 for(const path of ['src/foo.mjs','src','src/foo.mjs/child']){
 const v=lease({claimId:'second-lease',owner:'ORESoftware',paths:[path]});
 assert.ok(ledger([comment(),comment(v)]).blockers.includes('CONCURRENT_LEASE_CONFLICT'));
 }
});
test('merge claims conflict with any other live scope',()=>{
 const v=lease({claimId:'second-lease',owner:'ORESoftware',scope:'merge',paths:[]});
 assert.ok(ledger([comment(),comment(v)]).blockers.includes('CONCURRENT_LEASE_CONFLICT'));
});
test('release transitions clear claims; stale expiry is never authority',()=>{
 const r=lease({status:'released',issuedAt:'2026-11-08T14:56:00.000Z'});
 assert.equal(ledger([comment(),comment(r)]).active.length,0);
 const expired=lease({issuedAt:'2026-11-08T14:00:00.000Z',expiresAt:'2026-11-08T14:45:00.000Z'});
 assert.equal(ledger([comment(expired)]).active.length,0);
});
test('released claims cannot be reactivated',()=>{
 const r=lease({status:'released',issuedAt:'2026-11-08T14:56:00.000Z'});
 assert.ok(ledger([comment(),comment(r),comment(lease({issuedAt:'2026-11-08T14:57:00.000Z'}))]).blockers.includes('INVALID_LEASE_TRANSITION'));
});
test('malformed/forged lease comments fail closed',()=>{
 const c=comment();for(const altered of [
 {...c,author:'ORESoftware'}, {...c,createdAt:'2026-11-08T12:00:00.000Z'},
 {...c,body:c.body+' '}, {...c,body:c.body+'\nmalicious'},
 {...c,body:c.body.replace('"status":"active"','"status":"released","status":"active"')},
 ])assert.ok(ledger([altered]).blockers.includes('INVALID_LEASE_RECORD'));
});
test('unrelated comments ignored, claims to a different PR are blocked',()=>{
 assert.deepEqual(ledger([{body:'human note'}]).blockers,[]);
 assert.ok(ledger([comment(lease({number:124}))]).blockers.includes('MISROUTED_LEASE_RECORD'));
});
test('deny oversize TTL, future issue, bad SHA, untrusted identity, traversal',()=>{
 for(const mut of [
  {expiresAt:'2026-11-08T16:00:00.000Z'}, {issuedAt:'2026-11-08T16:00:00.000Z'},
  {head:'bad'}, {owner:'hacker'}, {paths:['../secrets']},
  {paths:['src//foo']}, {paths:['src/foo.mjs','src/foo.mjs']},
  {scope:'merge',paths:['README.md']}, {scope:'files',paths:[]},
 ])assert.throws(()=>validateLease(lease(mut),{now}));
});
test('minimum 5 across 3 repos and stable topological order',()=>{
 const xs=[p('org/z',1),p('org/a',2,{dependsOn:['org/a#1']}),p('org/b',1),p('org/a',1),p('org/c',2)];
 const r=planMergeWave(xs);assert.deepEqual(r.blockers,[]);assert.ok(r.order.indexOf('org/a#1')<r.order.indexOf('org/a#2'));
 assert.equal(r.mergeAuthorized,false);assert.equal(r.repositoryCount,4);
});
test('cycle blocks, not silently returned as partial success',()=>{
 const xs=[p('org/a',1,{dependsOn:['org/b#1']}),p('org/b',1,{dependsOn:['org/a#1']}),p('org/c',1),p('org/d',1),p('org/e',1)];
 assert.ok(planMergeWave(xs).blockers.includes('DEPENDENCY_CYCLE'));
});
test('missing parent, undeclared stacked base and stacked requalification block',()=>{
 const xs=[p('org/a',1,{base:'feature',dependsOn:['org/b#8']}),p('org/b',1),p('org/c',1),p('org/d',1),p('org/e',1)];
 const r=planMergeWave(xs);assert.ok(r.blockers.includes('DEPENDENCY_MISSING'));assert.ok(r.blockers.includes('STACKED_REQUALIFICATION_REQUIRED'));
 const plain=xs.map(x=>({...x,dependsOn:[]}));assert.ok(planMergeWave(plain).blockers.includes('UNDECLARED_STACKED_BASE'));
});
test('merged parents only satisfy dependency if verified by merge SHA',()=>{
 const xs=[p('org/a',1,{state:'merged'}),p('org/a',2,{dependsOn:['org/a#1']}),p('org/b',1),p('org/c',1),p('org/d',1),p('org/e',1)];
 assert.ok(planMergeWave(xs).blockers.includes('MERGED_PARENT_UNVERIFIED'));
 xs[0].mergeCommit=B;assert.ok(!planMergeWave(xs).blockers.includes('MERGED_PARENT_UNVERIFIED'));
});
test('invalid refs, duplicate PRs, too few repos and draft PR fail',()=>{
 assert.ok(planMergeWave([p('org/a',1),p('org/a',1)]).blockers.includes('DUPLICATE_PR'));
 assert.ok(planMergeWave([p('org/a',1),p('org/a',2),p('org/a',3),p('org/a',4),p('org/a',5)]).blockers.includes('INSUFFICIENT_REPOSITORIES'));
 assert.ok(planMergeWave([p('org/a',1),p('org/b',1),p('org/c',1)]).blockers.includes('INSUFFICIENT_OPEN_PRS'));
 assert.ok(planMergeWave([p('org/a',1,{draft:true}),p('org/a',2),p('org/b',1),p('org/c',1),p('org/d',1)]).blockers.includes('DRAFT_PR_PRESENT'));
});
