// Cross-module tests: real live collector + real integration adapter, not mock
// replacements for either. The GitHub GET transport is a bounded fake because
// authenticated private admin endpoints remain unavailable from source CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectLiveEvidence, readPages } from '../tools/merge-wave-live-evidence-v1.mjs';
import { bindMergeWaveGates } from '../tools/merge-wave-integrated-gates-v1.mjs';

const REPO='ores-truffle-oreslang/oreslang-source.java';
const BASE='/repos/'+REPO;
const HEAD='a'.repeat(40), BASE_SHA='b'.repeat(40), TREE='c'.repeat(40);
const VALID='2026-11-06T22:30:00.123Z';

function fixture(options={}) {
  const calls=[];
  let prReads=0;
  const pr={
    head:{sha:HEAD,repo:{full_name:REPO,id:55}},
    base:{sha:BASE_SHA,ref:'main',repo:{full_name:REPO,id:55}},
    state:'open',draft:false,mergeable:true,user:{id:77,login:'Developer'}
  };
  const get=async url=>{
    calls.push(url);
    if(url===BASE+'/pulls/7') {
      prReads++;
      if(options.drift && prReads===4)
        return {...pr,head:{...pr.head,sha:TREE}};
      return structuredClone(pr);
    }
    if(url===BASE+'/branches/main')
      return {protected:false,commit:{sha:BASE_SHA}};
    if(url===BASE+'/branches/main/protection')
      throw Object.assign(Error('private protection unavailable'),{status:403});
    if(url===BASE+'/git/commits/'+HEAD)
      return {sha:HEAD,tree:{sha:TREE}};
    if(url===BASE+'/pulls/7/reviews?per_page=100&page=1')
      return options.malformedReviews?{unexpected:[]}:[];
    if(url===BASE+'/commits/'+HEAD+'/check-runs?per_page=100&page=1')
      return {total_count:options.mismatchChecks?1:0,check_runs:[]};
    if(url===BASE+'/actions/runs?head_sha='+HEAD+'&per_page=100&page=1')
      return {total_count:0,workflow_runs:[]};
    throw Error('unexpected GET '+url);
  };
  const deps={
    collectLiveEvidence,readPages,
    qualifyReviewTimeline:()=>({status:'BLOCKED',blockers:['INDEPENDENT_REVIEW_UNVERIFIED']}),
    collectExactHeadEvidence:async ({listRuns})=>{
      const runs=await listRuns(REPO,HEAD);
      return {complete:runs.complete,records:[],gaps:[]};
    },
    qualifyCandidate:()=>[{kind:'guest',reason:'execution_receipts_missing'}]
  };
  const bridge=bindMergeWaveGates(deps);
  const audit=(now=VALID)=>bridge.auditPR({repo:REPO,number:7,get,now:()=>now});
  return {audit,calls};
}
const includes=(record,code)=>record.blockers.some(x=>x.includes(code));

test('real collector and integration module compose without inventing approval',async()=>{
  const f=fixture(),v=await f.audit();
  assert.equal(v.status,'BLOCKED');
  assert.equal(v.merge_authorized,false);
  assert.equal(v.compiler_guest_certified,false);
  assert.equal(v.gates.live.status,'BLOCKED');
  assert.equal(v.gates.ledger.complete,true);
  assert.equal(v.facts.head_sha,HEAD);
  assert.equal(v.facts.tree_sha,TREE);
  assert(!includes(v,'LIVE_COLLECTOR_IDENTITY_OR_CONTRACT_MISMATCH'));
  assert(includes(v,'LIVE:MAIN_NOT_PROTECTED'));
  assert(includes(v,'PROTECTION_API_UNREADABLE'));
  assert(f.calls.includes(BASE+'/actions/runs?head_sha='+HEAD+'&per_page=100&page=1'));
});
test('normalized nonexistent calendar dates are not observation evidence',async()=>{
  for(const stamp of [
    '2026-02-30T19:00:00Z','2026-02-29T19:00:00Z',
    '1900-02-29T19:00:00Z','2026-04-31T19:00:00Z',
    '0000-01-01T00:00:00Z'
  ]) {
    const v=await fixture().audit(stamp);
    assert.equal(v.observed_at,'UNKNOWN',stamp);
    assert(includes(v,'SNAPSHOT_TIME_UNOBSERVED'),stamp);
  }
});
test('bad time components and missing UTC indication fail closed',async()=>{
  for(const stamp of [
    '2026-11-06T24:00:00Z','2026-11-06T23:60:00Z',
    '2026-11-06T23:00:60Z','2026-11-06T23:00:00+00:00',
    '2026-11-06','2026-11-06T23:00:00.1234567890Z'
  ]) {
    const v=await fixture().audit(stamp);
    assert.equal(v.observed_at,'UNKNOWN',stamp);
    assert(includes(v,'SNAPSHOT_TIME_UNOBSERVED'),stamp);
  }
});
test('real UTC leap days and bounded fractional instants are accepted as timestamps only',async()=>{
  for(const stamp of [
    '2000-02-29T23:59:59Z','2024-02-29T19:00:00Z',
    '2026-11-06T23:00:00.000Z','2026-11-06T23:00:00.123456789Z'
  ]) {
    const v=await fixture().audit(stamp);
    assert.equal(v.observed_at,stamp);
    assert(!includes(v,'SNAPSHOT_TIME_UNOBSERVED'));
    assert.equal(v.status,'BLOCKED');
    assert.equal(v.merge_authorized,false);
  }
});
test('actual paginated collector fails closed on missing required check entries',async()=>{
  const v=await fixture({mismatchChecks:true}).audit();
  assert(includes(v,'LIVE:CHECKS_PAGINATION_COUNT_MISMATCH'));
  assert.equal(v.merge_authorized,false);
});
test('actual pagination detects non-array review history and blocks integration',async()=>{
  const v=await fixture({malformedReviews:true}).audit();
  assert(includes(v,'LIVE:REVIEWS_PAGE_SHAPE_INVALID'));
  assert(includes(v,'REVIEW_HISTORY_INCOMPLETE'));
});
test('PR head drift after the collector remains detectable by integration',async()=>{
  const v=await fixture({drift:true}).audit();
  assert(includes(v,'PR_IDENTITY_CHANGED_DURING_COMPOSITION'));
  assert.equal(v.merge_authorized,false);
});
test('all cross-module GitHub paths are strictly read-only repository GET targets',async()=>{
  const f=fixture();
  await f.audit();
  assert(f.calls.length>10);
  for(const path of f.calls) {
    assert(path.startsWith(BASE+'/'),path);
    assert(!/(?:\/merges$|\/dispatches$|\/contents\/)/.test(path),path);
  }
});
