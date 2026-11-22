import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Source-free registry integrity only. These fixtures do NOT compile .atto, run
// any guest, authorize private-source export, or establish compiler parity.
const evidence=JSON.parse(readFileSync(
  new URL('../contracts/std-protocol-11-backend-evidence-v1.json',import.meta.url),'utf8'));
const names=['atto','net','hdl','java','realtime','rs','llvm','js','forge','wasm','cranelift'];
const prefix='atto-lang/atto-source.';
const sha40=/^[0-9a-f]{40}$/;
const snapshots=new Map([
  ['java',['e2c7ea4d1050c447b6ea74f2ff97dfe32df502db','6607962d835b980a21ece755a300cafb354b4410','8fa7427fb0a0323ad09e700f87da1f8e50707bb0','2fe74c554f4163d0436a2f45fb47eec13a904f80','8b5960abd66f49c1f5f7b3c712ff8e62baf8f0bb',1786]],
  ['llvm',['ba4feaa4e4e11ef52c5495ff3caac0bfc6cb7df0','a61f3521dbf589c9dffb5e307698319ed136adf7','3beafcab41c72e0c4a8986072afad9362b320c14','4f984f5e0d39f2205b4e7b979ecdd4168bf587e6','e19020d3d07a62e214a9d4f1eb79ee2e04b45aef',884]],
  ['rs',['01f9e5b735fd9c88280970d83e7f26151b21995d','55ef501700d3786ae319a1aadef04798bf922c3b','79fd2bde916b6400c09a34f5a37f1e3a394344f3','7534eb2ed7abd2339988b42d5086f5e45a062b9d','dfd845d74366e7b794be015eb90302bb331ce6c8',546]],
  ['net',['6842289a035f3d3153894d5bd6594d3c0aa55104','a5b4211574cba40ec33a2847da524f6b49819925','89bbc1d8f9bf658d1b31993b1a8a8bc7c1f496b4','9daec1444782870ba9b292d6f374b4af64faf743','e19020d3d07a62e214a9d4f1eb79ee2e04b45aef',228]],
  ['wasm',['5a902a60fbf0af240f2c41c0c383b665e6b194d5','b4dcc5417f247bfa9443433d523917ac56681869','0a94acdc69825a3d352dafa6a91cb82916fcf1e9','ced295c28708c747d4148977bda55568aa797179','e19020d3d07a62e214a9d4f1eb79ee2e04b45aef',291]],
  ['forge',['dfa251e9be0eb7972648f1ba4b8bc29e3500b27c','92cb739ed2514c9715ddde03380e875b3cf66734','829ce079172f5862d5e6e5e18751b7b1f49dd1ca','a6d1c99c308e2fe85b0dc8db09231c2da35ba3a7','e19020d3d07a62e214a9d4f1eb79ee2e04b45aef',236]],
  ['cranelift',['d2b1d4054867a856170583709ebcf064f60eec9d','e27dee919c636c6f190da0e80e334284ace08666','31ec1b924304afb80fe576de22ace644d876db61','303419396fbbac44c6f0a55c2c95ea2b94af2e62','e19020d3d07a62e214a9d4f1eb79ee2e04b45aef',101]],
  ['js',['ae0000ffe1ec069cf25a52b9a456d3e4be61f185','31ba0d1b1d84229227cb98ce80a552765c141feb','53efc3037f36a7325d541506e23459bf82a439d9','f0b3a7d79d8db3ee5dd51dc90b0439261a3355da','e19020d3d07a62e214a9d4f1eb79ee2e04b45aef',141]],
  ['hdl',['c61ce1eaad8a266bf00541eb8ee4b6e244de5509','8a965049bbd38d1626c9ca7b1478887a5f4ef7fc','57843779acd2c424a9f5bcadeff2cb4f8b2c954e','656eed3d274ab7bd6ae679497736b47ac8aff4b3','e19020d3d07a62e214a9d4f1eb79ee2e04b45aef',70]],
]);
const files=[
  'tests/stdlib/websocket_quic_compute_smoke.atto',
  'tests/stdlib/protocol_boundaries.atto',
  'tests/stdlib/source_contract.test.mjs'
];
const profiles=new Map([
  ['java','JAVA_LINKED_GUEST_HARNESS_NOT_EXECUTED'],
  ['llvm','LLVM_NATIVE_GUEST_HARNESS_NOT_EXECUTED'],
  ['rs','RUST_WASM_GUEST_HARNESS_NOT_EXECUTED'],
  ['net','NET_NATIVEAOT_GUEST_NOT_VERIFIED'],
  ['wasm','SINGLE_FILE_BRIDGE_REJECTS_IMPORTS_AUTHORED_NOT_EXECUTED'],
  ['forge','FORGE_GUEST_NOT_VERIFIED'],
  ['cranelift','CRANELIFT_GUEST_NOT_VERIFIED'],
  ['js','JS_SCALAR_FRONTEND_REJECTS_UNLOWERED_PROTOCOL_AUTHORED_NOT_EXECUTED'],
  ['hdl','HDL_SCALAR_SYNTHESIS_UNVERIFIED']
]);

function verify(x) {
  assert.equal(x.schema,'atto.std-protocol-11-backend-evidence.v1');
  assert.equal(x.snapshot_date_utc,'2026-11-22');
  assert.equal(x.status,'PROPOSED_11_BACKEND_SOURCE_PARITY_NO_EXECUTED_GUEST_PROOF');
  assert.equal(x.repo_count,11);
  assert.equal(x.source_backends_with_draft,9);
  assert.equal(x.source_helpers_per_authored_backend,42);
  assert.equal(x.smoke_cases_per_backend,37);
  assert.equal(x.boundary_cases_per_backend,109);
  assert.equal(x.guest_cases_per_authored_backend,146);
  assert.equal(x.source_implementations,'INDEPENDENT_BACKEND_OWNED_ATTO_FILES');
  assert.equal(x.cross_backend_execution_parity,'NOT_VERIFIED');
  assert.deepEqual(x.guest_execution_certified_backends,[]);
  assert.deepEqual(x.rows.map(r=>r.repo),names.map(n=>prefix+n),
    'all eleven canonical backends must occur exactly once and in stable order');
  assert.equal(x.rows.filter(r=>r.candidate_pr!==null).length,9);
  const carrier=x.private_carrier;
  assert.equal(carrier.repo,'sonus-auris-test/atto-ci');
  assert.equal(carrier.source_free_run_id,45054599005);
  assert.equal(carrier.recorded_job_steps,3);
  assert.equal(carrier.source_free_run_conclusion,'success');
  assert.equal(carrier.source_snapshot_export_authorized,false,
    'stepful runner is not private source export authorization');
  assert.equal(carrier.transferred_private_source,false);
  assert.equal(carrier.provenance_scope,'HOSTED_RUNNER_CAPACITY_ONLY_NOT_GUEST_OR_SOURCE_EXPORT_EVIDENCE');

  for(const row of x.rows) {
    assert.equal(row.compiled_guest_status,'NOT_EXECUTED');
    assert.equal(row.executed_ci_steps,0,
      'zero-step source workflows must never count as material execution');
    assert.deepEqual(row.verified_guest_receipts,[]);
    assert.equal(row.private_export_approved,false,
      'external source export requires separate independently reviewed authorization');
    const backend=row.repo.slice(prefix.length);
    const snapshot=snapshots.get(backend);
    if(!snapshot){
      assert.ok(backend==='atto'||backend==='realtime');
      assert.equal(row.kind,'BOOTSTRAP_ONLY');
      assert.equal(row.candidate_pr,null);
      assert.equal(row.head_sha,null);
      assert.equal(row.root_tree_sha,null);
      assert.equal(row.source_blobs,null);
      assert.equal(row.source_fixture_cases,0);
      assert.equal(row.source_helpers,0);
      assert.equal(row.source_contract_status,'NO_PROTOCOL_SOURCE');
      assert.equal(row.execution_profile,'NO_COMPILER');
      assert.equal(row.ci_status,'NOT_EXECUTED');
      continue;
    }
    const [head,tree,boundary,smoke,audit,pr]=snapshot;
    assert.equal(row.kind,'BACKEND_OWNED_SOURCE_DRAFT');
    assert.equal(row.candidate_pr,pr);
    assert.match(row.head_sha,sha40);
    assert.match(row.root_tree_sha,sha40);
    assert.equal(row.head_sha,head,'candidate commit must be pinned to this immutable observation');
    assert.equal(row.root_tree_sha,tree,'actual Git root tree must be independently pinned');
    assert.notEqual(head,tree,'commit is never itself the root Git tree');
    assert.deepEqual(Object.keys(row.source_blobs),files,
      'only the three independently inspected .atto and audit source blobs are pinned');
    assert.equal(row.source_blobs[files[0]],smoke);
    assert.equal(row.source_blobs[files[1]],boundary);
    assert.equal(row.source_blobs[files[2]],audit);
    for(const oid of Object.values(row.source_blobs)) assert.match(oid,sha40);
    assert.equal(row.source_fixture_cases,146);
    assert.equal(row.smoke_cases,37);
    assert.equal(row.boundary_cases,109);
    assert.equal(row.source_helpers,42);
    assert.equal(row.source_contract_status,'SOURCE_AUDIT_AUTHORED_LOCAL_REFERENCE_ONLY');
    assert.equal(row.execution_profile,profiles.get(backend));
    assert.equal(row.ci_status,'QUEUED_OR_FAILED_NO_EXECUTED_STEPS');
  }
  return true;
}

test('all 11 source repositories are pinned; only nine own .atto protocol suites',()=>{
  assert.equal(verify(evidence),true);
});
test('forged successful guest evidence or promoted parity is never accepted',()=>{
  for(const mutant of [
    x=>x.rows[3].compiled_guest_status='PASS',
    x=>x.rows[3].verified_guest_receipts.push({claim:'PASS'}),
    x=>x.guest_execution_certified_backends.push('java'),
    x=>x.cross_backend_execution_parity='PASS',
    x=>x.rows[6].executed_ci_steps=12,
    x=>x.rows[6].ci_status='PASS'
  ]){
    const x=structuredClone(evidence);mutant(x);assert.throws(()=>verify(x));
  }
});
test('metadata from another source SHA or fabricated root tree is rejected',()=>{
  for(const mutant of [
    x=>x.rows[3].head_sha='0'.repeat(40),
    x=>x.rows[3].root_tree_sha=x.rows[3].head_sha,
    x=>x.rows[5].source_blobs[files[1]]='f'.repeat(40),
    x=>x.rows[3].candidate_pr=1787
  ]){const x=structuredClone(evidence);mutant(x);assert.throws(()=>verify(x));}
});
test('backend coverage or case count cannot be silently reduced or inflated',()=>{
  for(const mutant of [
    x=>x.rows.pop(),
    x=>x.rows[1]=x.rows[0],
    x=>x.rows[4].kind='BACKEND_OWNED_SOURCE_DRAFT',
    x=>x.rows[2].source_helpers=41,
    x=>x.rows[1].boundary_cases=108,
    x=>x.guest_cases_per_authored_backend=147
  ]){const x=structuredClone(evidence);mutant(x);assert.throws(()=>verify(x));}
});
test('source-free carrier cannot be forged into private source export authorization',()=>{
  for(const mutant of [
    x=>x.private_carrier.source_snapshot_export_authorized=true,
    x=>x.private_carrier.transferred_private_source=true,
    x=>x.private_carrier.source_free_run_id=0,
    x=>x.private_carrier.provenance_scope='ATTO_GUEST_PASSED',
    x=>x.rows[6].private_export_approved=true
  ]){const x=structuredClone(evidence);mutant(x);assert.throws(()=>verify(x));}
});
test('bootstrap-only .atto and .realtime never become fake compiler results',()=>{
  for(const suffix of ['atto','realtime']){
    const i=evidence.rows.findIndex(x=>x.repo===prefix+suffix);
    const x=structuredClone(evidence);x.rows[i].source_fixture_cases=146;
    assert.throws(()=>verify(x));
  }
});
test('unknown/reordered file identities and status promotion fail closed',()=>{
  for(const mutant of [
    x=>{x.rows[3].source_blobs['tests/stdlib/unknown.atto']='0'.repeat(40)},
    x=>{delete x.rows[3].source_blobs[files[0]]},
    x=>{x.rows[3].source_contract_status='PASS'},
    x=>{x.rows[3].execution_profile='FULL_COMPILER_PARITY'}
  ]){const x=structuredClone(evidence);mutant(x);assert.throws(()=>verify(x));}
});
