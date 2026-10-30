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
  assert.equal(spec.local_source_adapter.source_negative_expected_diagnostic_cases_passed, 11);
  assert.equal(spec.local_source_adapter.full_oreslang_llvmc_executed, false);
  assert.deepEqual(Object.keys(spec.claimed_backend_guest_results).sort(),
    ["java", "llvm", "wasm", "net", "forge"].sort());
  for (const state of Object.values(spec.claimed_backend_guest_results))
    assert.equal(state, "NOT_EXECUTED");
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
