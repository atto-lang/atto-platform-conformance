import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/atto-gpu-actors-v0.json", import.meta.url), "utf8"));
const TARGETS = ["java", "llvm", "wasm", "forge", "net"];

test("GPU actor proposal extends, not replaces, existing GPU/actor contracts", () => {
  assert.equal(contract.contract, "atto.gpu-actors/0");
  assert.equal(contract.status, "candidate-unattested");
  assert.deepEqual(contract.compilerBackends, TARGETS);
  assert.equal(contract.hardwareStatus, "NOT_EXECUTED");
  assert.ok(contract.relatedContracts.includes("oreslang.heterogeneous-compute/1"));
  assert.equal(contract.syntax.gpuActor, "define gpu actor Name as ... end");
  assert.equal(contract.syntax.populationStatus, "illustrative-not-accepted");
});

test("actor isolation and hardware scheduling limits are explicit", () => {
  const s = contract.runtime;
  assert.equal(s.hostControlPlane, true);
  assert.equal(s.perActorExclusiveWriter, true);
  assert.equal(s.concurrentDifferentActors, true);
  assert.equal(s.allActorsSimultaneously, false);
  assert.equal(s.boundedPerActorMailboxes, true);
  assert.equal(s.implicitCpuFallback, false);
  assert.equal(s.implicitHostDeviceTransfer, false);
  assert.equal(s.directHostEffectsInsideKernels, false);
  assert.equal(s.deviceLossFaultDomain, "affected-device-cohort");
});

test("unattested contract cannot be mistaken for parity", () => {
  const seen = new Set();
  assert.ok(contract.scenarios.length >= 25);
  for (const c of contract.scenarios) {
    assert.match(c.id, /^[a-z_]+\.[a-z_]+$/);
    assert.ok(!seen.has(c.id), "duplicate " + c.id);
    seen.add(c.id);
    assert.ok(["compile", "runtime", "verification"].includes(c.kind));
    assert.ok(["accept", "reject", "pass"].includes(c.expected));
    assert.ok(Array.isArray(c.requires) && c.requires.length);
    assert.deepEqual(c.backends, TARGETS);
    assert.equal(c.evidence, "NOT_EXECUTED");
    if (c.expected === "reject") assert.ok(c.requires.includes("no-output-artifact"));
  }
  for (const id of [
    "dispatch.same_actor_fifo", "dispatch.concurrent_actors",
    "state.cross_actor_alias", "state.write_loan_over_gpu_fence",
    "state.failed_batch_no_partial_commit", "kernel.host_send_forbidden",
    "memory.cross_tenant_denied", "lifecycle.cancel_after_dispatch",
    "lifecycle.stale_incarnation_completion", "lifecycle.device_loss",
    "backend.unsupported_gpu", "evidence.physical_gpu_receipt"
  ]) assert.ok(seen.has(id), "missing oracle " + id);
});

test("GPU physical promotion requires executed guest and hardware provenance", () => {
  const p = contract.promotion;
  for (const k of ["compileGuestRequired", "realGpuRequiredForPhysicalClaim",
    "zeroStepRunNotEvidence", "hostOnlyModelNotParity", "exactSourceCommitRequired",
    "fixtureSha256Required", "compilerBinarySha256Required",
    "deviceAndDriverIdentityRequired", "fenceAndRetirementEvidenceRequired",
    "independentReview"]) assert.equal(p[k], true, k);
});
