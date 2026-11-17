// HOST-ONLY pinned fixture/receipt integrity. Guest execution is recorded separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const registry=JSON.parse(readFileSync(join(root,'contracts/adt-lazy-guard-v2.json'),'utf8'));
const blobSha=buf=>createHash('sha1').update(Buffer.from('blob '+buf.length+'\0')).update(buf).digest('hex');
function validate(m){
  assert.equal(m.schema,'atto.adt-lazy-guard.v2');
  assert.equal(m.status,'RUST_WASM_SCOPED_PASS_NATIVE_PARITY_NOT_EXECUTED');
  const c=m.compiler, r=m.evidence['rust-wasm'];
  assert.match(c.source_head_sha,/^[a-f0-9]{40}$/);
  assert.match(c.source_root_git_tree_sha,/^[a-f0-9]{40}$/);
  assert.match(c.browser_harness_blob_sha,/^[a-f0-9]{40}$/);
  assert.equal(m.backend_states['rust-wasm'],'PASS_SCOPED');
  assert.equal(r.status,'PASS_SCOPED');
  assert.equal(r.source_head_sha,c.source_head_sha);
  assert.equal(r.source_tree_exact_match,true);
  assert.equal(r.verified_source_blobs,609);
  assert.equal(r.rust_tests_passed,300);
  assert.equal(r.rust_tests_failed,0);
  assert.equal(r.rust_test_summaries,46);
  assert.equal(r.real_compiler_wasm,true);
  assert.equal(r.real_guest_wasm,true);
  assert.equal(r.chromium_jspi,'PASS');
  assert.equal(r.browser_depth_positive,'250-term addition returned 250');
  assert.equal(r.browser_depth_negative,'3000-term addition returned E_NESTING with no guest');
  assert.match(r.carrier_commit_sha,/^[a-f0-9]{40}$/);
  assert.ok(Number.isSafeInteger(r.run_id)&&r.run_id>0);
  assert.ok(Number.isSafeInteger(r.job_id)&&r.job_id>0);
  for(const backend of ['java-native-image','llvm-native','dotnet-nativeaot']){
    assert.equal(m.backend_states[backend],'NOT_EXECUTED');
    assert.equal(m.evidence[backend],undefined);
  }
  for(const k of ['eval_scrutinee_once','bind_only_in_reached_candidate','validate_tag_before_payload',
    'guard_only_after_binding','guard_false_tries_next_arm','selected_arm_suppresses_later_guards',
    'unguarded_default_exhaustiveness','guarded_patterns_not_exhaustive','nonreturning_statement_arm_selection']){
    assert.equal(m.semantics[k],true,k);
  }
}
test('exact scoped runtime receipt and strictly not-executed native backends',()=>validate(registry));
test('all browser input fixtures have pinned original Git blob hashes',()=>{
  assert.equal(registry.cases.length,4);
  assert.equal(new Set(registry.cases.map(x=>x.id)).size,4);
  for(const row of registry.cases){
    assert.match(row.git_blob_sha1,/^[a-f0-9]{40}$/);
    assert.ok(row.path.startsWith('fixtures/adt-lazy-guard-v2/pass/'));
    const path=resolve(root,row.path);
    assert.ok(path.startsWith(root+sep));
    const bytes=readFileSync(path);
    assert.equal(blobSha(bytes),row.git_blob_sha1,row.id);
    const src=bytes.toString('utf8');
    assert.match(src,/\bwhen\b/);
    assert.match(src,/\b(?:match|switch)<int>/);
    assert.equal(row.expect.return_value,42);
    assert.equal(row.expect.kind,'executed_compiled_wasm_guest');
  }
  assert.deepEqual(registry.cases.map(r=>r.expect.stdout),['','GUARD_ONCE\n','','']);
});
test('tampered guest or native parity receipts fail closed',()=>{
  const corrupt=[
    r=>{r.backend_states['java-native-image']='PASS_SCOPED';},
    r=>{delete r.evidence['rust-wasm'];},
    r=>{r.evidence['rust-wasm'].source_tree_exact_match=false;},
    r=>{r.evidence['rust-wasm'].rust_tests_passed=0;},
    r=>{r.evidence['rust-wasm'].real_guest_wasm=false;},
    r=>{r.evidence['rust-wasm'].job_id=0;},
    r=>{r.semantics.validate_tag_before_payload=false;}
  ];
  for(const f of corrupt){const copy=structuredClone(registry);f(copy);assert.throws(()=>validate(copy))}
});
