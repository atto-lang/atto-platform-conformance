import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateTaskCaptureRegionRegistry} from "../src/task-capture-region-proof-v1.mjs";

const source = readFileSync(
  new URL("../contracts/v2/task-capture-region-proof-v1.json", import.meta.url), "utf8");
const registry = JSON.parse(source);
const clone = () => structuredClone(registry);

test("three exact Java .atto blob locators remain candidate-only", () => {
  assert.ok(source.length > 3000 && source.length < 16000);
  assert.deepEqual(validateTaskCaptureRegionRegistry(registry), {
    contract: "task-capture-region-proof-v1",
    sourceCommit: "00a23d7ef8b9d95876643b98acf842cf5cbc72bc",
    caseCount: 3,
    executedBackends: 0
  });
  assert.deepEqual(registry.fixtures.map(c => c.expectation), [
    "compile-reject", "compile-accept", "compile-run"
  ]);
  for (const c of registry.fixtures) {
    assert.equal(c.path, `tests/fixtures/task-record-capture-v1/${c.id}.atto`);
    assert.match(c.gitBlob, /^[0-9a-f]{40}$/);
    assert.deepEqual(Object.values(c.backendEvidence), Array(5).fill("NOT_EXECUTED"));
  }
});

test("cannot relabel source-free metadata as executed guest or native AOT", () => {
  for (const [name,mutate] of [
    ["synthetic pass", doc => doc.fixtures[0].backendEvidence.java = "PASS"],
    ["zero step", doc => doc.promotionGates.zeroStepCountsAsEvidence = true],
    ["host-only AOT", doc => doc.promotionGates.hostOnlyCountsAsAOT = true],
    ["parser-only semantic", doc => doc.promotionGates.semanticDiagnosticNotParserOnly = false],
    ["fake diagnostic", doc => doc.fixtures[0].expectedSemanticDiagnostic = "parser failed"],
    ["missing source pin", doc => doc.fixtures[1].gitBlob = "0".repeat(40)],
    ["stale source head", doc => doc.fixtures[0].sourceCommit = "f".repeat(40)],
    ["thread authorization", doc => doc.runtimeValidationFields.push("os_thread_id")],
    ["duplicate case", doc => doc.fixtures[1].id = doc.fixtures[0].id],
    ["missing physical retirement", doc => doc.runtimeValidationFields =
      doc.runtimeValidationFields.filter(x => x !== "retirement_state")],
    ["artifact without compiler proof", doc => doc.promotionGates.compilerOwnedProvenance = false]
  ]) {
    const attempt = clone();
    mutate(attempt);
    assert.throws(() => validateTaskCaptureRegionRegistry(attempt),
      /TASK_CAPTURE_REGION_V1_INVALID/, name);
  }
});

test("private source stays only at exact-blob locators", () => {
  for (const entry of registry.fixtures) {
    assert.equal(entry.repository, "ores-truffle-oreslang/oreslang-source.java");
    assert.ok(!("sourceText" in entry));
    assert.ok(!("privateSource" in entry));
  }
  assert.equal(registry.status, "CANDIDATE_NOT_ATTESTED");
  assert.ok(registry.limitations.every(s => typeof s === "string" && s.length >= 25));
});
