import test from 'node:test';
import assert from 'node:assert/strict';
import {auditEntry, auditLedger} from '../tools/landed-main-evidence.mjs';

// Synthetic, source-free policy fixtures. Passing does not authenticate GitHub
// review identities, current protections, source-owned execution or guest parity.
const sha = c => c.repeat(40);
const REPO='ores-truffle-oreslang/oreslang-source.java';
const attestation = login => ({
  login,kind:'independent_postmerge_attestation',state:'APPROVED',
  repo:REPO,reviewed_commit_sha:sha('b'),reviewed_tree_sha:sha('c'),
  attestation_sha256:'a'.repeat(64)
});
function fixture() {
  const positive={id:'scalar-42',kind:'compiler-guest',fixture_sha:sha('e'),
    expect:{exit_code:42,stdout_hex:''}};
  const negative={id:'immutable-rebind',kind:'negative',fixture_sha:sha('f'),
    expect:{diagnostic_category:'IMMUTABLE_REBIND',phase:'typechecker'}};
  return {
    repo:REPO,pr:7,author:'contributor',merged:true,base_ref:'main',
    pr_head_sha:sha('a'),merge_sha:sha('b'),landed_tree_sha:sha('c'),
    requires_guest:true,
    main_observation:{head_sha:sha('b'),compare_status:'identical',
      behind_by:0,merge_base_sha:sha('b'),ahead_by:0},
    protection:{protected:true,required_approvals:2,codeowners:true,
      dismiss_stale:true,strict_checks:true,enforce_admins:true,
      bypass_count:0,force_pushes_allowed:false,deletions_allowed:false},
    approvals:[],
    required_checks:[{context:'native-ci',app_id:15368,workflow_sha:sha('d')}],
    required_tests:[positive,negative],
    source_owned_runs:[{
      scope:'landed-main',repo:REPO,commit_sha:sha('b'),tree_sha:sha('c'),
      workflow_sha:sha('d'),context:'native-ci',app_id:15368,
      run_id:10,run_attempt:1,job_id:11,runner_id:22,runner_name:'runner-22',
      status:'completed',conclusion:'success',artifact_sha256:'f'.repeat(64),
      steps:[{name:'Set up job',status:'completed',conclusion:'success'},
        {name:'Compile and execute native guest',status:'completed',conclusion:'success'}],
      tests:[
        {id:positive.id,kind:positive.kind,fixture_sha:positive.fixture_sha,
          status:'PASS',observed:{exit_code:42,stdout_hex:'',crashed:false}},
        {id:negative.id,kind:negative.kind,fixture_sha:negative.fixture_sha,
          status:'PASS',observed:{exit_code:1,diagnostic_category:'IMMUTABLE_REBIND',
            phase:'typechecker',crashed:false}}
      ]
    }]
  };
}
function withReviews(names,required=2) {
  const e=fixture();
  e.protection.required_approvals=required;
  e.approvals=names.map(attestation);
  return e;
}
function mustBlock(e) {
  assert(auditEntry(e).some(b=>b.kind==='review'),
    'insufficient independent reviewer quorum must be denied');
}
test('one attestation cannot satisfy a two-reviewer policy',()=>{
  mustBlock(withReviews(['alice']));
});
test('duplicate attestations from the same reviewer count once',()=>{
  mustBlock(withReviews(['alice','alice']));
});
test('case-variant reviewer names count as one identity',()=>{
  mustBlock(withReviews(['alice','ALICE']));
});
test('author and operator-controlled approvals cannot fill the quorum',()=>{
  mustBlock(withReviews(['alice','contributor','the1mills','ORESoftware']));
});
test('stale landed commit attestation does not fill the quorum',()=>{
  const e=withReviews(['alice','bob']);
  e.approvals[1].reviewed_commit_sha=sha('a');
  mustBlock(e);
});
test('two distinct independent landed-SHA attestations meet quorum in advisory model',()=>{
  assert.deepEqual(auditEntry(withReviews(['alice','bob'])),[]);
});
test('three-required quorum rejects two and admits three distinct approvals',()=>{
  mustBlock(withReviews(['alice','bob'],3));
  assert.deepEqual(auditEntry(withReviews(['alice','bob','carol'],3)),[]);
});
test('single-reviewer policy retains backwards-compatible acceptance',()=>{
  assert.deepEqual(auditEntry(withReviews(['alice'],1)),[]);
});
test('invalid approval-count configuration is fail-closed',()=>{
  const e=withReviews(['alice','bob']);
  e.protection.required_approvals=0;
  mustBlock(e);
});
test('ledger status stays BLOCKED with insufficient independent reviewer quorum',()=>{
  const entry=withReviews(['alice']);
  const ledger={schema_version:1,scope:'snapshot_only',
    captured_at:'2026-11-06T21:00:00Z',entries:[entry]};
  const report=auditLedger(ledger);
  assert.equal(report.status,'BLOCKED');
  assert(report.entries[0].blockers.some(b=>b.kind==='review'));
  ledger.entries[0].approvals.push(attestation('bob'));
  assert.equal(auditLedger(ledger).status,'SNAPSHOT_READY_RECHECK_LIVE');
});
