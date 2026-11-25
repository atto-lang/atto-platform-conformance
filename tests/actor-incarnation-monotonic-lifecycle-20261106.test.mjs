import test from "node:test";
import assert from "node:assert/strict";
import {ActorLockModel} from "../models/actor-lock-lifecycle-v1.mjs";

// SOURCE-FREE reference model only; this is not compiler or guest execution.
test("actor ID cannot have two simultaneous live incarnations", () => {
  const m = new ActorLockModel();
  const original = m.spawn("worker", 3);
  m.task(original, "turn");
  assert.throws(() => m.spawn("worker", 4), /physically retired/);
  m.stopActor(original);
  assert.equal(m.actor(original).phase, "stopping");
  assert.throws(() => m.spawn("worker", 4), /physically retired/);
  m.quiesceTask(original, "turn");
  assert.equal(m.actor(original).phase, "retired");
  const successor = m.spawn("worker", 4);
  assert.equal(m.actor(successor).phase, "live");
  m.assertConsistent();
});

test("retired generations cannot be resurrected or replayed after higher incarnation", () => {
  const m = new ActorLockModel();
  const old = m.spawn("same", 12);
  m.stopActor(old); // no tasks: physically retired
  assert.equal(m.actor(old).phase, "retired");
  const successor = m.spawn("same", 13);
  for (const n of [1, 11, 12, 13]) {
    assert.throws(() => m.spawn("same", n), /stale or replayed/);
  }
  assert.throws(() => m.spawn("same", 14), /physically retired/);
  m.stopActor(successor);
  assert.equal(m.actor(successor).phase, "retired");
  const newest = m.spawn("same", 14);
  assert.equal(m.actor(newest).phase, "live");
  m.assertConsistent();
});

test("retired actor permit cannot release a newer generation's lock", () => {
  const m = new ActorLockModel();
  const old = m.spawn("owner", 1);
  m.task(old, "turn");
  const stale = m.acquire(old, "turn", "sealed-state", "write");
  m.stopActor(old);
  m.quiesceTask(old, "turn");
  assert.equal(stale.status, "released");
  const current = m.spawn("owner", 2);
  m.task(current, "turn");
  const active = m.acquire(current, "turn", "sealed-state", "write");
  assert.equal(active.status, "held");
  assert.equal(m.release(stale), false);
  assert.equal(active.status, "held");
  assert.throws(() => m.acquire(old, "turn", "sealed-state", "read"), /admission fenced/);
  m.assertConsistent();
});

test("independent actor IDs may coexist and identities cannot be forged", () => {
  const m = new ActorLockModel();
  const a = m.spawn("A", 8);
  const b = m.spawn("B", 1);
  assert.equal(m.actor(a).phase, "live");
  assert.equal(m.actor(b).phase, "live");
  for (const bad of ["", "A\0alias", 5, null, {}]) {
    assert.throws(() => m.spawn(bad, 1), /invalid actor identity/);
  }
  for (const bad of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => m.spawn("C", bad), /invalid incarnation/);
  }
  m.assertConsistent();
});
