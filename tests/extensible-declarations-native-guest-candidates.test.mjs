import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const corpus = JSON.parse(await readFile(new URL(
  "../fixtures/extensible-declarations/v1/native-guest-candidates.json", import.meta.url), "utf8"));
test("native declaration candidate corpus is not executed evidence", () => {
  assert.equal(corpus.status, "TARGET_ONLY_NATIVE_GUEST_NOT_EXECUTED");
  assert.equal(corpus.contract.profile, "standalone_native_guest");
  assert.deepEqual(corpus.contract.forbidden_runtime_dependencies,
    ["source_parser","macro_expander","guest_interpreter","jit","runtime_reflection_required"]);
  assert.equal(corpus.cases.length, 5);
  assert.equal(new Set(corpus.cases.map(c => c.id)).size, 5);
  const positives = corpus.cases.filter(c => c.expected_exit !== undefined);
  assert.equal(positives.length, 2);
  for (const c of positives) {
    assert.equal(c.expected_exit, 42);
    assert.equal(c.expected_stdout, "");
    assert.match(c.source, /return c\.answer\(\);/);
  }
  assert.match(positives[0].source, /define entity Customer/);
  assert.match(positives[1].source, /define class Customer implements Entity/);
  const negatives = corpus.cases.filter(c => c.expected !== undefined);
  assert.equal(negatives.length, 3);
  for (const c of negatives) {
    assert.equal(c.expected, "SEMANTIC_INTERFACE_REJECT");
    assert.equal(c.artifact, "ABSENT");
    assert.match(c.source, /requires Entity;/);
  }
});
