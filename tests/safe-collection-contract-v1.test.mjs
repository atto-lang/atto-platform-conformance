import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.join(root, "contracts/v1/safe-collection-access-v1");
const manifest = JSON.parse(readFileSync(path.join(base, "contract.json"), "utf8"));

test("safe collection contract cannot accidentally advertise backend parity", () => {
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.status, "CANDIDATE_UNATTESTED");
  assert.equal(manifest.promotion.zero_step_ci_counts, false);
  assert.equal(manifest.promotion.parser_only_failure_counts, false);
  assert.equal(manifest.promotion.host_reference_tests_count_as_backend_parity, false);
  assert.equal(manifest.promotion.semantic_negative_diagnostic_required, true);
  assert.equal(manifest.promotion.executable_guest_source_required, true);
  assert.equal(manifest.backends.length, 7);
  assert.deepEqual(Object.keys(manifest.per_backend_evidence).sort(), [...manifest.backends].sort());
  assert.ok(Object.values(manifest.per_backend_evidence).every(s => s === "NOT_EXECUTED"));
});

test("all cases have candidate source, distinct IDs and prescribed failure proof", () => {
  const ids = new Set();
  let positives = 0, negatives = 0;
  for (const item of manifest.cases) {
    assert.ok(!ids.has(item.id), "duplicate " + item.id);
    ids.add(item.id);
    assert.equal(item.attestation, "NOT_EXECUTED");
    assert.match(item.path, /^fixtures\/[a-z-]+\.atto$/);
    assert.ok(existsSync(path.join(base, item.path)), item.path);
    const src = readFileSync(path.join(base, item.path), "utf8");
    assert.ok(src.includes("fnc "), item.path);
    assert.ok(src.endsWith("\n"));
    if (item.expect === "compile_reject") {
      negatives++;
      assert.match(item.diagnostic, /^E_[A-Z_]+$/);
      assert.ok(src.includes("expect-error: " + item.diagnostic));
      assert.ok(src.includes("semantic, not parser rejection"));
      assert.equal(item.result, undefined);
    } else {
      positives++;
      assert.equal(item.expect, "compile_and_execute");
      assert.equal(item.result, "42");
      assert.equal(item.diagnostic, undefined);
      assert.ok(!src.includes("expect-error:"));
    }
  }
  assert.equal(positives, 8);
  assert.equal(negatives, 10);
  for (const id of ["borrowed-get-option", "read-then-write-after-last-use", "miss-under-live-write",
    "nested-some-none-option", "high-bit-checked-get-copy",
    "use-after-take-collection", "iterator-growth-conflict", "checked-copy-owned-option-int"]) {
    assert.ok(ids.has(id), "missing safety fixture: " + id);
  }
});

test("collection contract preserves ownership + no-implicit-flattening constraints", () => {
  for (const key of ["read","write","copy","owned_remove","range","mutation","escape",
    "move","sharing","suspension","option","layout","iterator"]) {
    assert.ok(manifest.rules[key]?.length > 30, key);
  }
  assert.ok(manifest.rules.option.includes("Option<Option<T>>"));
  assert.ok(manifest.rules.layout.includes("epoch"));
  assert.ok(manifest.rules.read.includes("precede bounds misses"));
  assert.ok(manifest.rules.write.includes("miss cannot bypass"));
  assert.ok(manifest.scopes.includes("Map"));
  assert.ok(manifest.scopes.includes("Set"));
});
