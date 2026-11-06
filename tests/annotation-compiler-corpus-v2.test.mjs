import {test} from "node:test";
import {strict as assert} from "node:assert";
import {readFileSync} from "node:fs";
import {validateAnnotationCompilerCorpusV2 as validate} from "../src/annotation-compiler-corpus-v2.mjs";

const expected = JSON.parse(readFileSync(
  new URL("../contracts/annotations/annotation-compiler-corpus-v2.json", import.meta.url), "utf8"));
const clone = () => structuredClone(expected);
const reject = value => assert.throws(() => validate(value), /ANNOTATION_V2_CORPUS_INVALID/);

test("15 canonical same-source candidates do not assert compiler execution", () => {
  assert.deepEqual(validate(expected), {
    cases: 15, javaCandidatePass: 6, javaCandidateReject: 9, executedBackends: 0
  });
});
test("missing or duplicated target case is rejected", () => {
  const removed = clone();
  removed.cases.pop();
  reject(removed);
  const duplicate = clone();
  duplicate.cases[1] = duplicate.cases[0];
  reject(duplicate);
});
test("unreviewed targets or case intent cannot be substituted", () => {
  const bad = clone();
  bad.cases[0].target = "supervisor";
  reject(bad);
  const effect = clone();
  effect.cases[12].intent = "metadata";
  reject(effect);
});
test("cannot declare unsupported backend annotations implemented", () => {
  for (const backend of ["llvm", "net", "wasm", "forge"]) {
    const bad = clone();
    bad.cases[0].expected[backend] = "pass";
    reject(bad);
  }
});
test("cannot change negative cases into unearned Java passes", () => {
  const bad = clone();
  bad.cases.find(c => c.id === "actor_unauthorized").expected.java = "pass";
  reject(bad);
});
test("cannot smuggle fake CI or guest evidence", () => {
  const bad = clone();
  bad.evidence.java = "GUEST_PASS";
  reject(bad);
  const skipped = clone();
  skipped.status = "VERIFIED";
  reject(skipped);
});
test("must preserve ASCII LF-terminated complete program source", () => {
  const bad = clone();
  bad.cases[0].source = "@Doc(\"x\")\rdefine class Person as end\n";
  reject(bad);
  const noAt = clone();
  noAt.cases[0].source = "define class Person as end\n";
  reject(noAt);
});
test("no backend inventory or source extension drift", () => {
  const bad = clone();
  bad.backend_order.reverse();
  reject(bad);
  const badExtension = clone();
  badExtension.source_extensions = [".ores"];
  reject(badExtension);
});
