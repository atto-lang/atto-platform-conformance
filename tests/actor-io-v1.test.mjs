import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const manifest = JSON.parse(await readFile(
  new URL("../contracts/actor-io-v1.json", import.meta.url), "utf8"));

test("actor io v1 has exact backend inventory and non-promoting status", () => {
  assert.equal(manifest.contract, "oreslang.actor-io/1");
  assert.equal(manifest.status, "normative_target_not_parity_evidence");
  assert.deepEqual(manifest.backends, ["java", "llvm", "net", "wasm", "cranelift"]);
  assert.deepEqual(Object.keys(manifest.backendState), manifest.backends);
});

test("actor io v1 keeps process stdio separate from implicit actor io", () => {
  assert.deepEqual(manifest.namespace.root, ["stdio", "print"]);
  assert.deepEqual(
    manifest.namespace.actor,
    ["io.in", "io.out", "io.err", "io.events", "io.meta"]);
  assert.ok(manifest.namespace.forbidden.includes("self.stdio"));
  assert.ok(manifest.namespace.forbidden.includes("actor-context-sensitive-stdio"));
});

test("actor io v1 requires generation isolation and bounded streams", () => {
  const required = new Set(manifest.requiredRules);
  for (const rule of [
    "bounded-logical-channels",
    "generation-fenced-authority",
    "restart-revokes-old-generation",
    "no-old-generation-queued-data-reopen",
    "single-physical-descriptor-owner",
    "data-only-output",
    "mailbox-capability-transport-remains-distinct",
  ]) assert.ok(required.has(rule), "missing rule " + rule);
});

test("actor io fixtures are unique and cover positive plus security negatives", () => {
  const ids = manifest.vectors.map(v => v.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(manifest.vectors.some(v => v.id === "io_out_actor"));
  assert.ok(manifest.vectors.some(v => v.id === "stdio_actor" && v.expected === "reject"));
  assert.ok(manifest.vectors.some(v => v.id === "io_actorref_output" && v.expected === "reject"));
  assert.ok(manifest.vectors.some(v => v.id === "mailbox_actorref"));
});

test("runtime substrate and zero-step CI cannot promote parity", () => {
  const nonEvidence = new Set(manifest.nonEvidence);
  assert.ok(nonEvidence.has("runtime-substrate-without-source-compiler"));
  assert.ok(nonEvidence.has("zero-step-workflow"));
  for (const backend of manifest.backends) {
    assert.equal(manifest.backendState[backend].minimumLayer, "guest-execution");
  }
  assert.equal(manifest.backendState.cranelift.currentClaim, "fail-closed-source-only");
  assert.equal(manifest.backendState.llvm.currentClaim, "runtime-substrate-only");
  assert.equal(manifest.backendState.net.currentClaim, "runtime-substrate-only");
  assert.equal(manifest.backendState.wasm.currentClaim, "runtime-substrate-only");
});
