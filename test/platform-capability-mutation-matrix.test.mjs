import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verifyPlatformCapabilityReceipt } from "../bin/verify-platform-capability-receipt.mjs";

const contract = JSON.parse(readFileSync(new URL("../contracts/platform-capabilities-v1.json", import.meta.url), "utf8"));
const platforms = Object.keys(contract.platforms);
const stages = [...contract.stageOrder];
const sha40 = (char) => char.repeat(40);
const sha64 = (char) => char.repeat(64);
const allCases = platforms.flatMap((platform) => stages.map((stage) => [platform, stage]));
const check = (receipt, candidate = contract) => verifyPlatformCapabilityReceipt(receipt, candidate);

function validReceipt(platform, stage) {
  const level = stages.indexOf(stage);
  assert.ok(level >= 0, "test fixture stage must be registered");
  const evidence = {
    exactHead: true,
    executedSteps: 4,
    workflowConclusion: "success",
    targetArtifactSha256: sha64("b"),
  };
  if (level >= 1) evidence.abiLinked = true;
  if (level >= 2) Object.assign(evidence, {
    hostReferenceOnly: false,
    compilerProduced: true,
    compilerSourceCommit: sha40("c"),
    compilerBinarySha256: sha64("d"),
  });
  if (level >= 3) evidence.targetExecuted = true;
  if (level >= 4) evidence.physicalHardware = true;
  return {
    schema: "oreslang.platform-capability/1",
    platform,
    repository: contract.platforms[platform].repository,
    sourceCommit: sha40("a"),
    stage,
    evidence,
  };
}

test("positive baseline: every registered platform and every stage has a well-formed receipt", () => {
  assert.equal(platforms.length, 6, "v1 registry should cover six platforms");
  assert.equal(stages.length, 5, "v1 registry should cover five proof stages");
  for (const [platform, stage] of allCases) {
    const result = check(validReceipt(platform, stage));
    assert.equal(result.ok, true, platform + "/" + stage + ": " + result.errors.join("; "));
  }
});

test("negative matrix: no promotion for bad head, missing steps, missing digest, or failed CI", () => {
  const mutations = [
    ["exactHead=false", (r) => { r.evidence.exactHead = false; }],
    ["exactHead missing", (r) => { delete r.evidence.exactHead; }],
    ["steps missing", (r) => { delete r.evidence.executedSteps; }],
    ["steps null", (r) => { r.evidence.executedSteps = null; }],
    ["steps zero", (r) => { r.evidence.executedSteps = 0; }],
    ["steps string", (r) => { r.evidence.executedSteps = "4"; }],
    ["steps fractional", (r) => { r.evidence.executedSteps = 0.5; }],
    ["workflow queued", (r) => { r.evidence.workflowConclusion = "queued"; }],
    ["workflow failed", (r) => { r.evidence.workflowConclusion = "failure"; }],
    ["workflow skipped", (r) => { r.evidence.workflowConclusion = "skipped"; }],
    ["workflow missing", (r) => { delete r.evidence.workflowConclusion; }],
    ["artifact missing", (r) => { delete r.evidence.targetArtifactSha256; }],
    ["artifact uppercase", (r) => { r.evidence.targetArtifactSha256 = sha64("A"); }],
    ["commit truncated", (r) => { r.sourceCommit = sha40("a").slice(1); }],
    ["commit nonhex", (r) => { r.sourceCommit = sha40("z"); }],
    ["repository substitution", (r) => { r.repository = "unapproved/public-mirror"; }],
    ["schema downgrade", (r) => { r.schema = "oreslang.platform-capability/0"; }],
    ["unknown stage", (r) => { r.stage = "guest-certified"; }],
  ];
  let negatives = 0;
  for (const [platform, stage] of allCases) {
    for (const [name, mutate] of mutations) {
      const forged = validReceipt(platform, stage);
      mutate(forged);
      const result = check(forged);
      assert.equal(result.ok, false, platform + "/" + stage + " admitted " + name);
      assert.ok(result.errors.length > 0, platform + "/" + stage + " lacked rejection diagnostics");
      negatives++;
    }
  }
  assert.equal(negatives, 540, "mutation coverage should not shrink without review");
});

test("negative compiler/target/physical evidence never inherits a weaker-stage proof", () => {
  let negatives = 0;
  const invalidations = [
    ["abiLinked missing", (r) => { delete r.evidence.abiLinked; }, 1],
    ["abiLinked false", (r) => { r.evidence.abiLinked = false; }, 1],
    ["host-only promotion", (r) => { r.evidence.hostReferenceOnly = true; }, 2],
    ["host-only omitted", (r) => { delete r.evidence.hostReferenceOnly; }, 2],
    ["compiler not produced", (r) => { r.evidence.compilerProduced = false; }, 2],
    ["compiler SHA missing", (r) => { delete r.evidence.compilerSourceCommit; }, 2],
    ["compiler SHA uppercase", (r) => { r.evidence.compilerSourceCommit = sha40("A"); }, 2],
    ["compiler digest missing", (r) => { delete r.evidence.compilerBinarySha256; }, 2],
    ["compiler digest truncated", (r) => { r.evidence.compilerBinarySha256 = sha64("d").slice(1); }, 2],
    ["target not executed", (r) => { r.evidence.targetExecuted = false; }, 3],
    ["target execution missing", (r) => { delete r.evidence.targetExecuted; }, 3],
    ["physical target not executed", (r) => { r.evidence.physicalHardware = false; }, 4],
  ];
  for (const platform of platforms) {
    for (let i = 1; i < stages.length; i++) {
      for (const [name, mutate, minimum] of invalidations) {
        if (i < minimum) continue;
        const forged = validReceipt(platform, stages[i]);
        mutate(forged);
        const result = check(forged);
        assert.equal(result.ok, false, platform + "/" + stages[i] + " admitted " + name);
        negatives++;
      }
    }
  }
  assert.equal(negatives, 6 * (2 + 9 + 11 + 12));
});

test("platform substitution and weakened policy registry cannot be silently accepted", () => {
  let swapped = 0;
  for (const from of platforms) {
    for (const to of platforms) {
      if (from === to) continue;
      const forged = validReceipt(from, "compiler-guest");
      forged.repository = contract.platforms[to].repository;
      assert.equal(check(forged).ok, false, from + " accepted " + to + " repo");
      swapped++;
    }
  }
  assert.equal(swapped, 30);
  for (const mutate of [
    (c) => { c.platforms.desktop.repository = "attacker/replacement"; },
    (c) => { c.platforms.unapproved = { repository: "attacker/extra" }; },
    (c) => { delete c.platforms.mobile; },
    (c) => { c.stageOrder = c.stageOrder.slice(1); },
    (c) => { c.stageOrder.reverse(); },
    (c) => { c.contract = "oreslang.platform-capability/0"; },
    (c) => { c.schemaVersion = 0; },
    (c) => { c.platforms.desktop.targetClass = "public-web"; },
    (c) => { delete c.platforms.embedded.targetClass; },
    (c) => { c.promotionRules.all = []; },
    (c) => { c.promotionRules.all = ["exact-head", "target-artifact-digest", "executed-steps"]; },
    (c) => { delete c.promotionRules["compiler-guest"]; },
    (c) => { c.promotionRules["compiler-guest"] = ["compiler-produced"]; },
    (c) => { c.promotionRules["physical-hardware"] = []; },
    (c) => { c.promotionRules["unreviewed-guest"] = ["executed-steps"]; },
    (c) => { c.promotionRules = null; },
    (c) => { c.nonEvidence = []; },
    (c) => { c.nonEvidence[0] = "zero-step-is-verified"; },
    (c) => { delete c.nonEvidence; },
  ]) {
    const altered = structuredClone(contract);
    mutate(altered);
    const result = check(validReceipt("desktop", "compiler-guest"), altered);
    assert.equal(result.ok, false, "weakened registry admitted: " + mutate.toString());
  }
});

test("canonical v1 contract seals every promotion rule and non-evidence item", () => {
  for (const [stage, original] of Object.entries(contract.promotionRules)) {
    for (const variant of [
      [],
      original.slice(1),
      [...original, "skip-review"],
      [...original].reverse(),
      [original[0], original[0], ...original.slice(1)],
      null,
    ]) {
      const altered = structuredClone(contract);
      altered.promotionRules[stage] = variant;
      const result = check(validReceipt("desktop", "compiler-guest"), altered);
      assert.equal(result.ok, false, stage + " accepted changed requirements " + String(variant));
    }
  }
  for (const index of contract.nonEvidence.keys()) {
    const altered = structuredClone(contract);
    altered.nonEvidence.splice(index, 1);
    assert.equal(check(validReceipt("desktop", "compiler-guest"), altered).ok, false,
      "nonEvidence item " + index + " dropped without policy failure");
  }
});

test("missing and wrong-shaped receipts fail closed without throwing", () => {
  for (const receipt of [null, undefined, 0, false, [], "", "{}", { evidence: [] }, { evidence: null }]) {
    const result = check(receipt);
    assert.equal(result.ok, false, "bad receipt accepted: " + String(receipt));
    assert.ok(Array.isArray(result.errors) && result.errors.length > 0);
  }
});
