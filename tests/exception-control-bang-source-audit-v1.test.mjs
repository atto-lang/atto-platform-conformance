import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const contract=JSON.parse(readFileSync(new URL(
  '../contracts/exception-control-bang-source-audit-v1.json',import.meta.url),'utf8'));
const suffixes=['atto','cranelift','forge','hdl','java','js','llvm','net','realtime','rs','wasm'];
const oid=/^[a-f0-9]{40}$/;
function assertSourceAudit(x){
  assert.equal(x.schema,'atto.exception-control-bang-source-audit.v1');
  assert.equal(x.status,'PROPOSED_SOURCE_DIFFS_NO_BACKEND_EXECUTION_CERTIFIED');
  assert.equal(x.canonical_spec.repo,'atto-lang/atto-spec');
  assert.equal(x.canonical_spec.pr,146);
  assert.equal(x.canonical_spec.lexical_vectors,18);
  assert.match(x.canonical_spec.head_sha,oid);
  assert.match(x.canonical_spec.blob_sha,oid);
  assert.equal(x.backend_count,11);
  assert.deepEqual(x.backends.map(r=>r.repo),suffixes.map(s=>'atto-lang/atto-source.'+s));
  assert.equal(new Set(x.backends.map(r=>r.candidate_head_sha)).size,11);
  for(const row of x.backends){
    assert.match(row.candidate_head_sha,oid);
    assert.ok(Number.isInteger(row.existing_pr) && row.existing_pr>0);
    assert.equal(row.candidate_branch,'draft/bang-exception-keywords-20261120');
    assert.equal(row.direct_guest_execution,'NOT_EXECUTED');
    assert.equal(row.compiler_ci_exact_head,'NOT_VERIFIED');
    assert.equal(row.semantic_exception_effect_parity,'NOT_VERIFIED');
    assert.equal(row.independent_compiler_certification,false);
    assert.ok(typeof row.profile==='string'&&row.profile.length>10);
    assert.equal(typeof row.has_frontend_in_this_repository,'boolean');
  }
  assert.equal(x.backends.filter(r=>r.has_frontend_in_this_repository).length,8);
  // These are staged compiler-source guards, NOT passed guest receipts.
  for(const suffix of ['java','llvm','rs']){
    const row=x.backends.find(r=>r.repo==='atto-lang/atto-source.'+suffix);
    assert.equal(row.canonical_trap_result_guard,'SOURCE_PATCHED_NOT_EXECUTED');
  }
  const llvm=x.backends.find(r=>r.repo==='atto-lang/atto-source.llvm');
  assert.equal(llvm.canonical_throw_error_guard,'SOURCE_PATCHED_NOT_EXECUTED');
  assert.equal(llvm.candidate_head_sha,'06e15f496155f5162a79311b3fc22bb1c63d108d');
  assert.equal(llvm.native_cpp_canonical_result_and_error_diagnostic_guard,'SOURCE_PATCHED_NOT_EXECUTED');
  assert.equal(llvm.native_compiler_negative_gate,'10_REJECT_1_POSITIVE_AUTHORED_NOT_EXECUTED');
  const rust=x.backends.find(r=>r.repo==='atto-lang/atto-source.rs');
  assert.equal(rust.canonical_typed_throw_raise_guest_suite,'AUTHORED_NOT_EXECUTED');
  const wasm=x.backends.find(r=>r.repo==='atto-lang/atto-source.wasm');
  assert.equal(wasm.has_frontend_in_this_repository,false);
  assert.equal(wasm.delegated_wasm_compiler_artifact_gate,'AUTHORED_NOT_EXECUTED');
  assert.equal(wasm.candidate_head_sha,'79dc0a23ded65b5f1ddd799eff8499662e1f0473');
  assert.equal(wasm.isolated_guest_host_security_gate,'SYNTHETIC_WASM_LOCAL_NODE22_7_OF_7_NOT_COMPILER');
  assert.equal(wasm.guest_child_execution_timeout_ms,5000);
  assert.equal(wasm.guest_child_stdout_limit_bytes,4096);
  assert.equal(wasm.compiled_guest_from_approved_rust_compiler,'NOT_EXECUTED');
  assert.equal(x.full_parity_certified,false);
  assert.ok(x.merge_gates.includes('actual_compiler_or_guest_execution_receipts_and_rejections'));
}
const clone=x=>structuredClone(x);
test('source audit covers exactly eleven pinned draft heads and eighteen lexical vectors',()=>{
  assertSourceAudit(contract);
});
test('neither a missing backend nor duplicate backend may claim parity',()=>{
  const absent=clone(contract);absent.backends.pop();
  assert.throws(()=>assertSourceAudit(absent));
  const duplicate=clone(contract);duplicate.backends[0]=duplicate.backends[1];
  assert.throws(()=>assertSourceAudit(duplicate));
});
test('source-only profiles and delegated Wasm cannot be marked as guest passes',()=>{
  for(const patch of [
    x=>x.backends[0].direct_guest_execution='PASSED',
    x=>x.backends[9].semantic_exception_effect_parity='PASSED',
    x=>x.backends[10].independent_compiler_certification=true,
    x=>x.full_parity_certified=true
  ]){
    const mutated=clone(contract);patch(mutated);
    assert.throws(()=>assertSourceAudit(mutated));
  }
});
test('compiler-source guards cannot be upgraded to unverified guest success',()=>{
  for(const mutation of [
    x=>x.backends[4].canonical_trap_result_guard='PASS',
    x=>x.backends[6].canonical_throw_error_guard='PASS',
    x=>x.backends[9].canonical_typed_throw_raise_guest_suite='PASS',
    x=>x.backends[10].delegated_wasm_compiler_artifact_gate='PASS',
  ]){
    const altered=clone(contract);mutation(altered);
    assert.throws(()=>assertSourceAudit(altered));
  }
});
test('exact git identity and capability boundaries are pinned',()=>{
  const mutated=clone(contract);
  mutated.backends[4].candidate_head_sha='main';
  assert.throws(()=>assertSourceAudit(mutated));
  mutated.backends[4].candidate_head_sha=contract.backends[4].candidate_head_sha;
  mutated.backends[10].has_frontend_in_this_repository=true;
  assert.throws(()=>assertSourceAudit(mutated));
});

test('LLVM native Result-vs-Option and typed-Error diagnostics cannot masquerade as guest execution',()=>{
  for(const mutate of [
    x=>x.backends[6].candidate_head_sha='95a82ea3857ed9f2a57fb2ade3594defd673c454',
    x=>x.backends[6].native_cpp_canonical_result_and_error_diagnostic_guard='GUEST_PASS',
    x=>x.backends[6].native_compiler_negative_gate='8_REJECT_1_POSITIVE_PASS',
    x=>x.backends[6].native_compiler_negative_gate='',
    x=>x.backends[6].direct_guest_execution='PASSED'
  ]){
    const altered=clone(contract);mutate(altered);
    assert.throws(()=>assertSourceAudit(altered));
  }
});

test('seven locally executed synthetic Wasm host guards do not certify a compiled Atto guest',()=>{
  for(const mutate of [
    x=>x.backends[10].candidate_head_sha='8c87726ae46d667b1a9a175e8fb605b110f7fc2d',
    x=>x.backends[10].isolated_guest_host_security_gate='GUEST_PARITY_PASSED',
    x=>x.backends[10].guest_child_execution_timeout_ms=0,
    x=>x.backends[10].guest_child_stdout_limit_bytes=1048576,
    x=>x.backends[10].compiled_guest_from_approved_rust_compiler='PASSED',
    x=>x.backends[10].independent_compiler_certification=true,
  ]){
    const altered=clone(contract);mutate(altered);
    assert.throws(()=>assertSourceAudit(altered));
  }
});
