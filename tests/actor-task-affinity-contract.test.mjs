import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const base = new URL("../fixtures/actor-task-affinity/v1/", import.meta.url);
const read = name => readFile(new URL(name, base), "utf8");

test("actor task placement requires actor pool not supervisor CONTROL", async () => {
  const spec = JSON.parse(await read("manifest.json"));
  assert.equal(spec.schema, "atto.actor-task-affinity/1");
  assert.equal(spec.status, "TARGET_NOT_VERIFIED");
  assert.equal(spec.canonicalExtension, ".atto");
  assert.deepEqual(spec.backends, ["java", "llvm", "wasm", "net", "forge"]);
  assert.equal(spec.schedulerDomain, "actor-incarnation");
  assert.equal(spec.physicalExecution, "actor-kind-worker-pool");
  assert.equal(spec.controlPoolExecution, "FORBIDDEN");
  assert.equal(spec.futureProducerExecutesGuest, "FORBIDDEN");
  assert.equal(spec.untrustedMissingQuotaSupport, "REJECT");
  assert.equal(spec.actorStateCapture, "REJECT");
  assert.equal(spec.singleWriter, "REQUIRED");
  assert.equal(spec.postStopGuestExecution, "CLEANUP_ONLY");
  assert.equal(spec.guestProofRequired, true);
  assert.equal(spec.zeroStep, "NOT_EXECUTED");
  assert.deepEqual(spec.cases.map(c => c.id), [
    "actor-task-await-reply", "reject-actor-self-capture"
  ]);
  for (const entry of spec.cases) {
    assert.equal(entry.file, entry.id + ".atto");
    assert.ok(entry.requires.length > 0);
    assert.ok(["guest", "compile-reject"].includes(entry.kind));
    assert.ok((await read(entry.file)).includes("task {"));
  }
  assert.equal(spec.cases[0].expectedStdout, "42");
});

test("source fixtures distinguish captured data from actor self", async () => {
  const positive = await read("actor-task-await-reply.atto");
  assert.match(positive, /define actor Worker as/);
  assert.match(positive, /const int snapshot = 40/);
  assert.match(positive, /let Future<int> child = task \{/);
  assert.match(positive, /self\.send\(await child\)/);
  assert.match(positive, /await worker\.get_done\(\)/);
  assert.doesNotMatch(positive, /task \{[\s\S]*?self\./);

  const negative = await read("reject-actor-self-capture.atto");
  assert.match(negative, /task \{[\s\S]*?self\.count;/);
});
