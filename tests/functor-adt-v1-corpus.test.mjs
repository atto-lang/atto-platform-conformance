import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Source-free contract admission. Does NOT execute an AttoLang compiler or guest.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(readFileSync(path.join(root, "contracts/functor-adt-v1.json"), "utf8"));

test("functor ADT corpus never claims five-backend parity", () => {
  assert.equal(registry.contract_id, "functor-adt-v1");
  assert.equal(registry.schema_version, 1);
  assert.equal(registry.status, "PARTIAL_JAVA_GUEST_ONLY_NOT_FIVE_BACKEND_PARITY");
  assert.deepEqual(registry.target_backends, ["java", "llvm", "wasm", "forge", "net", "cranelift"]);
  assert.equal(registry.evidence.java.tier, "EXACT_BLOB_SUBSET_GUEST_EXECUTED");
  assert.equal(registry.evidence.java.junit_tests, 2);
  assert.equal(registry.evidence.java.positive_assertions, 16);
  assert.equal(registry.evidence.java.negative_fixtures, 10);
  assert.equal(registry.evidence.other_backends, "NOT_EXECUTED");
});

test("each of 11 .atto fixtures has exact immutable Git blob content", () => {
  assert.equal(registry.cases.length, 11);
  const ids = new Set();
  for (const c of registry.cases) {
    assert.ok(!ids.has(c.id), "duplicate case "+c.id);
    ids.add(c.id);
    assert.match(c.path, /^fixtures\/functor-adt-v1\/[a-z0-9-]+\.atto$/);
    const blob = readFileSync(path.join(root, c.path));
    const git = createHash("sha1")
      .update(Buffer.from("blob " + blob.length + "\0")).update(blob).digest("hex");
    assert.equal(git, c.blob_sha, "mismatched fixture: " + c.path);
    assert.equal(c.backends.java, "GUEST_EXECUTED_EXACT_BLOB_SUBSET");
    for (const b of ["llvm","wasm","forge","net","cranelift"]) assert.equal(c.backends[b], "PENDING");
    assert.ok(blob.toString("utf8").endsWith("\n"));
    if (c.kind === "compile_and_execute") {
      assert.equal(c.expected_stdout, "FNV1:" + "1".repeat(16) + ":END");
      assert.equal(c.diagnostic_category, null);
    } else {
      assert.equal(c.expected_stdout, null);
      assert.ok(c.diagnostic_category);
      assert.equal(c.kind, "compile_reject");
    }
  }
  assert.equal(registry.cases.filter(c=>c.kind==="compile_and_execute").length, 1);
  assert.equal(registry.cases.filter(c=>c.kind==="compile_reject").length, 10);
});
