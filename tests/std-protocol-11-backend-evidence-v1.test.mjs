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
  ['net',["8d0e658fd677fcb518a65b3ad74ac20a55b1f8ef","6a430d0150ca83b16af9d8c613f4727846826aa3","767a274beda8190200057b993036673beb0a0d23","9daec1444782870ba9b292d6f374b4af64faf743","b35ff8ed06d11b7168c09b6d4b77b12c08840dd0",228]],
  ['hdl',["449633fb2985795f821363a41338877e16fb2d7d","de111481859481cc5d75a5d6838a7f905d92bce6","45326a21daf9f15734436d4c3066866e5669dafc","656eed3d274ab7bd6ae679497736b47ac8aff4b3","b35ff8ed06d11b7168c09b6d4b77b12c08840dd0",70]],
  ['java',["dd024bd68cb2d289a260f21b284d26d1da634784","1c51b4688d3ed0d06fe859a6a5b7f36980838cb8","4d9985481f2f52b8fb94038a15de2135a3ad6aad","2fe74c554f4163d0436a2f45fb47eec13a904f80","0e4a836fe21bd4517d20ecebe5a03520e1dcb6b1",1786]],
  ['rs',["fae9f55964fec888147ba48efd9e0bfef7407f6e","cdd55487dfa8c03a40f8bac12480d13d0f6e7e49","409cf612cadff0fed591cdda0d88853def3e4e54","7534eb2ed7abd2339988b42d5086f5e45a062b9d","f60cf9c7bc5e0961ceec28638d7aff1eb51f9be4",546]],
  ['llvm',["80aa22a678a2781da260b32374b0782b76a59509","c7d229b05c5fcc011a5a0789dbad8ef98a60c94f","7e992ec38d953ec49cc7dabcf9f3fbd4b920dd92","4f984f5e0d39f2205b4e7b979ecdd4168bf587e6","b35ff8ed06d11b7168c09b6d4b77b12c08840dd0",884]],
  ['js',["358d4d6f063721c1380d4aaf186889aeecb846a6","43e6fe50cb1daa06501a4d088c0d94c5ac43f9f6","288160e53aac3bcb32cadcbf20bcafdc48f0b72c","f0b3a7d79d8db3ee5dd51dc90b0439261a3355da","b35ff8ed06d11b7168c09b6d4b77b12c08840dd0",141]],
  ['forge',["3205ac988683a4d06e725416ae4a9065b80374b9","6d5988b470621edac979bef3bcbddee8680ccc19","cea8847999701be6cff603d4c3c7458213acbb98","a6d1c99c308e2fe85b0dc8db09231c2da35ba3a7","b35ff8ed06d11b7168c09b6d4b77b12c08840dd0",236]],
  ['wasm',["95a3d37fa14108beec973e87256688f919054c9f","e36b0759106b1f4bd5f3d7f9e80d9715636afeb8","077e3a21d721a0df7ae05481e06650b07da6da8d","ced295c28708c747d4148977bda55568aa797179","b35ff8ed06d11b7168c09b6d4b77b12c08840dd0",291]],
  ['cranelift',["215aca3905a706234e0158164db1e80dad3b2449","06d0fd7c16386a68b4aff4503009f80dad3b2449","1c1e93ab36b55166844c8c66c397c127e6950597","303419396fbbac44c6f0a55c2c95ea2b94af2e62","b35ff8ed06d11b7168c09b6d4b77b12c08840dd0",101]],
]);
const libraryFiles=["stdlib/std/websocket.atto","stdlib/std/quic.atto","stdlib/std/compute.atto"];
const librarySnapshots=new Map([
  ['net',["886e8883b386a26770d29a58da6be7f781dd6f53","0e324d759ed412900dfe8b3d3071bc7ab053fddd","757649105ca8e510e5f7ed7dc2d4706e2d473791"]],
  ['hdl',["5f4a58c0907487cef6c775b11f4ac3658998be3e","6ee44475c34e903d4aa3b4c3a25baada67670b43","5b17bb9b22ec0e9b8b78b8b54629482ea1e20871"]],
  ['java',["ee0f622bea3bd63707aff7ff667308d59f9da974","7694229c2fd13b6ab1ba6309369a909c1714dc1b","ee89c7aa787977391a363142283ec8d262a8bbe4"]],
  ['rs',["160fe1425abcfec3a5b666d15c1df14aea1eaaeb","944149db26c9accaf0a683b12c11142fe7dc23dd","903e172cd72bd3fc84744c9a225ddfefefce048c"]],
  ['llvm',["2be6c322fb9a4033ad70d369e7981645617bb004","154b86bdfe8d51cac7fd9dd213067db2c9c1a6eb","d2a0df787e7b8a9a9292ae086023e3db126fb100"]],
  ['js',["9e68e0e482f67bb765c77574db40fbe7d94fbc6a","37bfcb1ea955ab9f45eb2f294ced9d067d8d81d0","f4f857ffb9f2ab97021b6ad02a00bffecea6aaec"]],
  ['forge',["febcc65011ea839020b07c2c0a59b1698f5be715","f4d4a77907adc42b6372d7d0a53b8b76cd09be72","75ec867aab3c29a0cb614b0e6e6d8c1d1bdf3616"]],
  ['wasm',["547976194bb2dc17a1bf2b64318a189d819e46d1","1e68c03d1ae0c8aead045ce67d8501530f1427e1","f4b44c8a49615f965a1e1aa893f917acaef65701"]],
  ['cranelift',["bcbf71b39d5d7d8d93440f5ddd3758fb9946812b","75ded91cc10ba0fed5d2f0b601d8966a5806749e","e983b32a94d1d7511e3bcd84b64967158d082f64"]],
]);
const files=[
  'tests/stdlib/websocket_quic_compute_smoke.atto',
  'tests/stdlib/protocol_boundaries.atto',
  'tests/stdlib/source_contract.test.mjs'
];
const borrowCorePins=new Map([
 ['java','539b209c74668973305408c32309ace063206964'],
 ['llvm','962647bc6c18f6e44c8d1f5a5fabf0705b8974c6'],
 ['rs','f590427df95284c9ba3fdbdfc87294e970c9ab68'],
 ['net','19211cf32235ba85b34652bffd377ef339519731'],
 ['wasm','81bcdf607015803236c9826ce9943ebc26d05cff'],
 ['forge','b180f399ac952671009c7bb61c80eba3e8216aa4'],
 ['cranelift','28659ee7f18548b08f0d6c4db027c6034e51c94f'],
 ['js','a517c9c9f91d8f9240d9f902c753b947c3cb6aa0'],
 ['hdl','4e86845baadc479bcdaf00a30cd36b41bf5c3467']
]);
const rustBorrowHarnessPins={
 'tests/stdlib_native_guest.rs':'d349a17c27c5dcadd058bdcbd5c257891ce7d744',
 'tests/stdlib_native_guest_wasm.test.mjs':'c6d6e00ba49189214d5ddc0a508dac4d7aeb0b61',
 'examples/stdlib_native_guest.rs':'5750616a0d04c6bbd24cd04f39ea4e60c2abb739',
 '.github/workflows/std-native-guest.yml':'26c816ec3a86577113d1806efb862c521e93be4f'
};

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
  assert.equal(x.compute_dispatch_contract,
    'PARTIAL_WORKGROUPS_ALLOWED_NUMERIC_ONLY_RUNTIME_MUST_GUARD_PADDED_INVOCATIONS');
  assert.deepEqual(x.guest_execution_certified_backends,[]);
  assert.equal(x.core_borrow_contract,
    'COMPILER_ENFORCED_SCOPED_LOANS_NO_LIBRARY_RUNTIME_SUBSTITUTE');
  assert.equal(x.core_borrow_compiled_guest_parity,'NOT_VERIFIED');
  assert.deepEqual(x.core_borrow_certified_backends,[]);
  assert.deepEqual(x.rust_borrow_core_harness_blobs,rustBorrowHarnessPins);
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
  const receipt=carrier.protocol_reference_run;
  assert.equal(receipt.repo_id,1458331448);
  assert.equal(receipt.run_id,45058040904);
  assert.equal(receipt.job_id,137317561550);
  assert.equal(receipt.carrier_head_sha,'2fcd30702c2fdb2ad1a3f74f72ba2071293ed482');
  assert.equal(receipt.carrier_root_tree_sha,'7b1fcc5953061bb8d3f92b1b0fd9305a9c9d87f2');
  assert.equal(receipt.source_free_workflow_blob,'f8d6e2e6d0a4e3f0b4534808935cb212efacde40');
  assert.equal(receipt.source_free_reference_test_blob,'f840e68f8d01826f574ef03e3d52c514c8121a7a');
  assert.equal(receipt.actual_job_steps,6);
  assert.equal(receipt.node_tests_passed,4);
  assert.equal(receipt.node_tests_failed,0);
  assert.equal(receipt.checked_arithmetic_pairs,20660);
  assert.equal(receipt.run_conclusion,'success');
  assert.equal(receipt.scope,'HOSTED_SOURCE_FREE_REFERENCE_NOT_COMPILED_ATTO');
  assert.equal(receipt.source_snapshot_export_authorized,false);
  assert.equal(receipt.transferred_private_atto_source,false);
  const ownership=carrier.borrow_reference_run;
  assert.equal(ownership.repo_id,1458331448);
  assert.equal(ownership.run_id,45059875505);
  assert.equal(ownership.job_id,137323186804);
  assert.equal(ownership.carrier_head_sha,'3d7a582fc61df3fcf5cadc6656a0c5b91a5e665e');
  assert.equal(ownership.carrier_root_tree_sha,'9b5edded4df406ec43edf739ec293f92ec80bce9');
  assert.equal(ownership.source_free_borrow_test_blob,'76dd59ccbd32dfd21617507bb59817cea83fb9f0');
  assert.equal(ownership.source_free_math_test_blob,'f840e68f8d01826f574ef03e3d52c514c8121a7a');
  assert.equal(ownership.workflow_blob,'eb37a6982d0632cc19c3ae009f28510844af4361');
  assert.equal(ownership.actual_job_steps,6);
  assert.equal(ownership.node_tests_passed,10);
  assert.equal(ownership.node_tests_failed,0);
  assert.equal(ownership.borrow_reference_cases,6);
  assert.equal(ownership.arithmetic_pairs,20660);
  assert.equal(ownership.run_conclusion,'success');
  assert.equal(ownership.scope,'SOURCE_FREE_BORROW_AUTOMATON_NOT_ATTO_GUEST_COMPILER');
  assert.equal(ownership.private_source_export_authorized,false);
  assert.equal(ownership.transferred_private_source,false);


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
      assert.equal(row.library_blobs,null);
      assert.equal(row.borrow_core,null);
      assert.equal(row.partial_workgroup_numeric_admission,'NOT_IMPLEMENTED');
      assert.equal(row.padded_invocation_bounds_guard,'NOT_APPLICABLE_BOOTSTRAP');
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
    assert.deepEqual(Object.keys(row.library_blobs),libraryFiles,
      'three independently maintained .atto library implementations must be pinned');
    assert.deepEqual(libraryFiles.map(path=>row.library_blobs[path]),
      librarySnapshots.get(backend),
      'library Git blob must match independent exact head inspection');
    for(const oid of Object.values(row.library_blobs)) assert.match(oid,sha40);
    assert.equal(row.partial_workgroup_numeric_admission,'SOURCE_AUTHORED_NOT_EXECUTED');
    assert.equal(row.padded_invocation_bounds_guard,'RUNTIME_REQUIRED_NOT_VERIFIED');
    assert.equal(row.source_fixture_cases,146);
    assert.equal(row.smoke_cases,37);
    assert.equal(row.boundary_cases,109);
    assert.equal(row.source_helpers,42);
    assert.equal(row.source_contract_status,'SOURCE_AUDIT_AUTHORED_LOCAL_REFERENCE_ONLY');
    const borrow=row.borrow_core;
    assert.equal(borrow.positive_fixture_path,'tests/stdlib/protocol_borrow_core.atto');
    assert.equal(borrow.positive_fixture_git_blob,borrowCorePins.get(backend),
      'independent exact core borrow .atto Git blob must match reviewed source');
    assert.match(borrow.positive_fixture_git_blob,sha40);
    assert.equal(borrow.language_profile,'SCOPED_CLASS_READ_WRITE_LOANS_AND_TAKE');
    assert.equal(borrow.enforced_in,'CORE_COMPILER_FRONTEND_NOT_STDLIB_SHIM');
    assert.deepEqual(borrow.linked_protocol_helpers,[
      'websocket_backpressure_admit','quic_stream_range_fits',
      'compute_buffer_range_fits','compute_upload_admit'
    ]);
    assert.equal(borrow.candidate_compile_status,'NOT_EXECUTED');
    assert.equal(borrow.negative_compiler_checks_authored,backend==='rs'?6:0);
    assert.equal(borrow.negative_source_mutations_authored,backend==='rs'?0:7);
    assert.equal(borrow.compiled_wasm_guest_required,backend==='rs');
    assert.equal(borrow.guest_execution_status,'NOT_EXECUTED');
    assert.equal(borrow.resource_handle_borrow_safety,'NOT_VERIFIED');
    assert.equal(borrow.borrow_cross_await,'NOT_VERIFIED');
    assert.equal(borrow.borrow_ownership_transfer,'NOT_VERIFIED');
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


test('library implementation Git blobs, numeric dispatch and runtime bounds obligations are nonforgeable',()=>{
  for(const mutant of [
    x=>x.rows[3].library_blobs['stdlib/std/compute.atto']='a'.repeat(40),
    x=>{delete x.rows[3].library_blobs['stdlib/std/websocket.atto']},
    x=>x.rows[3].partial_workgroup_numeric_admission='GUEST_PASS',
    x=>x.rows[3].padded_invocation_bounds_guard='GPU_MEMORY_SAFE',
    x=>x.compute_dispatch_contract='RUNTIME_UNCHECKED_GPU_OK',
    x=>x.rows[0].library_blobs={'stdlib/std/compute.atto':'0'.repeat(40)}
  ]){const altered=structuredClone(evidence);mutant(altered);assert.throws(()=>verify(altered));}
});


test('genuine source-free carrier receipt cannot be used as private-source or guest authorization',()=>{
  for(const mutant of [
    x=>x.private_carrier.protocol_reference_run.run_id=0,
    x=>x.private_carrier.protocol_reference_run.actual_job_steps=0,
    x=>x.private_carrier.protocol_reference_run.node_tests_passed=5,
    x=>x.private_carrier.protocol_reference_run.carrier_root_tree_sha='0'.repeat(40),
    x=>x.private_carrier.protocol_reference_run.source_free_reference_test_blob='0'.repeat(40),
    x=>x.private_carrier.protocol_reference_run.scope='ATTO_NATIVE_GUEST_SUCCESS',
    x=>x.private_carrier.protocol_reference_run.source_snapshot_export_authorized=true,
    x=>x.private_carrier.protocol_reference_run.transferred_private_atto_source=true
  ]){const altered=structuredClone(evidence);mutant(altered);assert.throws(()=>verify(altered));}
});


test('core borrow candidate remains source-authored, never silently promoted to compiled guest',()=>{
  for (const mutate of [
    x=>x.core_borrow_compiled_guest_parity='PASS',
    x=>x.core_borrow_certified_backends.push('rs'),
    x=>x.rows[5].borrow_core.positive_fixture_git_blob='0'.repeat(40),
    x=>x.rows[3].borrow_core.candidate_compile_status='PASS',
    x=>x.rows[3].borrow_core.negative_compiler_checks_authored=6,
    x=>x.rows[5].borrow_core.negative_compiler_checks_authored=0,
    x=>x.rows[3].borrow_core.borrow_cross_await='SAFE',
    x=>x.rows[5].borrow_core.resource_handle_borrow_safety='CERTIFIED',
    x=>x.rust_borrow_core_harness_blobs['examples/stdlib_native_guest.rs']='0'.repeat(40),
    x=>x.rows[0].borrow_core={claim:'PASS'}
  ]){const v=structuredClone(evidence);mutate(v);assert.throws(()=>verify(v));}
});
test('source-free borrow reference receipt cannot counterfeit private compiler or export proof',()=>{
  for (const mutate of [
    x=>x.private_carrier.borrow_reference_run.run_id=0,
    x=>x.private_carrier.borrow_reference_run.node_tests_passed=0,
    x=>x.private_carrier.borrow_reference_run.source_free_borrow_test_blob='0'.repeat(40),
    x=>x.private_carrier.borrow_reference_run.scope='CORE_COMPILER_PASSED',
    x=>x.private_carrier.borrow_reference_run.private_source_export_authorized=true,
    x=>x.private_carrier.borrow_reference_run.transferred_private_source=true
  ]){const v=structuredClone(evidence);mutate(v);assert.throws(()=>verify(v));}
});
