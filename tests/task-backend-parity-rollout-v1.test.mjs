// Source-only backend inventory and no-false-parity certification gate.
// This does NOT execute Atto compiler or guest programs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = p => JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const matrix = read('contracts/task-backend-parity-rollout-v1.json');
const registry = read('contracts/task-payload-sync-v1.json');
const compiler = read('contracts/task-compiler-parity-admission-v1.json');
const expected = ['atto','cranelift','forge','hdl','java','js','llvm','net','realtime','rs','wasm'];
test('all eleven atto-source.* targets appear once, including bootstrap and realtime',()=>{
 assert.equal(matrix.schema,'atto.task-backend-parity-rollout.v1');
 assert.equal(matrix.evidence_class,'AUDIT_SNAPSHOT_NOT_EXECUTION_PROOF');
 assert.deepEqual(Object.keys(matrix.backends).sort(),expected);
 assert.equal(matrix.rollup.target_repositories,11);
 assert.equal(matrix.rollup.production_task_runtime_certified,0);
 assert.equal(matrix.rollup.all_backends_release_qualified,false);
 assert.equal(registry.status,'TARGET_NOT_GUEST_VERIFIED');
 assert.equal(registry.cases.length,42);
 assert.deepEqual(Object.keys(registry.backends).sort(),[
   'atto','cranelift','forge','hdl','independent-wasm','java','js','llvm','net','realtime','rs-wasm'
 ]);
 assert.equal(Object.keys(compiler.source_profiles).length,11);
 assert.equal(compiler.source_profiles.realtime.release_qualified,false);
});
test('backend audit snapshots never masquerade as full compilation results',()=>{
 const allowed=new Set([
 'EXECUTED_LIMITED_PROFILE','NOT_CURRENT_HEAD_VERIFIED',
 'NOT_INDEPENDENTLY_VERIFIED_HERE','EVIDENCE_REPORTED_NOT_RECHECKED_HERE',
 'GUEST_NOT_EXECUTED','NATIVE_NODE_BROWSER_NOT_EXECUTED','NOT_EXECUTED'
 ]);
 for(const [name,b] of Object.entries(matrix.backends)){
   assert.equal(b.repository,'atto-lang/atto-source.'+name);
   assert.equal(b.platform,name);
   assert.equal(b.full_task_runtime_status,'NOT_EXECUTED');
   assert.equal(b.release_qualified,false);
   assert.ok(allowed.has(b.execution_status),name);
   assert.ok(b.source_export_policy && b.evidence_note,name);
   if(b.canonical_draft_pr){
     assert.equal(b.canonical_draft_pr,`https://github.com/atto-lang/atto-source.${name}/pull/${name==='java'?59:name==='llvm'?72:name==='net'?30:name==='forge'?52:name==='cranelift'?54:name==='rs'?438:name==='wasm'?53:name==='hdl'?20:68}`);
     assert.match(b.current_observed_head,/^[0-9a-f]{40}$/);
   } else assert.ok(['atto','realtime'].includes(name));
 }
 assert.equal(matrix.backends.wasm.source_export_policy,'NO_EXPORT_HOLD');
 assert.equal(matrix.backends.js.source_export_policy,'NO_EXPORT_HOLD');
 assert.equal(matrix.backends.llvm.source_export_policy,'NO_EXPORT_HOLD');
 assert.equal(matrix.backends.hdl.source_export_policy,'NO_EXPORT_HOLD');
 assert.equal(matrix.backends.hdl.restricted_source_probe.node22_cli_test_run,false);
 assert.equal(matrix.backends.java.execution_status,'EXECUTED_LIMITED_PROFILE');
 assert.equal(matrix.backends.java.restricted_execution_receipt,'contracts/task-java-inline-typed-v2-20261120.json');
});
test('no backend is silently allowed to redefine inline vs spawned semantics',()=>{
 const s=matrix.semantic_invariants;
 for(const key of ['no_spawn_for_inline','inline_current_task_id','do_sync_only_void',
 'do_task_distinct_and_may_discard_nonvoid','bare_void_sync_statement_requires_do',
 'value_sync_task_is_expression','checked_int_is_i64','unsupported_rejects_before_artifact',
 'tenant_vm_cross_tenant_no_ambient_privileges'])assert.equal(s[key],true,key);
 const v=Object.fromEntries(matrix.syntax_cases.map(x=>[x.id,x]));
 assert.equal(Object.keys(v).length,matrix.syntax_cases.length);
 assert.match(v.void_do_inferred.syntax,/do sync task/);
 assert.match(v.void_do_explicit.syntax,/do sync task<void>/);
 assert.match(v.do_nonvoid_reject.target,/E_TASK_RETURN_TYPE/);
 assert.match(v.do_inferred_nonvoid_reject.target,/E_TASK_RETURN_TYPE/);
 assert.match(v.bare_void_statement_reject.target,/E_SYNTAX/);
 assert.match(v.bare_typed_void_statement_reject.target,/E_SYNTAX/);
 assert.ok(matrix.required_gates.length>=10);
});

test('canonical diagnostic mismatches remain open until exact guest evidence resolves them',()=>{
 const ids=new Set(matrix.reconciliation_findings.map(x=>x.id));
 assert.equal(ids.size,matrix.reconciliation_findings.length);
 for(const id of ['js_bare_void_statement_diagnostic',
 'forge_bare_void_statement_diagnostic','llvm_mixed_rust_cpp_frontend',
 'hardware_rtl_profile_semantics'])assert.ok(ids.has(id),id);
 const js=matrix.reconciliation_findings.find(x=>x.id==='js_bare_void_statement_diagnostic');
 const forge=matrix.reconciliation_findings.find(x=>x.id==='forge_bare_void_statement_diagnostic');
 assert.equal(js.canonical_diagnostic,'E_SYNTAX');
 assert.equal(forge.canonical_diagnostic,'E_SYNTAX');
 assert.equal(js.previous_observed_diagnostic,'E_TASK_DISCARD_REQUIRES_DO');
 assert.equal(forge.previous_observed_diagnostic,'E_PARSE_SYNTAX');
 assert.equal(js.observed_diagnostic,'E_SYNTAX');
 assert.equal(forge.observed_diagnostic,'E_SYNTAX');
 assert.equal(js.status,'SOURCE_FIXED_GUEST_UNVERIFIED');
 assert.equal(forge.status,'SOURCE_FIXED_GUEST_UNVERIFIED');
 assert.equal(matrix.backends.js.execution_status,'NATIVE_NODE_BROWSER_NOT_EXECUTED');
 assert.equal(matrix.backends.forge.execution_status,'NOT_CURRENT_HEAD_VERIFIED');
 assert.equal(matrix.rollup.production_task_runtime_certified,0);
});
