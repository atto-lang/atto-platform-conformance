import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const c = JSON.parse(readFileSync(new URL('contracts/constructor-definite-final-admission-v2.json',root),'utf8'));

test('admission v2 covers all nine source cases and does not invent backend parity',()=>{
 assert.equal(c.schema,'atto.constructor-definite-final-admission-hardening.v2');
 assert.equal(c.status,'RUST_NATIVE_GUEST_VERIFIED');
 assert.equal(c.cases.length,9);
 assert.equal(c.cases.filter(x=>x.kind==='pass').length,2);
 assert.equal(new Set(c.cases.map(x=>x.id)).size,c.cases.length);
 assert.equal(c.backend_status['rs-native-guest'],'VERIFIED');
 assert.ok(Object.entries(c.backend_status).every(([backend,status])=>
   backend==='rs-native-guest'||status==='NOT_EXECUTED'));
 assert.match(c.source_compiler_merge_sha,/^[0-9a-f]{40}$/);
});
test('ordinary Atto fixtures have declared expected Wasm exit or compile rejection',()=>{
 for(const x of c.cases){
   const source=readFileSync(new URL(x.path,root),'utf8');
   assert.match(source,/define class Pair as/);
   assert.match(source,/pub fnc main\(\)/);
   assert.match(source,/final int left/);
   if(x.kind==='pass'){
     assert.equal(x.expected_exit,42);
     assert.ok(source.startsWith('// expect-exit: 42'));
   }else{
     assert.equal(x.no_wasm_artifact,true);
     assert.ok(source.startsWith('// expect-error: '+x.expected_error));
   }
 }
});

test('scoped compiled guest receipt pins source and denies inherited backend parity',()=>{
 const e=c.evidence;
 assert.equal(e.scope,'NATIVE_RUST_COMPILER_TO_EXECUTED_WASM_GUEST');
 for(const hash of [e.source_compiler_merge_sha,e.merged_src_tree_sha,
    e.merged_tests_tree_sha,e.portable_fixture_tree_sha,e.private_carrier_commit])
   assert.match(hash,/^[0-9a-f]{40}$/);
 assert.equal(e.source_compiler_merge_sha,c.source_compiler_merge_sha);
 assert.equal(e.run_id,44458895446);
 assert.equal(e.job_id,135340588638);
 assert.equal(e.conclusion,'success');
 assert.deepEqual(e.rust_focused_tests,{passed:20,failed:0});
 assert.deepEqual(e.source_contract_tests,{passed:2,failed:0});
 assert.deepEqual(e.compiled_wasm_guests,{passed:2,returned:42});
 assert.deepEqual(e.compile_negative_cases,{passed:7,artifacts_emitted:0});
 assert.equal(e.compiler_full_suite.exact_git_source_and_test_blobs,703);
 assert.deepEqual(e.compiler_full_suite.rust_tests,{passed:577,failed:0});
 assert.equal(e.compiler_full_suite.including_ast_parser_bypass_guard,true);
 assert.equal(e.excluded_backends.length,8);
 assert.equal(c.backend_status['rs-browser-hosted'],'NOT_EXECUTED');
});
