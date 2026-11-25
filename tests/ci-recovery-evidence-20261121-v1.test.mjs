import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ledger=JSON.parse(readFileSync(new URL(
  '../contracts/ci-recovery-evidence-20261121-v1.json',import.meta.url),'utf8'));
const hex=/^[0-9a-f]{40}$/;
const expected=[
  ['sonus-auris-test/atto-ci',44954059125,7,4,'CAPACITY_PROBE_ONLY'],
  ['sonus-auris-test/atto-ci',44954208471,6,4,'SOURCE_SYNTHETIC_TREE_ONLY'],
  ['ores-rate-limit-test/atto-ci',44954299083,6,4,'CROSS_ORG_FULL_SYNTHETIC_TREE_ONLY'],
  ['ores-rate-limit-test/atto-ci',44954478181,6,4,'DESTINATION_OWNED_SUBTREE_ONLY'],
  ['ores-rate-limit-test/atto-ci',44954684950,9,null,'SYNTHETIC_IVERILOG_YOSYS_SAT_ONLY'],
  ['ores-rate-limit-test/atto-ci',44955877706,8,8,'SYNTHETIC_BINARY_GIT_INVENTORY_ONLY']
];
function inspect(x){
  assert.equal(x.schema,'atto.ci-recovery-evidence.v1');
  assert.equal(x.scope,'CARRIER_ONLY_NOT_COMPILER_OR_GUEST_PARITY');
  assert.equal(x.authorized_private_compiler_export,false);
  assert.equal(x.source_org,'atto-lang');
  const policy=x.source_policy;
  assert.equal(policy.repo,'atto-lang/atto-source.hdl');
  assert.equal(policy.protected_main_policy_blob,'e861197f825e7f4c3587dd377d099f3eb3c862fe');
  assert.equal(policy.protected_main_active_allowlist_entries,0);
  assert.equal(policy.proposed_policy_pr,53);
  assert.match(policy.proposed_policy_candidate_head,hex);
  assert.equal(policy.proposed_recipient,'ores-rate-limit-test/atto-ci');
  assert.equal(policy.proposed_recipient_numeric_id,'1460083010');
  assert.equal(policy.required_independent_reviewer,'ORESoftware');
  assert.equal(policy.approved_and_merged,false);
  const source=x.synthetic_source,dest=x.synthetic_destination;
  assert.equal(source.repo,'sonus-auris-test/atto-ci');
  assert.equal(source.head,'5aba488d684280b0a6034556bc8be950687aab9e');
  assert.equal(source.root_tree,'d98fcd0434345fc957d5b93f5797a06590e8f8b6');
  assert.equal(source.blob_count,4);
  assert.equal(source.private_atto_compiler_code_included,false);
  assert.equal(dest.repo,policy.proposed_recipient);
  assert.equal(dest.subtree_sha,source.root_tree);
  for(const field of ['synthetic_full_tree_mirror_commit',
    'synthetic_subtree_verifier_commit','synthetic_manifest_verifier_commit'])assert.match(dest[field],hex);
  assert.equal(x.verified_runs.length,expected.length);
  assert.equal(new Set(x.verified_runs.map(r=>r.repo+'#'+r.run_id)).size,expected.length);
  for(const [i,row] of x.verified_runs.entries()){
    const [repo,id,steps,tests,claim]=expected[i];
    assert.equal(row.repo,repo);
    assert.equal(row.run_id,id);
    assert.equal(row.success_steps,steps);
    assert.equal(row.synthetic_unit_tests_passed,tests);
    assert.equal(row.claim,claim);
    assert.ok(!row.claim.includes('ATTO_GUEST'));
  }
  const h=x.verified_runs[4],v=x.verified_runs[5];
  assert.equal(h.simulation_vectors,65536);
  assert.equal(h.icarus_version,'12.0');
  assert.equal(h.yosys_version,'0.33');
  assert.equal(h.positive_sat,true);
  assert.equal(h.mutant_sat_rejected,true);
  assert.equal(v.verified_git_blobs,4);
  assert.deepEqual(x.not_promoted,{
    private_source_transfer:'NOT_AUTHORIZED_NOT_PERFORMED',
    atto_guest_compiler_execution:'NOT_EXECUTED',
    atto_backend_semantic_parity:'NOT_VERIFIED',
    source_required_checks:'NOT_SATISFIED',
    protected_merge:'NOT_PERFORMED'
  });
}
const clone=x=>structuredClone(x);
test('complete exact-run carrier evidence has no Atto compiler or guest certification',()=>inspect(ledger));
test('private export cannot be asserted from a draft policy or fake reviewed entry',()=>{
  for(const patch of [
    x=>x.authorized_private_compiler_export=true,
    x=>x.source_policy.approved_and_merged=true,
    x=>x.source_policy.protected_main_active_allowlist_entries=1,
    x=>x.source_policy.required_independent_reviewer='author',
    x=>x.source_policy.proposed_recipient_numeric_id='0'
  ]){const x=clone(ledger);patch(x);assert.throws(()=>inspect(x));}
});
test('guest execution, compiler parity and protected merges cannot be promoted by carrier PASS',()=>{
  for(const [key,value] of [
    ['atto_guest_compiler_execution','PASSED'],
    ['atto_backend_semantic_parity','PASSED'],
    ['private_source_transfer','AUTHORIZED'],
    ['source_required_checks','PASSED'],
    ['protected_merge','MERGED']
  ]){const x=clone(ledger);x.not_promoted[key]=value;assert.throws(()=>inspect(x));}
});
test('fake workflow run IDs, missing steps and duplicate evidence are rejected',()=>{
  for(const change of [
    x=>x.verified_runs[0].run_id=0,
    x=>x.verified_runs[0].success_steps=0,
    x=>x.verified_runs.pop(),
    x=>x.verified_runs[1]=x.verified_runs[0],
    x=>x.verified_runs[5].claim='ATTO_GUEST_PARITY_PASS'
  ]){const x=clone(ledger);change(x);assert.throws(()=>inspect(x));}
});
test('mutated source Git tree, destination commit and blob count cannot qualify',()=>{
  for(const change of [
    x=>x.synthetic_source.root_tree='main',
    x=>x.synthetic_destination.subtree_sha='0'.repeat(40),
    x=>x.synthetic_source.blob_count=3,
    x=>x.synthetic_destination.synthetic_manifest_verifier_commit='main',
    x=>x.verified_runs[5].verified_git_blobs=3
  ]){const x=clone(ledger);change(x);assert.throws(()=>inspect(x));}
});
test('synthetic SAT proof cannot be misstated as real Atto RTL generation',()=>{
  for(const change of [
    x=>x.verified_runs[4].simulation_vectors=0,
    x=>x.verified_runs[4].positive_sat=false,
    x=>x.verified_runs[4].mutant_sat_rejected=false,
    x=>x.verified_runs[4].icarus_version='unknown'
  ]){const x=clone(ledger);change(x);assert.throws(()=>inspect(x));}
});
