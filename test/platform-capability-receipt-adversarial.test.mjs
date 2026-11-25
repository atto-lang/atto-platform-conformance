import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyPlatformCapabilityReceipt } from "../bin/verify-platform-capability-receipt.mjs";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/platform-capabilities-v1.json", import.meta.url), "utf8"
));

const stages = [
  "host-reference", "abi-link", "compiler-guest", "target-execution", "physical-hardware"
];

function receipt(platform, stage) {
  return {
    schema: "oreslang.platform-capability/1",
    platform,
    repository: contract.platforms[platform].repository,
    sourceCommit: "a".repeat(40),
    stage,
    evidence: {
      exactHead: true,
      executedSteps: 8,
      workflowConclusion: "success",
      targetArtifactSha256: "b".repeat(64),
      abiLinked: true,
      hostReferenceOnly: false,
      compilerProduced: true,
      compilerSourceCommit: "c".repeat(40),
      compilerBinarySha256: "d".repeat(64),
      targetExecuted: true,
      physicalHardware: true
    }
  };
}

function denied(input, alteredContract = contract) {
  const result = verifyPlatformCapabilityReceipt(input, alteredContract);
  assert.equal(result.ok, false, "forged/invalid receipt passed schema admission");
  assert.ok(result.errors.length > 0, "rejection must have diagnostic reasons");
}

test("six registered platforms and all five stages have valid structural examples", () => {
  assert.equal(Object.keys(contract.platforms).length, 6);
  for (const platform of Object.keys(contract.platforms)) {
    for (const stage of stages) {
      const result = verifyPlatformCapabilityReceipt(receipt(platform, stage), contract);
      assert.equal(result.ok, true, platform + "/" + stage + ": " + result.errors.join("; "));
    }
  }
});

test("every platform/stage rejects absent steps and forged failed workflow outcomes", () => {
  const invalidSteps = [undefined, null, 0, -1, 1.2, NaN, Infinity, "8", [], {}, 2 ** 53];
  const invalidOutcomes = [undefined, null, "", "failure", "cancelled", "skipped", "neutral", "queued"];
  for (const platform of Object.keys(contract.platforms)) {
    for (const stage of stages) {
      for (const value of invalidSteps) {
        const mutant = receipt(platform, stage);
        mutant.evidence.executedSteps = value;
        denied(mutant);
      }
      for (const value of invalidOutcomes) {
        const mutant = receipt(platform, stage);
        mutant.evidence.workflowConclusion = value;
        denied(mutant);
      }
      const falseHead = receipt(platform, stage);
      falseHead.evidence.exactHead = false;
      denied(falseHead);
    }
  }
});

test("compilation, target execution and physical promotions cannot borrow lower-stage proof", () => {
  for (const platform of Object.keys(contract.platforms)) {
    for (const stage of ["abi-link", "compiler-guest", "target-execution", "physical-hardware"]) {
      const mutant = receipt(platform, stage);
      delete mutant.evidence.abiLinked;
      denied(mutant);
    }
    for (const stage of ["compiler-guest", "target-execution", "physical-hardware"]) {
      for (const mutation of [
        (m) => { m.evidence.hostReferenceOnly = true; },
        (m) => { m.evidence.compilerProduced = false; },
        (m) => { delete m.evidence.compilerSourceCommit; },
        (m) => { delete m.evidence.compilerBinarySha256; }
      ]) {
        const mutant = receipt(platform, stage);
        mutation(mutant);
        denied(mutant);
      }
    }
    for (const stage of ["target-execution", "physical-hardware"]) {
      const mutant = receipt(platform, stage);
      delete mutant.evidence.targetExecuted;
      denied(mutant);
    }
    const hardware = receipt(platform, "physical-hardware");
    hardware.evidence.physicalHardware = false;
    denied(hardware);
  }
});

test("repository, artifact and revision substitution fail closed across the registry", () => {
  const platforms = Object.keys(contract.platforms);
  for (const [index, platform] of platforms.entries()) {
    const other = platforms[(index + 1) % platforms.length];
    const changed = receipt(platform, "compiler-guest");
    changed.repository = contract.platforms[other].repository;
    denied(changed);
    for (const mutation of [
      (m) => { m.sourceCommit = "A".repeat(40); },
      (m) => { m.sourceCommit = "a".repeat(39); },
      (m) => { m.evidence.targetArtifactSha256 = "B".repeat(64); },
      (m) => { m.evidence.targetArtifactSha256 = "b".repeat(63); },
      (m) => { m.evidence.compilerSourceCommit = "c".repeat(39); },
      (m) => { m.evidence.compilerBinarySha256 = "d".repeat(65); }
    ]) {
      const mutant = receipt(platform, "compiler-guest");
      mutation(mutant);
      denied(mutant);
    }
  }
});

test("a tampered v1 contract cannot redefine stage ordering or repositories", () => {
  const base = receipt("desktop", "compiler-guest");
  for (const mutation of [
    (m) => { m.stageOrder.reverse(); },
    (m) => { m.stageOrder.push("unreviewed"); },
    (m) => { delete m.platforms.asic; },
    (m) => { m.platforms.desktop.repository = "attacker/desktop"; },
    (m) => { m.contract = "attacker/1"; },
    (m) => { m.schemaVersion = 2; }
  ]) {
    const changed = structuredClone(contract);
    mutation(changed);
    denied(base, changed);
  }
});

// These are verifier unit tests, NOT proof that a claimed Actions job actually
// executed, nor authentication of compiler output or physical hardware.
