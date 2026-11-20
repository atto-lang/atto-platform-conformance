import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessInjectedStateReceipt, sourceSha256 } from "../tools/state-injection-evidence-v1.mjs";

const registry = JSON.parse(readFileSync(
  new URL("../contracts/state_injection/candidate-v1.json", import.meta.url), "utf8"
));

function syntheticReceipt() {
  return {
    backend: "java", compilerCommit: "a".repeat(40), runId: 1,
    status: "completed", conclusion: "success",
    buildSteps: 1, compileSteps: 1, guestRunSteps: 1,
    cases: registry.cases.map(c => ({
      id: c.id, kind: c.kind, sourceSha256: sourceSha256(c.source),
      ...(c.kind === "compile-and-run" ? {
        compileExitCode: 0, runExitCode: c.expected.exitCode,
        stdout: c.expected.stdout, guestExecuted: true
      } : {
        compileExitCode: 1, diagnosticClass: c.violation,
        rejectionPhase: "semantic", emittedArtifacts: 0, guestExecuted: false
      })
    }))
  };
}

test("five requested backends and Forge are registered, never silently passed", () => {
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.status, "proposed-not-executable-parity");
  assert.deepEqual(registry.requiredBackends,
    ["java", "llvm", "wasm", "cranelift", "net"]);
  assert.deepEqual(registry.optionalBackends, ["forge"]);
  assert.deepEqual(Object.keys(registry.backendEvidence).sort(),
    ["java", "llvm", "wasm", "cranelift", "net", "forge"].sort());
  for (const value of Object.values(registry.backendEvidence)) {
    assert.deepEqual(value, {
      status: "not-executed", compilerCommit: null, runnerRunId: null
    });
  }
});

test("candidate cases have distinct source programs and paired success/denial controls", () => {
  const ids = registry.cases.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(registry.cases.length, 16);
  assert.equal(registry.cases.filter(c => c.kind === "compile-and-run").length, 2);
  assert.equal(registry.cases.filter(c => c.kind === "compile-reject").length, 14);
  const obligations = new Set();
  for (const c of registry.cases) {
    assert.ok(c.source && c.source.endsWith("\n"), c.id);
    assert.match(c.source, /@(Inject|StateBacked)/);
    if (c.kind === "compile-and-run") {
      assert.equal(c.expected.exitCode, 0);
      assert.ok(typeof c.expected.stdout === "string");
      c.obligations.forEach(o => obligations.add(o));
    } else {
      assert.ok(c.violation && c.violation.includes("-"), c.id);
    }
  }
  for (const claim of ["instance-isolation", "typed-provider-injection",
    "atomic-write-scope", "immutable-container-handle"]) {
    assert.ok(obligations.has(claim));
  }
});

test("source fingerprints refer to exact UTF-8 bytes, not normalized source", () => {
  const original = registry.cases[0].source;
  assert.match(sourceSha256(original), /^[0-9a-f]{64}$/);
  assert.notEqual(sourceSha256(original), sourceSha256(original.replaceAll("\n", "\r\n")));
  assert.notEqual(sourceSha256(original), sourceSha256(original + " "));
});

test("a synthetic well-shaped receipt is NEVER claimed as actual backend verification", () => {
  const assessed = assessInjectedStateReceipt(registry, "java", syntheticReceipt());
  assert.equal(assessed.structurallyEligible, true);
  assert.equal(assessed.classification, "receipt-shape-only-not-verified-parity");
  assert.deepEqual(assessed.failures, []);
  assert.equal(registry.backendEvidence.java.status, "not-executed");
});

test("blanket parser rejection cannot masquerade as valid negative-only safety", () => {
  const fake = syntheticReceipt();
  for (const c of fake.cases) {
    c.compileExitCode = 1;
    c.unsupported = true;
    c.rejectionPhase = "parse";
  }
  const assessed = assessInjectedStateReceipt(registry, "java", fake);
  assert.equal(assessed.structurallyEligible, false);
  assert.ok(assessed.failures.some(f => f.includes("positive guest")));
  assert.ok(assessed.failures.some(f => f.includes("negative compiler-owned")));
});

test("wrong sources, fake zero-step execution, stale compiler heads and cross-backend labels fail", () => {
  for (const edit of [
    r => { r.compilerCommit = "main"; },
    r => { r.buildSteps = 0; },
    r => { r.compileSteps = 0; },
    r => { r.guestRunSteps = 0; },
    r => { r.runId = 0; },
    r => { r.backend = "llvm"; },
    r => { r.cases[0].sourceSha256 = sourceSha256("different"); },
    r => { r.cases[0].stdout += "ignored logs"; },
    r => { r.cases[0].runExitCode = null; },
    r => { r.cases[1].unsupported = true; },
    r => { r.cases.at(-1).diagnosticClass = "generic parse error"; },
    r => { r.cases.at(-1).unsupported = true; },
    r => { r.cases.at(-1).compileExitCode = -1; },
    r => { r.cases.at(-1).rejectionPhase = "parse"; },
    r => { r.cases.at(-1).emittedArtifacts = 1; },
    r => { r.cases.at(-1).guestExecuted = true; }
  ]) {
    const fake = syntheticReceipt();
    edit(fake);
    const decision = assessInjectedStateReceipt(registry, "java", fake);
    // Unspecified metadata must not be confused with an authenticated CI run.
    // Some modifications (e.g., a positive "unsupported" flag) are separately
    // checked by the strict invocation field validation above.
    assert.equal(decision.structurallyEligible, false, JSON.stringify(fake));
    assert.ok(decision.failures.length >= 1);
  }
});

test("receipt must explicitly prove a completed compiler-backed guest observation, never a pending/synthetic claim", () => {
  const edits = [
    r => { delete r.status; },
    r => { r.status = "pending"; },
    r => { r.status = "skipped"; },
    r => { r.conclusion = "neutral"; },
    r => { r.synthetic = true; },
    r => { r.sourceFree = true; },
    r => { r.parserOnly = true; },
    r => { r.unsupported = true; },
    r => { delete r.cases[0].guestExecuted; },
    r => { r.cases[0].guestExecuted = false; },
    r => { r.cases[0].rejectionPhase = "semantic"; },
    r => { r.cases[0].synthetic = true; },
    r => { r.cases[0].sourceFree = true; },
    r => { delete r.cases.at(-1).guestExecuted; },
    r => { r.cases.at(-1).guestExecuted = null; },
    r => { r.cases.at(-1).runExitCode = 0; },
    r => { r.cases.at(-1).stdout = ""; }
  ];
  for (const edit of edits) {
    const fake = syntheticReceipt();
    edit(fake);
    const result = assessInjectedStateReceipt(registry, "java", fake);
    assert.equal(result.structurallyEligible, false, JSON.stringify(fake));
    assert.ok(result.failures.length > 0);
    assert.equal(result.classification, "receipt-shape-only-not-verified-parity");
  }
  assert.equal(assessInjectedStateReceipt(registry, "java", []).structurallyEligible, false);
});

test("missing, duplicate and unexpected cases are rejected", () => {
  for (const edit of [
    r => { r.cases.pop(); },
    r => { r.cases.push({...r.cases[0]}); },
    r => { r.cases[0].id = "unknown-case"; },
    r => { r.cases = null; }
  ]) {
    const fake = syntheticReceipt();
    edit(fake);
    assert.equal(assessInjectedStateReceipt(registry, "java", fake).structurallyEligible, false);
  }
  assert.equal(assessInjectedStateReceipt(registry, "unknown", syntheticReceipt()).structurallyEligible, false);
  assert.equal(assessInjectedStateReceipt(registry, "java", null).structurallyEligible, false);
});
