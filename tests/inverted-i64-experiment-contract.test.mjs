import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";

const file = new URL("../contracts/experiments/inverted-i64/manifest.json", import.meta.url);
const spec = JSON.parse(readFileSync(file, "utf8"));
const root = new URL("../fixtures/inverted-layout/experimental-i64/", import.meta.url);
const shas = Object.freeze({
  "positive-column-get.ores": "a17849d07ac3974923e8dd575348d3452f9a51b0",
  "positive-column-bounded.ores": "b30cd7ee3a72d8c7dcf7d8a862684a36c5f2ee0b",
  "negative-out-of-bounds.ores": "4adbae1b55a02756d1f0a2eb2fc24f21aa19f12f"
});

test("experimental i64 guest status cannot be represented as verified backend parity", () => {
  assert.equal(spec.version, 0);
  assert.equal(spec.scope, "LLVM_EXPLICIT_OPT_IN_SOURCE_TO_IR_NOT_PRODUCTION_OR_PARITY");
  assert.equal(spec.evidence,
    "LOCAL_EXACT_HEADER_AND_GUEST_FIXTURES_EXECUTED_FULL_COMPILER_NOT_EXECUTED");
  assert.equal(spec.local_source_adapter.compiled_header_blob_sha,
    "43fb26ec69974d8148b9d4142d738f17bbbefa14");
  assert.deepEqual(spec.local_source_adapter.positive_native_exit_codes, [42, 42]);
  assert.equal(spec.local_source_adapter.out_of_bounds_native_exit, 132);
  assert.equal(spec.local_source_adapter.source_negative_expected_diagnostic_cases_passed, 18);
  assert.equal(spec.local_source_adapter.clang_asan_ubsan_native_ir_guests_passed, 2);
  assert.equal(spec.local_source_adapter.full_oreslang_llvmc_executed, false);
  assert.equal(spec.current_branch_typed_mir.mir_blob_sha,
    "a62b423273910dd79165b5c90e0e2d245a35319b");
  assert.equal(spec.current_branch_typed_mir.native_adapter_blob_sha,
    "f96e30877caba43b98e24d238a6a9a1766170e92");
  assert.equal(spec.current_branch_typed_mir.native_test_blob_sha,
    "a92c2e1a260ea603f0dea004371c9298ecedafc1");
  assert.equal(spec.current_branch_typed_mir.compiler_cpp17_test_blob_sha,
    "529a188e306c6d62062763e1313c9b30c5892bfe");
  for (const key of ["native_runtime_execution", "compiler_cpp17_execution",
                     "asan_ubsan_execution", "full_oreslang_llvmc_execution"])
    assert.equal(spec.current_branch_typed_mir[key], "NOT_EXECUTED");
  assert.equal(spec.current_branch_typed_mir.guest_source_to_verified_mir,
    "CODE_STAGED_NOT_EXECUTED");
  assert.equal(spec.current_branch_mir_llvm_codegen.emitter_blob_sha,
    "27c6ec16303b33749be973e9bdacbc1c0d874e5d");
  assert.equal(spec.current_branch_mir_llvm_codegen.source_adapter_blob_sha,
    "e6d5138595e764392f48c7e064fadeb84739370a");
  assert.equal(spec.current_branch_mir_llvm_codegen.guest_test_blob_sha,
    "9cc616cede6453f5f3a9f375df19f588562fbfc7");
  assert.equal(spec.current_branch_mir_llvm_codegen.native_test_driver_blob_sha,
    "102460fbd0675f7cc7d2737dd9c4f6045bd57aee");
  assert.equal(spec.current_branch_mir_llvm_codegen.native_test_script_blob_sha,
    "a510587ebb5915489af91a189b2181e1dc5bde1e");
  for (const key of ["exact_head_standalone_ctest", "full_compiler_ctest",
                     "current_emitter_native_execution", "current_emitter_asan_ubsan"])
    assert.equal(spec.current_branch_mir_llvm_codegen[key], "NOT_EXECUTED");
  assert.equal(spec.current_branch_mir_llvm_codegen.source_to_mir_guest,
    "CODE_STAGED_NOT_EXECUTED");
  assert.equal(spec.current_production_schema_mir_preflight.header_blob_sha,
    "0dd7b78bec0863adf0ef35538ca16d1d8b056cad");
  assert.equal(spec.current_production_schema_mir_preflight.production_parser_blob_sha,
    "0ab878ccf4286c04babf56192148b156de1b472d");
  assert.equal(spec.current_production_schema_mir_preflight.standalone_cpp17_test_blob_sha,
    "65f40eb8b37f614eb65dcbd61b7f9d8a0bc76a09");
  assert.equal(spec.current_production_schema_mir_preflight.production_parser_ast_test_blob_sha,
    "d66ed5915bec93dc41ceca46473d422a5b896588");
  for (const key of ["exact_head_compiler_cpp17_execution",
                     "exact_head_parser_ast_execution",
                     "exact_head_gcc_clang_sanitizers"])
    assert.equal(spec.current_production_schema_mir_preflight[key], "NOT_EXECUTED");
  for (const key of ["source_operations_to_production_mir",
                     "runtime_generation_handles", "production_guest_codegen"])
    assert.equal(spec.current_production_schema_mir_preflight[key], "NOT_IMPLEMENTED");
  assert.equal(spec.current_branch_mir_llvm_codegen.production_inverted_lowering,
    "NOT_IMPLEMENTED");
  // Current source work has advanced beyond the older experimental and
  // schema-only snapshots. These hashes refer to a restricted PRODUCTION
  // code path, but no actual current-head native execution receipt exists.
  const production = spec.current_production_source_mir;
  assert.equal(production.production_source_mir_blob_sha,
    "3e13b44cd7127fdc5802128bbcdf4ac5276f5fa5");
  assert.equal(production.production_source_mir_ast_negative_test_blob_sha,
    "8715497b5bc519d2d450a12b27da272ff8ab39c7");
  assert.equal(production.production_parser_ast_negative_test_blob_sha,
    "981972662a4664df81d03fc4a8318128dc87fddc");
  assert.equal(production.native_parser_blob_sha,
    "d5f27ca6d1e6b60be9a7620525848f19f1237c1b");
  assert.equal(production.native_main_blob_sha,
    "82f22ce2e899d2d27a7ec21ff365efc6b241b640");
  assert.equal(production.native_guest_test_blob_sha,
    "560b7a1aae0225a61de1656a3780650bc6af518d");
  assert.equal(production.llvm_emitter_blob_sha,
    "27c6ec16303b33749be973e9bdacbc1c0d874e5d");
  assert.match(production.runtime_bounds_trap_gate, /SIGILL\/SIGTRAP/);
  assert.match(production.runner_admission, /zero-step/);
  assert.match(production.runner_admission, /Source transfer NOT_PERFORMED/);
  assert.deepEqual(production.declaration_rejection, [
    "sum type AST", "conforms AST", "type constraint descriptors AST"
  ]);
  for (const key of ["current_head_cpp17_source_test", "current_head_full_compiler",
                     "current_head_native_guest", "current_head_sanitizers"])
    assert.equal(production[key], "NOT_EXECUTED");

  assert.equal(spec.local_mir_llvm_i64_codegen.source_emitter_blob_sha,
    "1a4cc742a6d3bdc31c7e48eb8712d74ee8fa8196");
  assert.equal(spec.local_mir_llvm_i64_codegen.test_driver_blob_sha,
    "eb5cc1edd0f8986b86b6b4fcb56a58602e9b07a9");
  assert.equal(spec.local_mir_llvm_i64_codegen.clang_script_blob_sha,
    "6e54a1b07c181c1ec4250e30277d6e95e1886b0f");
  assert.equal(spec.local_mir_llvm_i64_codegen.exit_42_runs, 2);
  assert.equal(spec.local_mir_llvm_i64_codegen.runtime_bounds_trap_exit, 132);
  for (const key of ["real_repo_full_ctest", "full_exact_source_tree_runtime_proof",
                     "asan_ubsan"])
    assert.equal(spec.local_mir_llvm_i64_codegen[key], "NOT_EXECUTED");
  assert.equal(spec.local_mir_llvm_i64_codegen.production_oreslang_llvmc_codegen,
    "NOT_IMPLEMENTED");
  assert.equal(spec.current_branch_adapter.blob_sha,
    "e6d5138595e764392f48c7e064fadeb84739370a");
  assert.equal(spec.current_branch_adapter.typed_hir_blob_sha,
    "e04b19c37460a5b859d7ad2497583d296cb395b2");
  assert.equal(spec.current_branch_adapter.production_parser_blob_sha,
    "c0252d54142522de2cc259afa0e08ec9fce01990");
  for (const key of ["exact_current_head_compilation",
                     "exact_current_head_native_guest", "full_compiler_ctest"])
    assert.equal(spec.current_branch_adapter[key], "NOT_EXECUTED");
  assert.deepEqual(Object.keys(spec.claimed_backend_guest_results).sort(),
    ["java", "llvm", "wasm", "net", "forge"].sort());
  for (const state of Object.values(spec.claimed_backend_guest_results))
    assert.equal(state, "NOT_EXECUTED");
  // The LLVM integration draft now contains a newer host-only loan fix.
  // Keep its exact blobs pinned without converting source-free smoke results
  // into a checked-in CTest or backend guest execution claim.
  const loan = spec.current_native_handle_loan;
  assert.equal(loan.loan_hardening_commit_sha,
    "6206c678b29831aef57471e8d9700c9ac39f23c8");
  assert.equal(loan.loan_hardening_tree_sha,
    "ec2036b463ed000efa1a3ee4d25a6bf7cd8a746a");
  assert.equal(loan.native_header_blob_sha,
    "6c61ac557c0d7be0d2c894486833fbb28918d521");
  assert.equal(loan.native_test_blob_sha,
    "31d0149b7b09cc1211af35f4cb42c30a36bae4c5");
  assert.match(loan.scope, /host-only/);
  assert.match(loan.local_source_free_api_shape_smoke, /NOT the checked-in/);
  for (const key of ["exact_head_native_cpp20_ctest", "exact_head_native_asan_ubsan",
                     "exact_head_production_compiler_guest", "five_backend_guest_parity"])
    assert.equal(loan[key], "NOT_EXECUTED");
  // A host detached-row snapshot is a value. Restricted LLVM MIR previously
  // discarded this value; the emitter now fails closed instead of pretending
  // that snapshots have working guest lowering. Keep the positive contract.
  const snapshot = spec.current_guest_snapshot_lowering;
  assert.equal(snapshot.hardening_commit_sha,
    "415130d3748af471975f0172db36f54573605571");
  assert.equal(snapshot.llvm_emitter_blob_sha,
    "74c0201fc3861327ce131b992af08e73e2daec1f");
  assert.equal(snapshot.compiler17_test_blob_sha,
    "3ea406cdac5a9334235ef5709fe9802b3ef16b4d");
  assert.equal(snapshot.guest_mode_blob_sha,
    "e13781155981bf195a84c92b493398b366479dd7");
  assert.equal(snapshot.native_guest_script_blob_sha,
    "89ef857cd1f5c57abd98fc86437f72d6e9e45980");
  assert.equal(snapshot.detached_snapshot_value_guest_lowering, "NOT_IMPLEMENTED");
  // A compiler's fail-closed safeguard cannot weaken the required guest
  // value semantics in the shared v1 contract.
  const cases = JSON.parse(readFileSync(
    new URL("../contracts/v1/inverted-layout/cases.json", import.meta.url), "utf8"));
  const detached = cases.cases.find(c => c.id === "ownership/row-snapshot-detached");
  assert.ok(detached);
  assert.equal(detached.expected, "accept");
  assert.equal(detached.requires, "guest");
  for (const key of ["exact_head_cpp17_compiler_test", "exact_head_native_guest_test",
                     "exact_head_sanitizer_test", "source_contract_snapshot_positive"])
    assert.equal(snapshot[key], "NOT_EXECUTED");
  // New implementation is stacked on the older fail-closed evidence, not
  // a retroactive PASS for the detached-snapshot guest contract.
  const staged = spec.current_guest_snapshot_positive_staged;
  assert.equal(staged.implementation_pr,
    "https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1405");
  assert.equal(staged.source_head_sha,
    "f2723ddd702130afb92ad34cbdb5d605d5c8c21c");
  assert.equal(staged.stacked_on_sha,
    "039e6be4086e43271123cca84969fadbaf1f43a8");
  assert.equal(staged.source_blobs["src/main/cpp/oreslang/types/InvertedMirLlvmI64.hpp"],
    "0645d94a613dc1e53fd18520fb1ff80d099df99f");
  assert.equal(staged.source_blobs["src/main/cpp/oreslang/types/InvertedProductionSourceMir.hpp"],
    "6d171c1b6636152ab2a9c8876ab0148dbb8505bc");
  assert.equal(staged.fixture_blobs["positive-production-snapshot.atto"],
    "43b0d05043c4323beaa40b5ec7a31602a56a7f41");
  assert.equal(staged.fixture_blobs["negative-production-snapshot-bounds.atto"],
    "a8b974eae439bdd29e31456191eec3e7341da33a");
  assert.equal(Object.keys(staged.source_blobs).length, 7);
  assert.equal(Object.keys(staged.fixture_blobs).length, 4);
  assert.equal(Object.keys(staged.regression_blobs).length, 8);
  assert.equal(staged.code_status, "CODE_STAGED_NOT_EXECUTED");
  assert.equal(staged.source_free_static_blob_verification, "DONE");
  for (const key of ["exact_head_cpp17_cpp20_ctest",
                     "exact_head_default_compiler_native_guest",
                     "exact_head_o0_o2_guest", "exact_head_sanitizers",
                     "full_cross_backend_snapshot_contract"])
    assert.equal(staged[key], "NOT_EXECUTED");
  assert.equal(staged.source_org_runner_admission, "FAILED_BEFORE_STEPS");
  assert.equal(staged.private_source_mirror, "NOT_PERFORMED");
  assert.equal(spec.claimed_backend_guest_results.llvm, "NOT_EXECUTED");
  assert.equal(spec.implementation_pr,
    "https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1213");
  assert.deepEqual(spec.limits.operations, [
    "push positional i64 constants",
    "set checked index on let fields",
    "get checked index",
    "return get expression"
  ]);
});

test("the exact three source vectors have immutable Git blob hashes", () => {
  assert.deepEqual(spec.source_blob_shas, shas);
  assert.deepEqual(spec.vectors.map(v => v.fixture), Object.keys(shas));
  for (const [name, hash] of Object.entries(shas)) {
    const bytes = readFileSync(new URL(name, root));
    const gitBlob = createHash("sha1")
      .update(Buffer.from("blob " + bytes.length + "\0"))
      .update(bytes)
      .digest("hex");
    assert.equal(gitBlob, hash, name);
  }
  assert.deepEqual(spec.vectors.slice(0, 2).map(v => v.expected_native_exit_code), [42, 42]);
  assert.equal(spec.vectors[2].expected_runtime, "trap");
});

test("the source vectors use explicit inversion and never imply full nesting parity", () => {
  const a = readFileSync(new URL("positive-column-get.ores", root), "utf8");
  const b = readFileSync(new URL("positive-column-bounded.ores", root), "utf8");
  const c = readFileSync(new URL("negative-out-of-bounds.ores", root), "utf8");
  assert.match(a, /define inverted struct Position as/);
  assert.match(a, /let x: int;/);
  assert.match(a, /InvertedArray<Position>/);
  assert.match(b, /pub define inverted struct Sample as/);
  assert.match(b, /let measurement: int;/);
  assert.match(c, /return rows\.get\(1, measurement\)/);
  for (const source of [a, b, c]) {
    assert.doesNotMatch(source, /InvertedArray<.*<.*>>/);
    assert.match(source, /fnc main\(\): int/);
  }
});
