import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("fixtures/actor-pubsub-generation-v1/manifest.json", "utf8"));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.contract, "attolang.actor-pubsub-generation.design-v1");
assert.equal(manifest.evidenceLevel, "bounded-design-model-only");
assert.equal(manifest.model, "formal/pubsub_generation.bounded.mjs");
assert.equal(manifest.zeroStepCiCountsAsExecution, false);
assert.equal(manifest.sourceGuestCompilation, "NOT_EXECUTED");
assert.deepEqual(Object.keys(manifest.backendExecutionStatus).sort(), ["cranelift", "java", "llvm", "net", "wasm"]);
assert(Object.values(manifest.backendExecutionStatus).every(status => status === "NOT_EXECUTED"));
assert.equal(manifest.bounds.maxJoinGenerations, 2);
assert.equal(manifest.bounds.queueCapacity, 2);
const cases = new Set(manifest.modelCases.map(item => item.id));
assert.equal(cases.size, 4);
const invariants = new Set(["NoStaleDelivery", "NoPostClosePublication", "QueueBounded"]);
assert(manifest.modelCases.every(item => invariants.has(item.invariant)));
assert.deepEqual(
  manifest.negativeControls.map(item => [item.id, item.mustViolate]),
  [["deliver_old_generation", "NoStaleDelivery"], ["publish_after_close", "NoPostClosePublication"]]
);
assert(manifest.outstandingRefinement.length >= 5);
console.log(JSON.stringify({status:"SOURCE_MODEL_MANIFEST_ONLY",modelCases:cases.size,unverifiedBackends:Object.keys(manifest.backendExecutionStatus)},null,2));
