import test from "node:test";
import assert from "node:assert/strict";
import { BorrowOracle, BorrowViolation } from "../lib/logical-borrow-critical-oracle.mjs";

const denied = (fn, message) => assert.throws(fn, e =>
  e instanceof BorrowViolation && (!message || e.message.includes(message)));

test("two tasks on one carrier do not inherit each other's owned memory", () => {
  const o = new BorrowOracle();
  o.principal("a"); o.principal("b");
  o.region("r", "a", {send:true});
  o.migrateCarrier("a", "thread-1"); o.migrateCarrier("b", "thread-1");
  assert.equal(o.use("a", "r", "write"), "LOCK_FREE");
  denied(() => o.use("b", "r", "read"), "no access capability");
});

test("two threads with disjoint unique ownership both run lock-free", () => {
  const o = new BorrowOracle();
  o.principal("a"); o.principal("b");
  o.region("ra", "a"); o.region("rb", "b");
  o.migrateCarrier("a", "thread-1"); o.migrateCarrier("b", "thread-2");
  assert.equal(o.use("a", "ra", "write"), "LOCK_FREE");
  assert.equal(o.use("b", "rb", "write"), "LOCK_FREE");
});

test("actor private state never leaks to its spawned task or another turn", () => {
  const o = new BorrowOracle();
  o.principal("actor", "actor"); o.principal("child");
  o.region("state", "actor", {actorState:true,send:true});
  denied(() => o.use("actor", "state", "write"), "actor turn not admitted");
  o.turnStart("actor", "turn-1", "carrier-1");
  assert.equal(o.use("actor", "state", "write"), "LOCK_FREE");
  denied(() => o.use("child", "state", "read"), "sealed actor state");
  denied(() => o.move("state", "actor", "child", 1), "not transferable");
  denied(() => o.turnStart("actor", "turn-2", "carrier-2"), "overlap");
  o.migrateCarrier("actor", "carrier-3");
  assert.equal(o.use("actor", "state", "read"), "LOCK_FREE");
  o.turnEnd("actor", "turn-1");
  denied(() => o.use("actor", "state", "read"), "actor turn not admitted");
});

test("task creates actor by consuming Send allocation, not sharing parent authority", () => {
  const o = new BorrowOracle();
  o.principal("parent"); o.principal("new-actor", "actor");
  o.region("init", "parent", {send:true});
  assert.equal(o.move("init", "parent", "new-actor", 1), 2);
  denied(() => o.use("parent", "init", "read"), "no access capability");
  o.turnStart("new-actor", "t", "thread-2");
  assert.equal(o.use("new-actor", "init", "write"), "LOCK_FREE");
  denied(() => o.move("init", "new-actor", "parent", 1), "stale generation");
  o.turnEnd("new-actor", "t");
});

test("unknown Send/Sync wrappers do not become movable or immutable shared", () => {
  const o = new BorrowOracle();
  o.principal("a"); o.principal("b"); o.region("rc", "a");
  denied(() => o.move("rc", "a", "b", 1), "Send");
  denied(() => o.share("rc", "a", "b", "read"), "Sync");
  denied(() => o.share("rc", "a", "b", "guarded"), "Send+Sync");
});

test("immutable Sync sharing permits reads, never writable aliases", () => {
  const o = new BorrowOracle();
  o.principal("a"); o.principal("b");
  o.region("mut", "a", {sync:true});
  denied(() => o.share("mut", "a", "b", "read"), "immutable Sync");
  o.region("fixed", "a", {immutable:true,sync:true});
  o.share("fixed", "a", "b", "read");
  assert.equal(o.use("b", "fixed", "read"), "LOCK_FREE");
  denied(() => o.use("b", "fixed", "write"));
  denied(() => o.use("a", "fixed", "write"), "write conflicts");
});

test("shared mutable region has a logical per-resource RW guard", () => {
  const o = new BorrowOracle();
  for (const p of ["a","b","c"]) o.principal(p);
  o.region("shared", "a", {send:true,sync:true});
  o.share("shared", "a", "b", "guarded");
  o.share("shared", "a", "c", "guarded");
  denied(() => o.use("a", "shared", "write"), "requires critical");
  denied(() => o.use("b", "shared", "read"), "no access capability");
  const ra = o.enterCritical("a", "shared", "read");
  const rb = o.enterCritical("b", "shared", "read");
  assert.equal(o.use("b", "shared", "read"), "GUARDED");
  denied(() => o.use("b", "shared", "write"), "write under read guard");
  denied(() => o.enterCritical("c", "shared", "write"), "active");
  o.exitCritical("a", ra); o.exitCritical("b", rb);
  const wc = o.enterCritical("c", "shared", "write");
  assert.equal(o.use("c", "shared", "write"), "GUARDED");
  denied(() => o.enterCritical("a", "shared", "read"), "writer active");
  denied(() => o.exitCritical("b", wc), "foreign");
  o.exitCritical("c", wc);
  denied(() => o.exitCritical("c", wc), "released");
});

test("nested critical/read-to-write upgrade fails closed", () => {
  const o = new BorrowOracle();
  o.principal("a"); o.principal("b");
  o.region("r", "a", {send:true,sync:true});
  o.share("r", "a", "b", "guarded");
  const read = o.enterCritical("a", "r", "read");
  denied(() => o.enterCritical("a", "r", "write"), "nested");
  denied(() => o.enterCritical("a", "r", "read"), "nested");
  o.exitCritical("a", read);
});

test("guard may not cross await/cooperate, carrier migration, or physical retirement", () => {
  const o = new BorrowOracle();
  o.principal("a"); o.principal("b");
  o.region("r", "a", {send:true,sync:true});
  o.share("r", "a", "b", "guarded");
  const guard = o.enterCritical("a", "r", "write");
  denied(() => o.suspend("a"), "cannot cross suspension");
  denied(() => o.migrateCarrier("a", "thread-3"), "cannot cross suspension");
  denied(() => o.retire("a"), "live guard");
  o.exitCritical("a", guard);
  o.migrateCarrier("a", "thread-3");
});

test("scoped read loan stays live after cancellation until physical retirement", () => {
  const o = new BorrowOracle();
  o.principal("parent"); o.principal("child");
  o.region("root", "parent", {sync:true});
  o.scopedRead("root", "parent", "child", "compiler-scope");
  assert.equal(o.use("child", "root", "read"), "SCOPED_READ");
  denied(() => o.use("parent", "root", "write"), "live read loan");
  denied(() => o.use("child", "root", "write"));
  o.cancel("child");
  denied(() => o.use("child", "root", "read"), "canceled");
  denied(() => o.use("parent", "root", "write"), "live read loan");
  o.retire("child");
  assert.equal(o.use("parent", "root", "write"), "LOCK_FREE");
});

test("scoped reads cannot smuggle actor state, non-Sync, or guarded data", () => {
  const o = new BorrowOracle();
  o.principal("actor", "actor"); o.principal("child"); o.principal("peer");
  o.region("state", "actor", {actorState:true,sync:true});
  o.turnStart("actor", "turn", "thread");
  denied(() => o.scopedRead("state", "actor", "child", "scope"), "Sync referent");
  o.region("unsafe", "actor");
  denied(() => o.scopedRead("unsafe", "actor", "child", "scope"), "Sync referent");
  o.region("protected", "actor", {send:true,sync:true});
  o.share("protected", "actor", "peer", "guarded");
  denied(() => o.scopedRead("protected", "actor", "child", "scope"), "guarded region");
  o.turnEnd("actor", "turn");
});
