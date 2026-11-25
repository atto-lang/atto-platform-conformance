import test from "node:test";
import assert from "node:assert/strict";
import {
  StateContainerReference, VirtualActorDirectoryReference
} from "../models/state-container-virtual-actor-v1.mjs";

test("state snapshots cannot mutate heap and writes remain exclusive", () => {
  const c = new StateContainerReference({ count: 1, nested: { value: 7 } });
  const read = c.read(s => {
    assert.equal(s.nested.value, 7);
    assert.throws(() => { s.nested.value = 99; }, TypeError);
    assert.throws(() => c.write(w => { w.count = 20; }), /conflict/);
    return s.nested;
  });
  assert.equal(read.value, 7);
  assert.equal(c.read(s => s.count), 1);
  assert.equal(c.write(s => { s.count++; return s.count; }), 2);
  assert.equal(c.read(s => s.count), 2);
});

test("critical guards release after failure and cannot leak live proxies", () => {
  const c = new StateContainerReference({ count: 1, nested: { value: 8 } });
  let leaked;
  assert.throws(() => c.write(s => {
    leaked = s.nested;
    s.count = 4;
    throw new Error("boom");
  }), /boom/);
  assert.throws(() => leaked.value, TypeError);
  assert.equal(c.read(s => s.count), 4); // critical region is not a rollback transaction
  assert.throws(() => c.write(s => s.nested), /mutable alias escape/);
  assert.equal(c.write(s => { s.count++; return s.count; }), 5);
  assert.throws(() => c.write(s => ({ then() {} })), /cannot suspend/);
  c.close();
  assert.throws(() => c.read(s => s.count), /closed/);
});

test("same logical key has one activation and distinct incarnation after deactivation", () => {
  let activations = 0, total = 0;
  const d = new VirtualActorDirectoryReference({ capacity: 2 });
  d.register("Cart", () => { activations++; return { receive(n) { total += n; } }; });
  const a = d.resolve("Cart", "caf\u00e9");
  const b = d.resolve("Cart", "cafe\u0301");
  assert.equal(a.logicalId, b.logicalId);
  assert.equal(d.send(a, 4).ok, true);
  const old = d.incarnationCapability(a);
  assert.equal(d.send(b, 7).ok, true);
  assert.equal(activations, 1);
  assert.deepEqual(d.send(a, 8), { ok: false, error: "BACKPRESSURE" });
  assert.throws(() => d.deactivate(a), /busy/);
  assert.equal(d.deliverNext(b), true);
  assert.equal(d.deliverNext(a), true);
  assert.equal(total, 11);
  d.deactivate(b);
  assert.equal(d.isCurrentIncarnation(old), false);
  assert.equal(d.send(a, 5).ok, true);
  assert.equal(activations, 2);
  assert.equal(d.isCurrentIncarnation(old), false);
  assert.ok(d.inspect(a).incarnation > 1);
});

test("logical reference cannot be forged and keys have bounded identity", () => {
  const d = new VirtualActorDirectoryReference();
  d.register("Cart", () => ({ receive() {} }));
  const ref = d.resolve("Cart", "x");
  assert.throws(() => d.send({ logicalId: ref.logicalId }, 1), /invalid virtual actor capability/);
  assert.throws(() => d.resolve("Cart", "x".repeat(257)), /key too long/);
  assert.throws(() => d.resolve("Cart", {}), /string/);
  assert.throws(() => d.register("Cart", () => ({})), /duplicate/);
});

test("panic emits CONTROL including failure count; no accepted messages disappear silently", () => {
  const notices = [];
  const d = new VirtualActorDirectoryReference({ capacity: 3, onControl: n => notices.push(n) });
  d.register("Worker", () => ({ receive() { throw new Error("failed"); } }));
  const ref = d.resolve("Worker", "one");
  assert.equal(d.send(ref, 1).ok, true);
  assert.equal(d.send(ref, 2).ok, true);
  assert.equal(d.deliverNext(ref), false);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].kind, "PANIC");
  assert.equal(notices[0].failedAcceptedCount, 2);
  assert.equal(d.inspect(ref).queued, 0);
  assert.equal(d.inspect(ref).active, false);
});
