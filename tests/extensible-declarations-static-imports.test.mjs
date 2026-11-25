import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const corpus = JSON.parse(await readFile(new URL(
  "../fixtures/extensible-declarations/v1/static-import-candidates.json", import.meta.url), "utf8"));
test("static declaration imports remain target-only with explicit provenance", () => {
  assert.equal(corpus.status, "TARGET_ONLY_IMPORT_RESOLUTION_NOT_EXECUTED");
  assert.equal(corpus.entry, "main.atto");
  assert.equal(corpus.cases.length, 7);
  assert.equal(new Set(corpus.cases.map(c => c.id)).size, 7);
  assert.ok(corpus.invariants.includes("canonical_provider_symbol_identity"));
  assert.ok(corpus.invariants.includes("no_residual_kind_nodes_in_executable_ir"));
  for (const c of corpus.cases) {
    assert.equal(typeof c.units[corpus.entry], "string");
    for (const path of Object.keys(c.units)) assert.match(path, /^[a-z]+\.atto$/);
    if (c.target === "ACCEPT") {
      assert.equal(c.native_exit, 42);
      assert.equal(c.reason, undefined);
    } else {
      assert.equal(c.target, "REJECT");
      assert.match(c.reason, /^[A-Z_]+$/);
      assert.equal(c.native_exit, undefined);
    }
  }
});
