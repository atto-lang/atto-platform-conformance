import assert from 'node:assert/strict';
import test from 'node:test';
import {qualifyCandidate, qualifyWave} from '../tools/merge-wave-qualifier.mjs';
const SHA = 'a'.repeat(40), TREE='b'.repeat(40), BASE='c'.repeat(40);
const as_of='2026-11-06T18:00:00Z';
function candidate(s='java',n=1) {
  return {
    repo:`ores-truffle-oreslang/oreslang-source.${s}`,number:n,head_sha:SHA,head_tree_sha:TREE,
    base_sha:BASE,base_ref:'main',draft:false,mergeable:true,state:'open',author:'the1mills',
    protection:{protected:true,require_pull_request:true,require_codeowners:true,dismiss_stale_reviews:true,strict_checks:true,enforce_admins:true,bypass_count:0},
    reviews:[{login:'reviewer-independent',state:'APPROVED',commit_sha:SHA}],
    required_checks:[{context:'ci',app_id:15368}],
    checks:[{context:'ci',app_id:15368,head_sha:SHA,tree_sha:TREE,conclusion:'success',run_id:123,run_attempt:1,
      jobs:[{runner_id:8,conclusion:'success',steps:[{name:'Set up job',conclusion:'success'},{name:'run negative tests',conclusion:'success'}]}]}],
    scope:'source_free',test_receipts:[
      {kind:'source_free',head_sha:SHA,tree_sha:TREE,conclusion:'success',assertions:10,run_id:123},
      {kind:'negative',head_sha:SHA,tree_sha:TREE,conclusion:'success',assertions:3,run_id:123}
    ],lease:null
  };
}
const fixture = ()=>({schema_version:1,as_of,candidates:['java','llvm','net','wasm','forge'].map((s,i)=>candidate(s,i+1))});
function rejects(name,mutation,kind) {
  test(name,()=>{
    const c=candidate(); mutation(c);
    assert(qualifyCandidate(c,Date.parse(as_of)).some(x=>x.kind===kind));
  });
}
test('selects 5 unique PRs across five repos, advisory only',()=>{
  const result=qualifyWave(fixture());
  assert.equal(result.status,'SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK');
  assert.equal(result.selected.length,5);
  assert.equal(result.distinct_repo_count,5);
  assert.match(result.note,/recheck live GitHub/i);
});
test('blocks wave with fewer than 3 repositories',()=>{
  const snap=fixture();snap.candidates=snap.candidates.map((c,i)=>({...c,repo:i<3?c.repo.replace(/\.(java|llvm|net)/,'.java'):c.repo.replace(/\.(wasm|forge)/,'.llvm'),number:i+1}));
  assert.equal(qualifyWave(snap).status,'BLOCKED');
});
rejects('reject draft',c=>c.draft=true,'metadata');
rejects('reject invalid head SHA',c=>c.head_sha='abc','metadata');
rejects('reject stale base',c=>c.base_ref='feature','metadata');
rejects('reject false mergeability',c=>c.mergeable=false,'metadata');
rejects('reject unprotected main',c=>c.protection.protected=false,'protection');
rejects('reject admin bypasses',c=>c.protection.bypass_count=1,'protection');
rejects('reject disabled strict checks',c=>c.protection.strict_checks=false,'protection');
rejects('reject author self approval',c=>c.reviews[0].login='the1mills','review');
rejects('reject other operator controlled approval',c=>c.reviews[0].login='ORESoftware','review');
rejects('reject stale approval',c=>c.reviews[0].commit_sha=BASE,'review');
rejects('reject issuer substituted check',c=>c.checks[0].app_id=777,'checks');
rejects('reject duplicate status-check authority',c=>c.checks.push({...c.checks[0]}),'checks');
rejects('reject duplicate context from a different app',c=>c.checks.push({...c.checks[0],app_id:77}),'checks');
rejects('reject stale job head',c=>c.checks[0].head_sha=BASE,'checks');
rejects('reject job without assigned runner',c=>c.checks[0].jobs[0].runner_id=0,'checks');
rejects('reject zero-step job',c=>c.checks[0].jobs[0].steps=[],'checks');
rejects('reject housekeeping-only job',c=>c.checks[0].jobs[0].steps=[{name:'Set  up job',conclusion:'success'}],'checks');
rejects('reject failed check',c=>c.checks[0].conclusion='failure','checks');
rejects('reject missing negative evidence',c=>c.test_receipts.pop(),'test');
rejects('reject unbound receipt run',c=>c.test_receipts[0].run_id=999,'test');
rejects('reject guest claim on source-free evidence',c=>c.scope='compiler','test');
rejects('reject active agent lease',c=>c.lease={expires_at:'2026-11-06T19:00:00Z'},'lease');
rejects('reject malformed lease time',c=>c.lease={expires_at:'invalid'},'lease');
test('expired lease can be qualified',()=>{
  const c=candidate();c.lease={expires_at:'2026-11-05T00:00:00Z'};
  assert.deepEqual(qualifyCandidate(c,Date.parse(as_of)),[]);
});
test('duplicate candidate rejected',()=>{
 const snap=fixture();snap.candidates.push({...snap.candidates[0]});
 assert.equal(qualifyWave(snap).eligible_count,4);
 assert.equal(qualifyWave(snap).status,'BLOCKED');
 assert.equal(qualifyWave(snap).blockers.filter(x=>x.blockers.some(b=>b.reason==='duplicate_candidate')).length,2);
});
test('invalid snapshot rejects',()=>assert.throws(()=>qualifyWave({schema_version:1,candidates:[],as_of:'nope'})));
test('unbounded snapshot rejects',()=>assert.throws(()=>qualifyWave({schema_version:1,candidates:Array(1001).fill({}),as_of})));
test('deterministic cross-repo ordering',()=>{
 const snap=fixture();const a=qualifyWave(snap).selected.map(v=>v.repo);
 snap.candidates.reverse();const b=qualifyWave(snap).selected.map(v=>v.repo);
 assert.deepEqual(a,b);
});
