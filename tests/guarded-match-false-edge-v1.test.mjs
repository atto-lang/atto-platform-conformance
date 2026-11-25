import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateGuardedMatchManifest} from "../src/guarded-match-false-edge-v1.mjs";

const text = readFileSync(
  new URL("../contracts/v2/guarded-match-false-edge-v1.json", import.meta.url), "utf8");
const candidate = JSON.parse(text);
const clone = () => structuredClone(candidate);

test("three exactly pinned guarded-match .atto cases remain candidate only", () => {
  assert.ok(text.length > 1500 && text.length < 12000);
  const summary = validateGuardedMatchManifest(candidate);
  assert.deepEqual(summary, {
    sourceCommit: "56a5ca3a67b13388e4b7e441f10743005e8340b2",
    fixtures: 3,
    executedBackends: 0,
    status: "CANDIDATE_NOT_ATTESTED"
  });
  assert.deepEqual(candidate.fixtureProvenance.map(v => v.expected), [
    "semantic-reject", "semantic-reject", "compile-and-run"
  ]);
  for (const fixture of candidate.fixtureProvenance) {
    assert.match(fixture.gitBlobSha1, /^[0-9a-f]{40}$/);
    assert.equal(fixture.repository, "ores-truffle-oreslang/oreslang-source.java");
    assert.equal(fixture.commit, candidate.exactSourceCommit);
    assert.ok(!Object.hasOwn(fixture, "sourceText"), "do not replicate private Java source");
    assert.deepEqual(Object.values(fixture.backendEvidence),
      Array(5).fill("NOT_EXECUTED"));
  }
});

test("forged CI, changed fixtures and missing guards fail closed", () => {
  const attacks = [
    ["fake java PASS", m => { m.fixtureProvenance[0].backendEvidence.java = "PASS"; }],
    ["false runner proof", m => { m.promotion.zeroStepCountsAsEvidence = true; }],
    ["host falsely counts as guest", m => { m.promotion.hostOnlyCountsAsGuest = true; }],
    ["missing actual guest gate", m => { m.promotion.positiveGuestControlRequired = false; }],
    ["unverified semantic error", m => { m.fixtureProvenance[0].semanticDiagnostic = "syntax"; }],
    ["unsupported parser-only", m => { m.promotion.semanticRejectAfterParseRequired = false; }],
    ["stale registry source commit", m => { m.exactSourceCommit = "f".repeat(40); }],
    ["stale case source commit", m => { m.fixtureProvenance[0].commit = "f".repeat(40); }],
    ["changed source Git blob", m => { m.fixtureProvenance[1].gitBlobSha1 = "0".repeat(40); }],
    ["removed positive fixture", m => { m.fixtureProvenance.pop(); }],
    ["faked guest output", m => { m.fixtureProvenance[2].expectedStdout = "42"; }],
    ["private source replicated", m => { m.fixtureProvenance[0].privateSource = "copied"; }],
    ["wrong target", m => { m.backendTargets.push("cranelift"); }],
    ["unapproved reviewer bypass", m => { m.promotion.independentReviewRequired = false; }],
    ["duplicate identity", m => { m.fixtureProvenance[1].id = m.fixtureProvenance[0].id; }],
    ["flipped negative expectation", m => { m.fixtureProvenance[0].expected = "compile-and-run"; }],
    ["wrong private repo locator", m => { m.fixtureProvenance[2].repository = "other/repo"; }],
    ["missing pattern-failure rule", m => { delete m.requirements.patternSkip; }],
    ["unearned attestation", m => { m.fixtureProvenance[1].attestation = "certified"; }],
  ];
  for (const [id,change] of attacks) {
    const x = clone();
    change(x);
    assert.throws(() => validateGuardedMatchManifest(x),
      /GUARDED_MATCH_MANIFEST_INVALID/, id);
  }
});

test("metadata cannot serve as a completed test receipt", () => {
  assert.equal(candidate.status, "CANDIDATE_NOT_ATTESTED");
  assert.equal(candidate.promotion.executedCompilerAndGuestStepsRequired, true);
  assert.equal(candidate.promotion.noPrivateSourceReplication, true);
  assert.equal(candidate.promotion.metadataOnlyCountsAsProof, false);
  assert.deepEqual(candidate.backendTargets, ["java", "llvm", "wasm", "forge", "net"]);
});
