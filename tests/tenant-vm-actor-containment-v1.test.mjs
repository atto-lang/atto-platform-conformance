import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {TenantVmActorContainmentV1} from "../src/tenant-vm-actor-containment-v1.mjs";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/tenant-vm-actor-containment-v1.json", import.meta.url), "utf8"));
const fail = (f, code) => assert.throws(f, new RegExp(code));
const host = (options = {}) => new TenantVmActorContainmentV1(options);

test("contract explicitly separates source-free evidence from real VM-isolate proof", () => {
  assert.equal(contract.schema, "atto.tenant-vm-actor-containment.v1");
  assert.equal(contract.proof, "SOURCE_FREE_REFERENCE");
  assert.equal(contract.parent, "oreslang.tenant-isolation.v2");
  assert.ok(contract.requiredScenarios.includes("same-tenant-many-untrusted-actors"));
  assert.ok(contract.requiredScenarios.includes("cross-tenant-actor-ref-denied"));
});

test("many private actors share one tenant VM while tenants never share memory", () => {
  const vm = host();
  const ta = vm.createTenant("A"), tb = vm.createTenant("B");
  const a1 = vm.spawnActor(ta, 10), a2 = vm.spawnActor(ta, 11), b1 = vm.spawnActor(tb, 10);
  vm.enterActor(ta, a1, t => t.write(0, 41));
  vm.enterActor(ta, a2, t => t.write(0, 7));
  vm.enterActor(tb, b1, t => t.write(0, 99));
  assert.equal(vm.enterActor(ta, a1, t => t.read(0)), 41);
  assert.equal(vm.enterActor(ta, a2, t => t.read(0)), 7);
  assert.equal(vm.enterActor(tb, b1, t => t.read(0)), 99);
  assert.equal(vm.snapshot(ta).actors, 2);
  assert.equal(vm.snapshot(tb).actors, 1);
});

test("foreign actor cannot be entered or messaged even when actor IDs collide", () => {
  const vm = host();
  const ta = vm.createTenant("A"), tb = vm.createTenant("B");
  const a = vm.spawnActor(ta, 5), b = vm.spawnActor(tb, 5);
  fail(() => vm.enterActor(ta, b, () => 0), "STALE_OR_FOREIGN_ACTOR");
  fail(() => vm.enterActor(ta, a, t => t.send(b, Uint8Array.of(7))), "STALE_OR_FOREIGN_ACTOR");
  fail(() => vm.retireActor(ta, b), "STALE_OR_FOREIGN_ACTOR");
  assert.equal(vm.snapshot(ta).queuedBytes, 0);
  assert.equal(vm.snapshot(tb).queuedBytes, 0);
});

test("forged and stale actor grants are rejected even with matching public fields", () => {
  const vm = host(); const t = vm.createTenant("A");
  const a = vm.spawnActor(t, 1);
  const forged = Object.freeze({actorId: a.actorId, epoch: a.epoch});
  fail(() => vm.enterActor(t, forged, () => {}), "STALE_OR_FOREIGN_ACTOR");
  vm.retireActor(t, a);
  const newA = vm.spawnActor(t, 1);
  fail(() => vm.enterActor(t, a, () => {}), "STALE_OR_FOREIGN_ACTOR");
  assert.notEqual(newA.epoch, a.epoch);
});

test("foreign VM roots and stale tenant generations are rejected", () => {
  const x = host(), y = host();
  const xa = x.createTenant("same"), ya = y.createTenant("same");
  assert.equal(xa.generation, ya.generation);
  fail(() => x.spawnActor(ya, 1), "STALE_OR_FOREIGN_TENANT");
  fail(() => x.quiesceTenant(ya), "STALE_OR_FOREIGN_TENANT");
  x.quiesceTenant(xa); x.destroyTenant(xa);
  const renewed = x.createTenant("same");
  fail(() => x.spawnActor(xa, 1), "STALE_OR_FOREIGN_TENANT");
  assert.notEqual(renewed.generation, xa.generation);
});

test("actor mailbox transfers owned byte copies; recipients cannot mutate queued data", () => {
  const vm = host(); const h = vm.createTenant("a");
  const a = vm.spawnActor(h, 1), b = vm.spawnActor(h, 2);
  const payload = Uint8Array.of(5, 6);
  vm.enterActor(h, a, t => t.send(b, payload));
  payload[0] = 255;
  const received = vm.enterActor(h, b, t => t.receive());
  assert.deepEqual([...received], [5, 6]);
  received.fill(77);
  assert.equal(vm.enterActor(h, b, t => t.receive()), null);
  assert.equal(vm.snapshot(h).queuedBytes, 0);
});

test("actor and aggregate tenant/host mail quotas fail before publication", () => {
  const vm = host({maxHostMailBytes: 6});
  const a = vm.createTenant("a", {maxMailBytes: 5, maxMessagesPerActor: 1});
  const b = vm.createTenant("b", {maxMailBytes: 5});
  const a1 = vm.spawnActor(a, 1), a2 = vm.spawnActor(a, 2);
  const b1 = vm.spawnActor(b, 1), b2 = vm.spawnActor(b, 2);
  vm.enterActor(a, a1, t => t.send(a2, new Uint8Array(4)));
  fail(() => vm.enterActor(a, a1, t => t.send(a2, Uint8Array.of(1))), "ACTOR_MAIL_QUOTA");
  vm.enterActor(b, b1, t => t.send(b2, Uint8Array.of(1, 2)));
  fail(() => vm.enterActor(b, b1, t => t.send(b1, Uint8Array.of(1))), "HOST_MAIL_QUOTA");
  assert.equal(vm.snapshot(a).queuedBytes, 4);
  assert.equal(vm.snapshot(b).queuedBytes, 2);
  vm.enterActor(a, a2, t => t.receive());
  vm.enterActor(b, b1, t => t.send(b1, Uint8Array.of(1)));
  assert.equal(vm.snapshot(b).hostQueuedBytes, 3);
});

test("heap and actor limits are tenant aggregate, with no slot consumed on denial", () => {
  const vm = host(); const t = vm.createTenant("t", {maxActors: 2, maxHeapBytes: 100});
  const a = vm.spawnActor(t, 1, {heapBytes: 60});
  fail(() => vm.spawnActor(t, 2, {heapBytes: 41}), "TENANT_HEAP_QUOTA");
  const b = vm.spawnActor(t, 2, {heapBytes: 40});
  fail(() => vm.spawnActor(t, 3), "ACTOR_CAPACITY");
  assert.equal(vm.snapshot(t).heapBytes, 100);
  vm.retireActor(t, a);
  assert.equal(vm.snapshot(t).heapBytes, 40);
  vm.retireActor(t, b);
  assert.equal(vm.snapshot(t).heapBytes, 0);
});

test("reject raw native/CIL, invalid tenant labels and unsafe shared payloads", () => {
  const vm = host({maxTenants: 1});
  for (const id of [".", "..", "../x", "t/b", "é", "", "a".repeat(129)])
    fail(() => vm.createTenant(id), "INVALID_TENANT_ID");
  fail(() => vm.createTenant("a", {guestCode: "native"}), "UNTRUSTED_GUEST_CODE_DENIED");
  fail(() => vm.createTenant("a", {guestCode: "cil"}), "UNTRUSTED_GUEST_CODE_DENIED");
  const h = vm.createTenant("a"), a = vm.spawnActor(h, 1);
  fail(() => vm.enterActor(h, a, t => t.send(a, [1, 2])), "UNSAFE_MESSAGE_PAYLOAD");
  if (typeof SharedArrayBuffer !== "undefined") {
    const view = new Uint8Array(new SharedArrayBuffer(4));
    fail(() => vm.enterActor(h, a, t => t.send(a, view)), "UNSAFE_MESSAGE_PAYLOAD");
  }
  assert.equal(vm.snapshot(h).queuedBytes, 0);
});

test("sealed turns forbid same-actor reentrancy and stale borrowed continuations", () => {
  const vm = host(), h = vm.createTenant("a");
  const a = vm.spawnActor(h, 1), b = vm.spawnActor(h, 2);
  let leaked;
  vm.enterActor(h, a, t => {
    leaked = t;
    fail(() => vm.enterActor(h, a, () => {}), "ACTOR_REENTRANCY_DENIED");
    vm.enterActor(h, b, sibling => sibling.write(0, 9));
    t.write(0, 8);
  });
  fail(() => leaked.read(0), "TURN_REVOKED");
  fail(() => leaked.write(0, 10), "TURN_REVOKED");
  fail(() => leaked.send(b, Uint8Array.of(1)), "TURN_REVOKED");
  assert.equal(vm.enterActor(h, a, t => t.read(0)), 8);
  assert.equal(vm.enterActor(h, b, t => t.read(0)), 9);
  fail(() => vm.enterActor(h, a, () => Promise.resolve()), "ASYNC_TURN_REQUIRES_EXPLICIT_CONTINUATION");
});

test("quiescence fences admission, requires actor drain and invalidates borrowed grants", () => {
  const vm = host(); const t = vm.createTenant("a");
  const a = vm.spawnActor(t, 1), b = vm.spawnActor(t, 2);
  vm.enterActor(t, a, turn => turn.send(b, Uint8Array.of(1, 2, 3)));
  vm.quiesceTenant(t);
  fail(() => vm.spawnActor(t, 3), "TENANT_ADMISSION_CLOSED");
  fail(() => vm.enterActor(t, b, () => {}), "TENANT_ADMISSION_CLOSED");
  fail(() => vm.destroyTenant(t), "TENANT_DRAIN_REQUIRED");
  vm.retireActor(t, b);
  assert.equal(vm.snapshot(t).queuedBytes, 0);
  vm.retireActor(t, a);
  vm.destroyTenant(t);
  fail(() => vm.snapshot(t), "STALE_OR_FOREIGN_TENANT");
});

test("killing tenant A scrubs its queued mail and leaves tenant B operational", () => {
  const vm = host({maxHostMailBytes: 6});
  const a = vm.createTenant("a"), b = vm.createTenant("b");
  const a1 = vm.spawnActor(a, 1), a2 = vm.spawnActor(a, 2);
  const b1 = vm.spawnActor(b, 1);
  vm.enterActor(a, a1, t => t.send(a2, new Uint8Array(5)));
  vm.killTenant(a);
  assert.deepEqual(vm.snapshot(a), {phase: "quiescing", actors: 0, heapBytes: 0,
    queuedBytes: 0, hostQueuedBytes: 0, generation: a.generation});
  fail(() => vm.enterActor(a, a1, () => {}), "TENANT_ADMISSION_CLOSED");
  vm.destroyTenant(a);
  const fresh = vm.createTenant("a");
  const freshActor = vm.spawnActor(fresh, 1);
  assert.equal(vm.enterActor(fresh, freshActor, t => t.read(0)), 0);
  assert.equal(vm.enterActor(b, b1, t => { t.write(0, 4); return t.read(0); }), 4);
});
