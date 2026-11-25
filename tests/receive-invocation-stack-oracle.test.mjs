import test from "node:test";
import assert from "node:assert/strict";
import { ReceiveStackOracle, ReceiveStackViolation } from "../lib/receive-invocation-stack-oracle.mjs";

const denied = (f, phrase) => assert.throws(f, e =>
  e instanceof ReceiveStackViolation && e.message.includes(phrase));
const fresh = (opts = {}) => {
  const o = new ReceiveStackOracle();
  o.actor("A", opts);
  return o;
};

test("default serial receive retains admission slot while suspended", () => {
  const o = fresh();
  const a1 = o.receive("A");
  const f = o.push(a1, "receive", 16, {x: 42});
  const wake = o.suspend(a1);
  assert.equal(o.stats("A").liveReceives, 1);
  denied(() => o.receive("A"), "slot occupied");
  o.resume(a1, wake, "other-carrier");
  assert.equal(o.get(a1, f, "x"), 42);
  o.pop(a1, f); o.retire(a1);
  assert.equal(o.stats("A").liveReceives, 0);
  assert.ok(o.receive("A"));
});

test("opt-in N concurrent receives own disjoint logical stacks on same carrier", () => {
  const o = fresh({messageConcurrency: 2});
  const a = o.receive("A", "one-worker");
  const b = o.receive("A", "one-worker");
  const af = o.push(a, "handler", 8, {id: "a"});
  const bf = o.push(b, "handler", 8, {id: "b"});
  assert.notEqual(a.stack, b.stack);
  assert.equal(o.get(a, af, "id"), "a");
  assert.equal(o.get(b, bf, "id"), "b");
  denied(() => o.get(a, bf, "id"), "foreign");
  denied(() => o.receive("A"), "slot occupied");
  o.pop(a, af); o.pop(b, bf);
  o.retire(a); o.retire(b);
});

test("nested CALL frames preserve LIFO locals and PC through await and carrier migration", () => {
  const o = fresh();
  const s = o.receive("A", "worker-1");
  const parent = o.push(s, "receive", 16, {pc: 17});
  const callee = o.push(s, "nested_call", 16, {pc: 23, retPc: 18});
  const wake = o.suspend(s);
  denied(() => o.get(s, callee, "pc"), "not active");
  assert.equal(o.stats("A").totalStackBytes, 32);
  assert.strictEqual(o.resume(s, wake, "worker-2"), s);
  assert.equal(o.get(s, callee, "retPc"), 18);
  o.set(s, callee, "pc", 24);
  assert.equal(o.get(s, callee, "pc"), 24);
  denied(() => o.pop(s, parent), "not at top");
  o.pop(s, callee); o.pop(s, parent); o.retire(s);
  assert.equal(o.stats("A").totalStackBytes, 0);
});

test("child Task gets independent stack; parent suspension does not invalidate child frames", () => {
  const o = fresh();
  const parent = o.receive("A", "thread-1");
  const pf = o.push(parent, "parent", 8, {x: 1});
  const child = o.spawnTask(parent, "thread-1");
  const cf = o.push(child, "child", 8, {x: 2});
  assert.notEqual(child.stack, parent.stack);
  o.suspend(parent);
  assert.equal(o.get(child, cf, "x"), 2);
  denied(() => o.get(child, pf, "x"), "foreign");
  denied(() => o.retire(parent), "live stack frames");
  o.pop(child, cf); o.retire(child);
  o.unwind(parent); o.retire(parent);
});

test("same-shaped guest objects never authenticate stack or frame access", () => {
  const o = fresh();
  const stack = o.receive("A");
  const frame = o.push(stack, "handler");
  denied(() => o.push({...stack}, "fake"), "forged");
  denied(() => o.get(stack, {...frame}, "x"), "forged");
  denied(() => o.get({}, frame, "x"), "forged");
  o.pop(stack, frame);
  denied(() => o.get(stack, frame, "x"), "retired");
  o.retire(stack);
  denied(() => o.push(stack, "new"), "retired");
});

test("wake authority is one-shot, stack-local and not tied to carrier identity", () => {
  const o = fresh({messageConcurrency: 2});
  const a = o.receive("A");
  const b = o.receive("A");
  const aw = o.suspend(a);
  o.suspend(b);
  denied(() => o.resume(b, aw, "another-worker"), "foreign");
  denied(() => o.resume(a, {...aw}, "worker"), "forged");
  o.resume(a, aw, "new-worker");
  denied(() => o.resume(a, aw, "worker"), "not suspended");
  o.retire(a); o.unwind(b); o.retire(b);
});

test("actor aggregate quota includes all suspended receive and Task stacks", () => {
  const o = fresh({messageConcurrency: 2,maxActorStackBytes: 32,maxBytesPerStack: 32});
  const a = o.receive("A");
  o.push(a, "a", 16);
  const task = o.spawnTask(a);
  o.push(task, "task", 12);
  o.suspend(a);
  const b = o.receive("A");
  denied(() => o.push(b, "b", 8), "logical stack quota exceeded");
  assert.equal(o.stats("A").state, "FAILED");
  assert.equal(o.stats("A").totalStackBytes, 28);
  denied(() => o.receive("A"), "actor failed");
  o.unwind(task); o.retire(task);
  o.unwind(a); o.retire(a);
  o.unwind(b); o.retire(b);
  assert.equal(o.stats("A").totalStackBytes, 0);
});

test("frame depth overflow terminates actor A but does not poison actor B", () => {
  const o = fresh({maxFramesPerStack: 1});
  o.actor("B");
  const a = o.receive("A");
  const b = o.receive("B");
  o.push(a, "first", 8);
  denied(() => o.push(a, "overflow", 8), "quota exceeded");
  denied(() => o.push(a, "swallowed_and_resume", 8), "actor poisoned");
  denied(() => o.receive("A"), "actor failed");
  const fb = o.push(b, "unrelated", 8, {alive: true});
  assert.equal(o.get(b, fb, "alive"), true);
  o.pop(b, fb); o.retire(b);
  o.unwind(a); o.retire(a);
  assert.equal(o.stats("B").state, "ALIVE");
});

test("cancel request and physical task retirement are distinct", () => {
  const o = fresh();
  const p = o.receive("A");
  const t = o.spawnTask(p);
  o.push(t, "pending_task", 16);
  o.cancel(t);
  denied(() => o.push(t, "work"), "not active");
  denied(() => o.retire(t), "physical cleanup");
  denied(() => o.retire(p), "child task not physically retired");
  o.unwind(t); o.retire(t); o.retire(p);
  assert.equal(o.stats("A").retired, 2);
  denied(() => o.unwind(t), "retired");
});

test("actor failure requires physical cleanup before generation restart", () => {
  const o = fresh({maxBytesPerStack: 8});
  const a = o.receive("A");
  o.push(a, "at_limit", 8);
  denied(() => o.push(a, "overflow", 8), "quota exceeded");
  denied(() => o.restart("A"), "physical stack retirement required");
  o.unwind(a); o.retire(a);
  assert.equal(o.restart("A"), 2);
  denied(() => o.push(a, "stale"), "stale actor generation");
  const newer = o.receive("A");
  assert.notEqual(newer.stack, a.stack);
  o.retire(newer);
});

test("task quota includes suspended tasks, independent of DATA concurrency", () => {
  const o = fresh({maxTasks: 1});
  const p = o.receive("A");
  const t = o.spawnTask(p);
  o.suspend(t);
  denied(() => o.spawnTask(p), "task stack quota");
  o.unwind(t); o.retire(t);
  const t2 = o.spawnTask(p);
  o.retire(t2); o.retire(p);
});

test("invalid quotas, negative frame charge and unknown actor fail closed", () => {
  const o = new ReceiveStackOracle();
  denied(() => o.actor("A", {messageConcurrency: 0}), "invalid");
  denied(() => o.actor("A", {maxActorStackBytes: -1}), "invalid");
  o.actor("A");
  denied(() => o.actor("A"), "fresh actor ID");
  denied(() => o.receive("missing"), "unknown actor");
  const a = o.receive("A");
  denied(() => o.push(a, "bad", -1), "invalid frame byte charge");
  denied(() => o.push(a, "bad", 0), "invalid frame byte charge");
  assert.equal(o.stats("A").state, "ALIVE");
  o.retire(a);
});

test("suspended default receive cannot be replaced by a new stack on duplicate wake", () => {
  const o = fresh();
  const s = o.receive("A");
  const wake = o.suspend(s);
  denied(() => o.receive("A"), "slot occupied");
  o.resume(s, wake, "w2");
  const nextWake = o.suspend(s);
  denied(() => o.resume(s, wake, "w3"), "duplicate wake");
  o.resume(s, nextWake, "w3");
  o.retire(s);
});
