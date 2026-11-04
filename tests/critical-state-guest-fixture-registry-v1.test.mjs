import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const registry = JSON.parse(readFileSync(
  new URL("../contracts/state_regions/critical-state-guest-fixtures-v1.json", import.meta.url),
  "utf8",
));
const backends = ["java", "llvm", "wasm", "cranelift", "net", "forge"];
const sha40 = /^[0-9a-f]{40}$/;
const sourceRepo = "ores-truffle-oreslang/oreslang-source.java";

test("nine exact-blob Oreslang source fixture locators are unique and pinned", () => {
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.fixtures.length, 9);
  const seen = new Set();
  const hashes = new Set();
  let accepted = 0;
  let rejected = 0;
  for (const fixture of registry.fixtures) {
    assert.match(fixture.id, /^[a-z_]+$/);
    assert.equal(fixture.repository, sourceRepo);
    assert.match(fixture.commit, sha40);
    assert.match(fixture.gitBlob, sha40);
    assert.equal(fixture.path,
      "src/test/resources/parity/actor-critical-modes/" + fixture.id + ".ores");
    assert.ok(!seen.has(fixture.id), "duplicate fixture id");
    assert.ok(!hashes.has(fixture.gitBlob), "unexpected shared file blob");
    seen.add(fixture.id);
    hashes.add(fixture.gitBlob);
    if (fixture.expected === "compile-and-run") {
      accepted++;
      assert.equal(fixture.expectedStdout, "critical-modes-ok");
      assert.equal(fixture.expectedDiagnostic, undefined);
    } else {
      rejected++;
      assert.equal(fixture.expected, "compile-reject");
      assert.ok(fixture.expectedDiagnostic.length >= 6);
      assert.equal(fixture.expectedStdout, undefined);
    }
    assert.deepEqual(Object.keys(fixture.backendEvidence).sort(), [...backends].sort());
    for (const backend of backends) {
      assert.equal(fixture.backendEvidence[backend], "not-executed",
        "unverified backend must never be marked PASS by source registry alone");
    }
  }
  assert.equal(accepted, 1);
  assert.equal(rejected, 8);
});

test("canonical borrow/await/escape negatives are all represented", () => {
  const names = new Set(registry.fixtures.map(f => f.id));
  for (const id of [
    "reject_read_mutation", "reject_read_mutable_reborrow",
    "reject_await_in_read", "reject_await_in_write", "reject_state_escape",
    "reject_direct_state_access", "reject_string_forged_write_mode",
    "reject_unknown_mode",
  ]) assert.ok(names.has(id), id + " missing");
  assert.match(registry.description, /no private source/i);
});
