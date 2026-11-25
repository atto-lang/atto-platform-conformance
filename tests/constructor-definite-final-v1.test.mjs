import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const c=JSON.parse(readFileSync(new URL('contracts/constructor-definite-final-v1.json',root),'utf8'));
test('deferred final registry includes honest independent backend status',()=>{
  assert.equal(c.schema,'atto.constructor-definite-final.v1');
  assert.equal(c.status,'RUST_NATIVE_TO_WASM_GUEST_SCOPED_PASS');
  assert.equal(c.backend_status['rs-native-host'],'VERIFIED');
  assert.ok(Object.entries(c.backend_status).every(([key,value])=>
    key==='rs-native-host'||value==='NOT_EXECUTED'));
  assert.equal(c.cases.length,13);
  assert.equal(c.cases.filter(x=>x.kind==='pass').length,3);
  assert.equal(new Set(c.cases.map(x=>x.id)).size,c.cases.length);
});
test('every ordinary Atto fixture is declared and has an expected exit or compiler diagnostic',()=>{
  for(const item of c.cases){
    const s=readFileSync(new URL(item.path,root),'utf8');
    assert.match(s,/define class Ticket as/);
    assert.match(s,/pub final int id/);
    assert.match(s,/pub fnc main\(\)/);
    if(item.kind==='pass'){
      assert.equal(item.expected_exit,42);
      assert.ok(s.startsWith('// expect-exit: 42'));
    }else{
      assert.equal(item.no_artifact,true);
      assert.ok(s.startsWith('// expect-error: '+item.expected_error));
    }
  }
});

test('exact-SHA compiled guest evidence is scoped and cannot be inherited by another backend',()=>{
  const e=c.evidence;
  assert.equal(e.scope,'NATIVE_RUST_COMPILER_TO_EXECUTED_WASM_GUEST');
  assert.equal(e.conclusion,'success');
  for(const sha of [c.compiler_merged_sha,e.compiler_head_at_guest_run,
    e.carrier_commit,e.full_rust_suite_evidence.carrier_commit,
    e.full_rust_suite_evidence.reconciled_source_head,
    e.full_rust_suite_evidence.source_subtree_sha,
    e.full_rust_suite_evidence.tests_subtree_sha])
    assert.match(sha,/^[0-9a-f]{40}$/);
  assert.equal(e.run_id,44452651416);
  assert.equal(e.job_id,135320078622);
  assert.equal(e.exact_source_blobs_verified,58);
  assert.deepEqual(e.rust_library_tests,{passed:40,failed:0});
  assert.deepEqual(e.rust_constructor_tests,{passed:16,failed:0});
  assert.deepEqual(e.portable_integrity_tests,{passed:2,failed:0});
  assert.deepEqual(e.compiled_wasm_positive_cases,{count:3,entrypoint:'main',expected_return:42});
  assert.equal(e.compile_negative_cases.count,10);
  assert.equal(e.compile_negative_cases.emitted_artifacts,0);
  assert.deepEqual(e.full_rust_suite_evidence.rust_tests,{passed:547,failed:0});
  assert.equal(e.full_rust_suite_evidence.exact_source_and_test_git_blob_count,697);
  assert.equal(e.exclusions.length,8);
  assert.ok(e.exclusions.includes('rs-browser-hosted'));
});

test('merged Rust compiler guest receipt proves execution without cross-backend claims',()=>{
  const e=c.evidence.merged_compiler_guest;
  assert.equal(e.scope,'EXACT_MERGED_RUST_SRC_TREE_TO_EXECUTED_WASM_GUEST');
  for(const sha of [e.source_merge_commit,e.merged_src_tree_sha,
    e.portable_fixture_tree_sha,e.carrier_commit])
    assert.match(sha,/^[0-9a-f]{40}$/);
  assert.equal(e.source_merge_commit,c.compiler_merged_sha);
  assert.equal(e.run_id,44454811741);
  assert.equal(e.job_id,135327139981);
  assert.equal(e.conclusion,'success');
  assert.deepEqual(e.focused_rust_constructor_tests,{passed:16,failed:0});
  assert.deepEqual(e.updated_registry_tests,{passed:3,failed:0});
  assert.deepEqual(e.compiled_wasm_positive_guests,{count:3,return_value:42});
  assert.deepEqual(e.rejected_portable_cases,{count:10,emitted_artifacts:0});
  assert.equal(c.backend_status['rs-browser-hosted'],'NOT_EXECUTED');
  assert.equal(c.backend_status.java,'NOT_EXECUTED');
});
