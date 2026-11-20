import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/state-container-virtual-actor-v1.json", import.meta.url), "utf8"));

const TARGETS = ["java", "llvm", "wasm", "forge", "net"];

test("candidate declarations have exact spellings and no grain alias", () => {
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.contract, "state-container-virtual-actor-v1");
  assert.equal(contract.status, "candidate-unattested");
  assert.equal(contract.syntax.stateContainer, "define state container");
  assert.equal(contract.syntax.virtualActor, "define virtual actor");
  assert.equal(contract.syntax.grainAlias, false);
  assert.deepEqual([...contract.backends].sort(), [...TARGETS].sort());
  assert.ok(contract.cases.length >= 14);
});

test("candidate fixtures cannot accidentally assert real compiler parity", () => {
  const seen = new Set();
  for (const item of contract.cases) {
    assert.match(item.id, /^(state_container|virtual_actor)\.[a-z0-9_]+$/);
    assert.equal(seen.has(item.id), false, "duplicate fixture id: " + item.id);
    seen.add(item.id);
    assert.ok(["compile", "compile_and_run", "runtime"].includes(item.kind), item.id);
    assert.equal(item.evidence, "NOT_EXECUTED", item.id);
    assert.ok(["accept", "reject"].includes(item.expected.compilation), item.id);
    assert.equal(typeof item.source, "string", item.id);
    assert.ok(item.source.trim().length > 0, item.id);
    assert.ok(Array.isArray(item.requires) && item.requires.length, item.id);
    assert.deepEqual([...item.backends].sort(), [...TARGETS].sort(), item.id);
    if (item.expected.compilation === "reject") {
      assert.match(item.expected.diagnosticClass, /^[a-z][a-z_]+$/, item.id);
      assert.ok(item.requires.includes("no-output-artifact"), item.id);
    }
  }
});

test("unsafe heap aliases and virtual activation races have explicit oracles", () => {
  const cases = new Map(contract.cases.map(item => [item.id, item]));
  for (const name of [
    "state_container.external_field_rejected",
    "state_container.escape_alias_rejected",
    "state_container.suspend_in_critical_rejected",
    "state_container.shared_unsynchronized_rejected",
    "state_container.use_after_take_rejected",
    "state_container.release_on_panic",
    "state_container.concurrent_readers",
    "virtual_actor.activation",
    "virtual_actor.stale_incarnation",
    "virtual_actor.supervisor_control",
    "virtual_actor.grain_not_alias",
    "state_container.quiescent_release",
    "virtual_actor.two_phase_activation",
    "virtual_actor.foreign_capability_denied",
    "virtual_actor.invalid_key_rejected",
  ]) assert.ok(cases.has(name), "missing contract fixture: " + name);
  assert.equal(cases.get("virtual_actor.grain_not_alias").expected.compilation, "reject");
  assert.ok(cases.get("virtual_actor.activation").requires.includes("at-most-one-active-incarnation"));
  assert.ok(cases.get("virtual_actor.stale_incarnation").requires.includes("old-incarnation-cannot-act-on-replacement"));
});
