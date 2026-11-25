import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Design manifest is an evidence ledger, not proof of compiler-backed parity.
const manifest = JSON.parse(readFileSync("fixtures/actor-pubsub-generation-v1/manifest.json", "utf8"));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.contract, "attolang.actor-pubsub-generation.design-v1");
assert.equal(manifest.evidenceLevel, "bounded-design-model-only");
assert.equal(manifest.model, "formal/pubsub_generation.bounded.mjs");
assert.equal(manifest.zeroStepCiCountsAsExecution, false);
assert.equal(manifest.sourceGuestCompilation, "NOT_EXECUTED");
assert.deepEqual(Object.keys(manifest.backendExecutionStatus).sort(), ["cranelift", "java", "llvm", "net", "wasm"]);
assert(Object.values(manifest.backendExecutionStatus).every(status => status === "NOT_EXECUTED"));
assert.deepEqual(manifest.bounds, {
  subscribers: 1, maxJoinGenerations: 2, queueCapacity: 2, maxDeliveries: 2
});
const expectedCases = [
  ["group_close_publish", "NoPostClosePublication"],
  ["queue_capacity", "QueueBounded"],
  ["rejoin_generation", "NoStaleDelivery"],
  ["unsubscribe_delivery", "NoStaleDelivery"]
];
assert.equal(manifest.modelCases.length, expectedCases.length, "duplicate or missing case declarations");
assert.deepEqual(
  manifest.modelCases.map(item => [item.id, item.invariant]).sort((a,b) => a[0].localeCompare(b[0])),
  expectedCases,
  "model case identity/invariant mismatch"
);
assert(manifest.modelCases.every(item => typeof item.expected === "string" && item.expected.trim().length > 10),
  "missing expected model outcome");
assert.deepEqual(
  manifest.negativeControls.map(item => [item.id, item.mustViolate]),
  [["deliver_old_generation", "NoStaleDelivery"], ["publish_after_close", "NoPostClosePublication"]]
);
assert(Array.isArray(manifest.outstandingRefinement) && manifest.outstandingRefinement.length >= 5);
assert(manifest.outstandingRefinement.every(item => typeof item === "string" && item.trim().length >= 12));
assert.equal(new Set(manifest.outstandingRefinement).size, manifest.outstandingRefinement.length,
  "duplicate outstanding refinement obligations");
console.log(JSON.stringify({
  status:"SOURCE_MODEL_MANIFEST_ONLY",
  modelCases:manifest.modelCases.length,
  unverifiedBackends:Object.keys(manifest.backendExecutionStatus)
},null,2));
