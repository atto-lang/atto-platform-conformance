import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const contract = JSON.parse(readFileSync(new URL("../contracts/portable-thread-context-v1.json", import.meta.url), "utf8"));
test("portable thread v1 fixtures are complete and explicitly unexecuted", () => {
  assert.equal(contract.version, 1);
  assert.equal(contract.status, "candidate-not-executed");
  assert.deepEqual(contract.backends, ["java", "llvm", "wasm", "forge", "net"]);
  assert.ok(contract.proofRequired.includes("real-compiler-and-runtime-logs"));
  assert.ok(contract.cases.length >= 20);
  assert.equal(contract.threadEntryAbi, 'AOT_RESOLVED_NAMED_OR_COMPILER_SYNTHESIZED_NON_SUSPENDING_ENTRY');
  assert.equal(contract.closureEntry, 'OWNED_SEND_STATIC_COMPILE_TIME_CAPTURE_LOWERING_ONLY');
  assert.ok(contract.cases.some(x => x.id === 'thread.named_entry_aot' && x.expect === 'accept'));
  assert.ok(contract.cases.some(x => x.id === 'thread.dynamic_entry_rejected' && x.expect === 'reject'));

  const ids = new Set();
  for (const item of contract.cases) {
    assert.ok(item.id && !ids.has(item.id), item.id);
    ids.add(item.id);
    assert.ok(["compile", "runtime"].includes(item.kind), item.id);
    assert.ok(["accept", "reject"].includes(item.expect), item.id);
    assert.equal(item.evidence, "NOT_EXECUTED", item.id);
    assert.deepEqual(item.backends, contract.backends, item.id);
    assert.ok(item.source.trim().length > 10, item.id);
    if (item.expect === "reject") assert.ok(item.diagnosticClass, item.id);
    if (item.kind === "runtime") assert.ok(item.oracle, item.id);
  }
});
test("thread, Task and actor local domains cannot be conflated by contract", () => {
  const required = [
    "thread.threadlocal_in_migrating_task", "task.local_survives_migration",
    "actor.local_survives_migration", "thread.no_actor_state_capture",
    "actor.no_independent_task_state", "thread.dyn_requires_send",
    "thread.box_use_after_move", "runtime.shutdown_join_and_quiesce",
  ];
  for (const id of required) assert.ok(contract.cases.some(x => x.id === id), id);
});

test("candidate .atto fixtures exist and none has promotable execution evidence", () => {
  const root = new URL("../fixtures/portable-thread-context/v1/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
  assert.equal(manifest.contract, "portable-thread-context-v1");
  assert.equal(manifest.status, "candidate-guest-not-executed");
  assert.deepEqual(manifest.backends, contract.backends);
  assert.equal(manifest.files.length, 4);
  for (const file of manifest.files) {
    assert.match(file.path, /^[a-z0-9-]+\.atto$/);
    assert.equal(file.evidence, "NOT_EXECUTED");
    const source = readFileSync(new URL(file.path, root), "utf8");
    assert.match(source, /NOT_EXECUTED/);
    assert.ok(source.length > 80);
  }
});
