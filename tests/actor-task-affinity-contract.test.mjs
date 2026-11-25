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
  assert.equal(spec.stopTaskAdmission, "ATOMIC_WITH_STOP_SNAPSHOT");
  assert.equal(spec.cleanupOnlyResume, "NO_NEW_TASKS");
  assert.equal(spec.parentChildCancellation, "PHYSICAL_DESCENDANT_JOIN");
  assert.equal(spec.gracefulStopPolicy, "BACKEND_EXPLICIT");
  assert.equal(spec.guestProofRequired, true);
  assert.equal(spec.zeroStep, "NOT_EXECUTED");
  assert.deepEqual(spec.cases.map(c => c.id), [
    "actor-task-await-reply", "reject-actor-self-capture",
    "actor-task-nested-await", "reject-actor-mail-capture"
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
  const taskBody = positive.match(/let Future<int> child = task \{([\s\S]*?)\};/);
  assert.ok(taskBody, "fixture must contain a task body");
  assert.doesNotMatch(taskBody[1], /\bself\./);

  const negative = await read("reject-actor-self-capture.atto");
  assert.match(negative, /task \{[\s\S]*?self\.count;/);

  const nested = await read("actor-task-nested-await.atto");
  assert.match(nested, /let Future<int> outer = task \{/);
  assert.match(nested, /let Future<int> nested = task \{/);
  assert.match(nested, /return await nested;/);
  assert.match(nested, /self\.send\(await outer\)/);

  const unsafeMailbox = await read("reject-actor-mail-capture.atto");
  assert.match(unsafeMailbox, /task \{[\s\S]*?mail\.value/);
});

test("STOP admission and cleanup are normative, not a static fixture PASS", async () => {
  const contract = await readFile(
    new URL("../contracts/v1/ACTOR_TASK_POOL_AFFINITY_V1.md", import.meta.url),
    "utf8"
  );
  assert.match(contract, /initial registration and STOP's cancellation snapshot/);
  assert.match(contract, /MUST linearize under the same actor-incarnation admission gate/);
  assert.match(contract, /cannot create a new Task during a surviving/);
  assert.match(contract, /Only already-admitted, authenticated lexical/);
  assert.match(contract, /Static Node manifest tests are not guest-execution proof/);
  assert.match(contract, /Every live actor incarnation MUST maintain a bounded/);
  assert.match(contract, /Parent `get_done\(\)` MUST join each registered transitive/);
  assert.match(contract, /cancelling an already-terminal parent must still revoke/);
  assert.match(contract, /Hosts\s+must not close the actor's Task census/);
});
