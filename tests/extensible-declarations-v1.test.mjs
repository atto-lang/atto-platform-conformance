import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const corpus = JSON.parse(await readFile(new URL(
  "../fixtures/extensible-declarations/v1/manifest.json", import.meta.url), "utf8"));

// Host fixture integrity only. These checks do not invoke any Atto compiler.
test("extensible declarations fixture provenance and coverage", () => {
  assert.equal(corpus.spec, "https://github.com/atto-lang/atto-spec/pull/230");
  assert.equal(corpus.status, "SOURCE_FIXTURE_CANDIDATES_NOT_COMPILER_EVIDENCE");
  assert.equal(corpus.cases.length, 19);
  assert.equal(new Set(corpus.cases.map(c => c.id)).size, 19);
  for (const c of corpus.cases) {
    assert.equal(typeof c.source, "string", c.id);
    assert.ok(c.source.includes("define "), c.id);
    assert.ok(["ACCEPT","REJECT","REVIEW_ORDINARY_NAME_RULES","REVIEW_SCOPE_GRAMMAR"].includes(c.target), c.id);
    assert.ok(["PARSE_EQUIVALENT","REJECT","UNSUPPORTED"].includes(c.java_phase1a), c.id);
    assert.equal(c.net_phase1a, "UNSUPPORTED", c.id);
    if (c.java_phase1a === "PARSE_EQUIVALENT") {
      assert.equal(c.target, "ACCEPT", c.id);
      assert.ok(c.baseline.includes("define class "), c.id);
    } else {
      assert.equal(c.baseline, undefined, c.id);
    }
  }
});

test("no target or parser expectation can be treated as native guest evidence", () => {
  assert.deepEqual(Object.keys(corpus.backend_execution).sort(),
    ["java","net","llvm","wasm","rs","forge","cranelift"].sort());
  for (const result of Object.values(corpus.backend_execution)) assert.equal(result, "NOT_EXECUTED");
});
