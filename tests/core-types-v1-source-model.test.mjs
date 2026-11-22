// SOURCE-ONLY oracle and manifest integrity test. DOES NOT compile Atto guest.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync(new URL("../contracts/core-types-v1.json", import.meta.url), "utf8"));
assert.equal(manifest.schema, "atto-core-types-v1");
assert.equal(manifest.contract.int_signed_bits, 64);
assert.equal(manifest.namespace_header,"use namespace types;");
assert.equal(manifest.module_wrapper,false);
assert.equal(manifest.backend_specific_guests.llvm.import_style,"static_named_fnc");
assert.equal(manifest.backend_specific_guests.llvm.guest_status,"NOT_EXECUTED");
assert.equal(manifest.evidence.llvm_function_only_namespace_import.unverified_package_namespace_imports,"DENIED");
assert.equal(manifest.public_declaration_form,"file-scoped namespace, top-level pub fnc");
assert.deepEqual(manifest.sources.map(x=>x.backend), ["java","llvm","net","wasm","rs","forge","cranelift","js","hdl"]);
assert.equal(new Set(manifest.sources.map(x=>x.repository)).size, 9);
for (const b of manifest.sources) {
  assert.match(b.head_sha, /^[a-f0-9]{40}$/);
  assert.match(b.source_blob_sha, /^[a-f0-9]{40}$/);
  assert.match(b.fixture_positive_blob_sha, /^[a-f0-9]{40}$/);
  assert.match(b.fixture_negative_blob_sha, /^[a-f0-9]{40}$/);
  assert.equal(b.guest_status, "NOT_EXECUTED");
  assert.equal(b.negative_status, "NOT_EXECUTED");
  assert.equal(b.aot_status, "NOT_EXECUTED");
  assert.equal(b.namespace_guest_status, "NOT_EXECUTED");
}
assert.equal(manifest.evidence.claim_tier, "SOURCE_ONLY_NO_GUEST_EXECUTION");
assert.equal(manifest.matrix_positive_guest.assertionCount,63);
assert.equal(manifest.matrix_positive_guest.expected_exit,0);
assert.equal(manifest.matrix_positive_guest.compiledGuestStatus,"NOT_EXECUTED");
assert.match(manifest.matrix_positive_guest.sourceGitBlobSha,/^[0-9a-f]{40}$/);
assert.match(manifest.matrix_positive_guest.sourceOnlyOracleGitBlobSha,/^[0-9a-f]{40}$/);
assert.equal(manifest.evidence.source_export_authorization,"DENIED_UNAPPROVED");
assert.equal(manifest.evidence.mirrored_to_other_org,false);
for (const b of manifest.sources) {
  const backend = manifest.backend_specific_guests?.[b.backend];
  assert.equal(b.fixture_matrix_blob_sha,backend?.matrix_blob_sha ?? manifest.matrix_positive_guest.sourceGitBlobSha);
  assert.equal(b.matrix_oracle_test_blob_sha,backend?.matrix_oracle_blob_sha ?? manifest.matrix_positive_guest.sourceOnlyOracleGitBlobSha);
  if(backend){
    assert.equal(b.fixture_positive_blob_sha,backend.positive_blob_sha);
    assert.equal(b.source_oracle_test_blob_sha,backend.source_oracle_blob_sha);
    assert.equal(backend.guest_status,"NOT_EXECUTED");
  }
  assert.equal(b.matrix_guest_status,"NOT_EXECUTED");
}
for (const probe of manifest.evidence.source_free_carrier_probes) {
  assert.equal(probe.source_exported,false);
  assert.match(probe.head,/^[0-9a-f]{40}$/);
  if(probe.status==="NOT_EXECUTED") assert.equal(probe.runner_steps,0);
  else {
    assert.equal(probe.status,"PASS_SOURCE_FREE_ONLY");
    assert.ok(probe.runner_steps>0);
  }
}
assert.equal(manifest.evidence.available_stepful_private_carrier.run_id,45049791824);
assert.equal(manifest.evidence.available_stepful_private_carrier.runner_steps,4);
assert.equal(manifest.evidence.available_stepful_private_carrier.source_transfer_status,"DENIED_UNAPPROVED");
assert.equal(manifest.evidence.rust_namespace_import_linker.cargo_test_status,"NOT_EXECUTED");
assert.equal(manifest.evidence.rust_namespace_import_linker.integration_test_count,9);
assert.match(manifest.evidence.rust_namespace_import_linker.source_blob_sha,/^[0-9a-f]{40}$/);
assert.match(manifest.evidence.rust_namespace_import_linker.test_blob_sha,/^[0-9a-f]{40}$/);
assert.equal(manifest.evidence.rust_namespace_import_linker.original_input_order_checked,true);
assert.equal(manifest.evidence.rust_namespace_import_linker.root_namespace_hoisted_before_synthetic_modules,true);
assert.equal(manifest.evidence.llvm_function_only_namespace_import.namespace_header_must_precede_imports,true);
assert.equal(manifest.evidence.llvm_function_only_namespace_import.duplicate_code,"NAMESPACE_DUPLICATE");
assert.equal(manifest.evidence.llvm_function_only_namespace_import.late_code,"NAMESPACE_HEADER_ORDER");
assert.equal(manifest.evidence.namespace_hardening_source_review.total_checks_passed,15);
assert.equal(manifest.evidence.namespace_hardening_source_review.kind,"STATIC_SOURCE_INSPECTION_ONLY");
assert.equal(manifest.evidence.namespace_hardening_source_review.compilers_executed,0);
const negatives = manifest.negative_guests;
assert.equal(negatives.length, 8);
assert.deepEqual(negatives.map(x => x.file), [
  "void-value-negative.atto", "void-return-negative.atto",
  "bool-truthiness-negative.atto", "i64-literal-overflow-negative.atto",
  "wrong-arg-negative.atto", "u64-outside-int-negative.atto",
  "namespace-duplicate-negative.atto", "namespace-late-negative.atto"
]);
assert.equal(new Set(negatives.map(x => x.file)).size, negatives.length);
for (const item of negatives) {
  assert.match(item.blob_sha, /^[a-f0-9]{40}$/);
  assert.equal(item.expect, "compile_reject_no_artifact");
  assert.equal(item.guest_status, "NOT_EXECUTED");
}
for (const source of manifest.sources) {
  const backend = manifest.backend_specific_guests?.[source.backend];
  assert.equal(source.fixture_positive_blob_sha, backend?.positive_blob_sha ?? "9d4027de080b8d625ab869825c4ec62f369adce8");
  assert.match(source.source_oracle_test_blob_sha, /^[a-f0-9]{40}$/);
  assert.deepEqual(source.negative_fixture_blobs,
    Object.fromEntries(negatives.map(x=>[x.file,backend?.negative_fixture_blobs?.[x.file] ?? x.blob_sha])),
    "each backend must pin the exact native negative fixture Git blobs");
}

const INT_MIN = -(1n << 63n), INT_MAX = (1n << 63n) - 1n;
const limits = manifest.contract.endpoints;
let vectorCount = 0;
for (const [kind, [loText, hiText]] of Object.entries(limits)) {
  const lo=BigInt(loText),hi=BigInt(hiText);
  assert(lo<=hi);
  assert(lo>=INT_MIN&&hi<=INT_MAX);
  for(const x of [INT_MIN,-4294967296n,-2147483649n,-32769n,-129n,-1n,0n,1n,127n,128n,255n,256n,32767n,32768n,65535n,65536n,2147483647n,2147483648n,4294967295n,4294967296n,INT_MAX]){
    const expected = (x>=lo&&x<=hi);
    const model = kind==="i64" ? true : kind==="u64_signed_input" ? x>=0n : x>=lo&&x<=hi;
    assert.equal(model, expected, kind+" on "+x);
    vectorCount++;
  }
}
assert.equal(vectorCount, 8*21);
console.log("SOURCE_ONLY_MODEL_PASS: "+vectorCount+" BigInt vectors, 9 backend source references. Guest parity NOT_EXECUTED.");
