import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyPlatformCapabilityReceipt } from "../bin/verify-platform-capability-receipt.mjs";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/platform-capabilities-v1.json", import.meta.url), "utf8"
));

function receipt(platform = "desktop", stage = "compiler-guest") {
  return {
    schema: "oreslang.platform-capability/1",
    platform,
    repository: contract.platforms[platform].repository,
    sourceCommit: "a".repeat(40),
    stage,
    evidence: {
      exactHead: true,
      executedSteps: 12,
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
function denied(candidate, policy = contract, match) {
  const result = verifyPlatformCapabilityReceipt(candidate, policy);
  assert.equal(result.ok, false, "forged policy/receipt must not be admitted");
  assert.ok(result.errors.length > 0);
  if (match) assert.match(result.errors.join("; "), match);
}

test("v1 targetClass and published stage metadata are semantically fixed", () => {
  for (const platform of Object.keys(contract.platforms)) {
    for (const stage of contract.stageOrder) {
      const result = verifyPlatformCapabilityReceipt(receipt(platform, stage), contract);
      assert.equal(result.ok, true, platform + "/" + stage + ": " + result.errors.join("; "));
    }
  }
  for (const platform of Object.keys(contract.platforms)) {
    for (const replacement of [null, undefined, "", "host-only", "generic-target"]) {
      const altered = structuredClone(contract);
      altered.platforms[platform].targetClass = replacement;
      denied(receipt(platform), altered, /targetClass/);
    }
  }
});

test("cannot dilute or extend v1 promotion rules without a version bump", () => {
  for (const stage of Object.keys(contract.promotionRules)) {
    for (const mutation of [
      (p) => { p.promotionRules[stage].pop(); },
      (p) => { p.promotionRules[stage].push("host-simulation-is-enough"); },
      (p) => { p.promotionRules[stage].push(p.promotionRules[stage][0]); },
      (p) => { p.promotionRules[stage][0] = "unsupported"; },
      (p) => { delete p.promotionRules[stage]; }
    ]) {
      const policy = structuredClone(contract);
      mutation(policy);
      denied(receipt(), policy, /promotionRules/);
    }
  }
  for (const mutation of [
    (p) => { p.promotionRules = null; },
    (p) => { p.promotionRules.unreviewed = []; },
    (p) => { delete p.promotionRules; },
    (p) => { p.promotionRules = ["exact-head"]; }
  ]) {
    const policy = structuredClone(contract);
    mutation(policy);
    denied(receipt(), policy, /promotionRules/);
  }
  // Array ordering is not evidence; membership, count and uniqueness are.
  const reordered = structuredClone(contract);
  reordered.promotionRules.all.reverse();
  assert.equal(verifyPlatformCapabilityReceipt(receipt(), reordered).ok, true);
});

test("v1 non-evidence taxonomy cannot be removed, duplicated or reclassified", () => {
  for (const mutation of [
    (p) => { p.nonEvidence.pop(); },
    (p) => { p.nonEvidence.push("source-free-emulated-success"); },
    (p) => { p.nonEvidence.push(p.nonEvidence[0]); },
    (p) => { p.nonEvidence[0] = "trusted-check"; },
    (p) => { p.nonEvidence = null; },
    (p) => { delete p.nonEvidence; }
  ]) {
    const policy = structuredClone(contract);
    mutation(policy);
    denied(receipt(), policy, /nonEvidence/);
  }
});

test("inherited proof flags, commit IDs and platform names are not executable evidence", () => {
  // Use the highest stage so every proof field is mandatory in this case.
  const valid = receipt("desktop", "physical-hardware");
  assert.equal(verifyPlatformCapabilityReceipt(valid, contract).ok, true);

  for (const field of [
    "exactHead", "executedSteps", "workflowConclusion", "targetArtifactSha256",
    "abiLinked", "hostReferenceOnly", "compilerProduced",
    "compilerSourceCommit", "compilerBinarySha256", "targetExecuted", "physicalHardware"
  ]) {
    const mutant = structuredClone(valid);
    const own = mutant.evidence;
    const prototype = { [field]: own[field] };
    delete own[field];
    mutant.evidence = Object.assign(Object.create(prototype), own);
    denied(mutant, contract, new RegExp(field));
  }

  for (const field of ["schema", "platform", "repository", "sourceCommit", "stage", "evidence"]) {
    const mutant = structuredClone(valid);
    const prototype = { [field]: mutant[field] };
    delete mutant[field];
    const inherited = Object.assign(Object.create(prototype), mutant);
    denied(inherited);
  }
});

// This tests contract/receipt *shape* and rejects policy metadata tampering.
// A structurally valid receipt still requires independent log, artifact,
// source-tree, runner and reviewer authentication before promotion.
