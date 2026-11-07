import assert from 'node:assert/strict';
import test from 'node:test';
import {qualifyCandidate, qualifyWave} from '../tools/merge-wave-qualifier.mjs';
const SHA = 'a'.repeat(40), TREE='b'.repeat(40), BASE='c'.repeat(40);
const as_of=new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
function candidate(s='java',n=1) {
  return {
    repo:`ores-truffle-oreslang/oreslang-source.${s}`,number:n,head_sha:SHA,head_tree_sha:TREE,
    base_sha:BASE,base_ref:'main',draft:false,mergeable:true,state:'open',author:'the1mills',
    protection:{protected:true,require_pull_request:true,require_codeowners:true,dismiss_stale_reviews:true,strict_checks:true,enforce_admins:true,bypass_count:0},
    reviews:[{login:'reviewer-independent',state:'APPROVED',commit_sha:SHA}],
    required_checks:[{context:'ci',app_id:15368}],
    checks:[{context:'ci',app_id:15368,head_sha:SHA,tree_sha:TREE,conclusion:'success',run_id:123,run_attempt:1,
      jobs:[{id:456,run_id:123,run_attempt:1,head_sha:SHA,runner_id:8,conclusion:'success',steps:[{name:'Set up job',conclusion:'success'},{name:'run negative tests',conclusion:'success'}]}]}],
    scope:'source_free',test_receipts:[
      {kind:'source_free',head_sha:SHA,tree_sha:TREE,conclusion:'success',assertions:10,run_id:123,run_attempt:1,job_id:456},
      {kind:'negative',head_sha:SHA,tree_sha:TREE,conclusion:'success',assertions:3,run_id:123,run_attempt:1,job_id:456}
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
rejects('reject active agent lease',c=>c.lease={expires_at:new Date(Date.parse(as_of) + 60 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z')},'lease');
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

const PLATFORM_REPOS = ['mobile', 'iot', 'embedded', 'desktop', 'asic', 'fpga']
  .map(name => `ores-truffle-oreslang/oreslang-platform.${name}`)
  .concat('ores-truffle-oreslang/oreslang-platform-conformance');

test('all seven platform repositories are admissible in the offline five-PR wave', () => {
  const snap = {
    schema_version: 1, as_of,
    candidates: PLATFORM_REPOS.map((repo, i) => ({...candidate('java', i + 1), repo}))
  };
  const result = qualifyWave(snap);
  assert.equal(result.status, 'SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK');
  assert.equal(result.eligible_count, 7);
  assert.equal(result.distinct_repo_count, 5);
  assert.equal(result.selected.length, 5);
  assert.deepEqual(result.blockers, []);
});

test('five platform PRs spanning only three repositories meet the diversity threshold', () => {
  const repos = PLATFORM_REPOS.slice(0, 3);
  const snap = {
    schema_version: 1, as_of,
    candidates: [0, 1, 2, 3, 4].map((i) => ({
      ...candidate('java', i + 1), repo: repos[i % repos.length]
    }))
  };
  const result = qualifyWave(snap);
  assert.equal(result.status, 'SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK');
  assert.equal(result.selected.length, 5);
  assert.equal(result.distinct_repo_count, 3);
});

test('reject platform namespace lookalikes and non-platform repositories', () => {
  for (const repo of [
    'evil-org/oreslang-platform.iot',
    'ores-truffle-oreslang/oreslang-platform.iot-fork',
    'ores-truffle-oreslang/oreslang-platform.conformance',
    'ores-truffle-oreslang/oreslang-platform.mobile-extra',
    'ores-truffle-oreslang/oreslang-platform-conformance-copy',
    'ores-truffle-oreslang/oreslang-platform.mobile/',
    'ores-truffle-oreslang/oreslang-platform.unknown'
  ]) {
    const c = {...candidate(), repo};
    assert(qualifyCandidate(c, Date.parse(as_of)).some(b => b.kind === 'metadata'), repo);
  }
});

test('platform source-free wave still fails closed on unexecuted checks', () => {
  const snap = {
    schema_version: 1, as_of,
    candidates: PLATFORM_REPOS.slice(0, 5).map((repo, i) => ({
      ...candidate('java', i + 1), repo
    }))
  };
  snap.candidates[0].checks[0].jobs[0].steps = [];
  const result = qualifyWave(snap);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.eligible_count, 4);
  assert(result.blockers[0].blockers.some(b => b.kind === 'checks'));
});

test('allow exactly the five source backends, not source namespace lookalikes', () => {
  for (const backend of ['java','llvm','wasm','forge','net']) {
    assert.deepEqual(qualifyCandidate(candidate(backend), Date.parse(as_of)), []);
  }
  for (const backend of ['fake', 'java-extra', 'dotnet', 'cranelift']) {
    assert(qualifyCandidate(candidate(backend), Date.parse(as_of))
      .some(b => b.kind === 'metadata'), backend);
  }
});
rejects('reject job from another run', c => c.checks[0].jobs[0].run_id=999, 'checks');
rejects('reject job from another attempt', c => c.checks[0].jobs[0].run_attempt=2, 'checks');
rejects('reject job from another PR head', c => c.checks[0].jobs[0].head_sha=BASE, 'checks');
rejects('reject missing job ID', c => delete c.checks[0].jobs[0].id, 'checks');
rejects('reject duplicate job IDs', c => c.checks[0].jobs.push({...c.checks[0].jobs[0]}), 'checks');
rejects('reject mixed successful and failed jobs', c => c.checks[0].jobs.push({...c.checks[0].jobs[0],id:457,conclusion:'failure'}), 'checks');
rejects('reject skipped-only run', c => c.checks[0].jobs[0].conclusion='skipped', 'checks');
rejects('reject forged receipt run attempt', c => c.test_receipts[0].run_attempt=2, 'test');
rejects('reject forged receipt job ID', c => c.test_receipts[0].job_id=789, 'test');
rejects('reject unbounded job list', c => c.checks[0].jobs=Array.from({length:129}, (_,i)=>({...c.checks[0].jobs[0],id:456+i})), 'checks');

test('fail closed on null, number and non-string step names without throwing', () => {
  for (const step of [null, 9, {}, {name:42,conclusion:'success'}, {name:null,conclusion:'success'}]) {
    const c = candidate();
    c.checks[0].jobs[0].steps = [step];
    assert(qualifyCandidate(c,Date.parse(as_of)).some(b=>b.kind==='checks'));
  }
});
test('reject malformed candidate identity without TypeError', () => {
  for (const patch of [
    {repo:{toString:null}}, {author:{toLowerCase:null}}, {author:123}, {author:'the1mills '},
    {repo:null},{repo:[]},{repo:'ores-truffle-oreslang/oreslang-source.weird'}
  ]) {
    const c={...candidate(),...patch};
    assert(qualifyCandidate(c,Date.parse(as_of)).some(b=>b.kind==='metadata'));
  }
});
test('reject contradictory review history on the same head', () => {
  const c=candidate();
  c.reviews.push({login:'reviewer-independent',state:'CHANGES_REQUESTED',commit_sha:SHA});
  assert(qualifyCandidate(c,Date.parse(as_of)).some(b=>b.kind==='review'));
});
test('reject dismissed approval even if the earlier snapshot still lists approval', () => {
  const c=candidate();
  c.reviews.push({login:'reviewer-independent',state:'DISMISSED',commit_sha:SHA});
  assert(qualifyCandidate(c,Date.parse(as_of)).some(b=>b.kind==='review'));
});
rejects('reject extra unrequired status context', c => c.checks.push({...c.checks[0],context:'nonrequired',run_id:124}), 'checks');
rejects('reject extra duplicate positive receipt', c => c.test_receipts.push({...c.test_receipts[0]}), 'test');
rejects('reject contradictory failed negative receipt appended', c => c.test_receipts.push({...c.test_receipts[1],conclusion:'failure'}), 'test');
rejects('reject unexpected third receipt kind', c => c.test_receipts.push({...c.test_receipts[1],kind:'certified'}), 'test');
rejects('reject skipped required job even with successful stepful sibling', c => c.checks[0].jobs.push({...c.checks[0].jobs[0],id:457,conclusion:'skipped',runner_id:0,steps:[]}), 'checks');
test('reject future-dated lease snapshot, not bypass expiry', () => {
  const snap=fixture();
  snap.as_of='2099-01-01T00:00:00Z';
  snap.candidates[0].lease={expires_at:'2098-01-01T00:00:00Z'};
  assert.throws(()=>qualifyWave(snap), /future-dated/);
});
test('reject non-UTC and informal snapshot timestamp formats', () => {
  for (const asOf of ['2099','2026-11-06','2026-11-06T18:00:00+00:00','November 6, 2026']) {
    assert.throws(()=>qualifyWave({...fixture(),as_of:asOf}));
  }
});
test('qualifyCandidate rejects invalid direct-call reference time', () => {
  assert(qualifyCandidate(candidate(),Number.NaN).some(b=>b.kind==='lease'));
});
test('qualifyWave returns blockers for coercion-hostile candidate', () => {
  const snap=fixture();
  snap.candidates[0].repo={toString:null};
  const res=qualifyWave(snap);
  assert.equal(res.status,'BLOCKED');
  assert(res.blockers.some(x=>x.blockers.some(y=>y.kind==='metadata')));
});
