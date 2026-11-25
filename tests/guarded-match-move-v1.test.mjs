import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const file = new URL("../contracts/v2/guarded-match-move-v1.json", import.meta.url);
const manifest = JSON.parse(readFileSync(file, "utf8"));
const targets = ["java", "llvm", "wasm", "forge", "net"];
const head = "56a5ca3a67b13388e4b7e441f10743005e8340b2";
const expected = [
  ["reject-statement-guard-move", "13b6a8cca706241c3bd56b456f0828ab0253d61b", "compile-reject"],
  ["reject-value-guard-move", "693e0bcf6d9fd4d54d9f9c92175e1bf09716d648", "compile-reject"],
  ["accept-borrowed-match-guard", "55524f255e1adbf8f3435986f3446ae896ab7013", "compile-and-run"],
];

function verify(manifest) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.contract, "guarded-match-move-v1");
  assert.equal(manifest.status, "CANDIDATE_NOT_ATTESTED");
  assert.equal(manifest.sourceRepository, "ores-truffle-oreslang/oreslang-source.java");
  assert.equal(manifest.sourceCommit, head);
  assert.equal(manifest.sourcePr,
    "https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2691");
  assert.equal(manifest.sourceForm, ".atto");
  assert.deepEqual(manifest.backendTargets, targets);
  assert.equal(manifest.cases.length, expected.length);
  const seen = new Set();
  for (let i = 0; i < expected.length; i++) {
    const c = manifest.cases[i];
    const [id, blob, expectation] = expected[i];
    assert.ok(!seen.has(id), "duplicate source fixture ID");
    seen.add(id);
    assert.equal(c.id, id);
    assert.equal(c.gitBlob, blob);
    assert.equal(c.path, "tests/fixtures/ownership-match-guard-v1/" + id + ".atto");
    assert.equal(c.expectation, expectation);
    assert.deepEqual(Object.keys(c.backendEvidence).sort(), [...targets].sort());
    for (const backend of targets) {
      assert.equal(c.backendEvidence[backend], "NOT_EXECUTED",
        "a source-free registry cannot attest compiler or guest execution");
    }
    assert.ok(!("sourceText" in c) && !("privateSource" in c),
      "do not mirror private source into the shared registry");
    if (expectation === "compile-reject") {
      assert.equal(c.parserMustAccept, true);
      assert.equal(c.rejectBeforeCodegen, true);
      assert.equal(c.expectedDiagnostic, "moved");
      assert.equal(c.expectedStdout, undefined);
    } else {
      assert.equal(c.expectedStdout, "7");
      assert.equal(c.expectedDiagnostic, undefined);
    }
  }
  const gate = manifest.mergeGate;
  for (const key of [
    "exactSourceHeadAndGitBlob", "actualSemanticCompilerExecution",
    "parserOnlyDoesNotPass", "negativeNoEmittedExecutable",
    "positiveGuestExecution", "startedJobStepsNonzero", "independentReview",
  ]) assert.equal(gate[key], true, "required gate: " + key);
  for (const key of ["zeroStepCountsAsEvidence", "hostModelCountsAsBackend"]) {
    assert.equal(gate[key], false, "unearned evidence: " + key);
  }
  assert.equal(manifest.existingEvidence.java.workflowRunId, 42513889322);
  assert.equal(manifest.existingEvidence.java.jobId, 128832575212);
  assert.equal(manifest.existingEvidence.java.runnerId, 0);
  assert.equal(manifest.existingEvidence.java.executedSteps, 0);
  assert.equal(manifest.existingEvidence.java.status, "NOT_EXECUTED");
  for (const backend of targets.filter(x => x !== "java")) {
    assert.equal(manifest.existingEvidence[backend], "NOT_EXECUTED");
  }
  assert.ok(manifest.limitations.length >= 3);
}

test("exact-blob guarded match cases are source-free and unattested", () => {
  assert.doesNotThrow(() => verify(manifest));
});

test("adversarial source, provenance, and evidence mutations fail closed", () => {
  const attacks = [
    ["misrepresented test pass", x => x.cases[0].backendEvidence.java = "PASS"],
    ["stale source SHA", x => x.sourceCommit = "f".repeat(40)],
    ["source blob swapped", x => x.cases[0].gitBlob = "0".repeat(40)],
    ["parser-only fake rejection", x => x.cases[0].parserMustAccept = false],
    ["no-codegen requirement bypass", x => x.cases[0].rejectBeforeCodegen = false],
    ["zero-step admitted", x => x.mergeGate.zeroStepCountsAsEvidence = true],
    ["runner record forged", x => x.existingEvidence.java.runnerId = 42],
    ["positive outcome altered", x => x.cases[2].expectedStdout = "42"],
    ["private source included", x => x.cases[1].sourceText = "private code"],
    ["missing backend", x => delete x.cases[0].backendEvidence.net],
  ];
  for (const [name, mutate] of attacks) {
    const trial = structuredClone(manifest);
    mutate(trial);
    assert.throws(() => verify(trial), undefined, name);
  }
});
