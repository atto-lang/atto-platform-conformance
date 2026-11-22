import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

// SOURCE-FREE POLICY ORACLE ONLY. This does not compile or execute AttoLang guest code.
const registry = JSON.parse(readFileSync(new URL("../contracts/actor-scheduling-policy-v1.json", import.meta.url), "utf8"));
const backends = ["java", "llvm", "wasm", "forge", "net"];

class SchedulingOracle {
  constructor({serial = false, max = "pool_size", affinity = "sticky", workers = 2,
    actorCap = 64, tenantCap = 64, globalCap = 64, domain = "shared", reserved = false} = {}) {
    if (!(max === "pool_size" || Number.isSafeInteger(max) && max >= 1))
      throw Error("E_ACTOR_PARALLELISM_CAP");
    if (!["none", "sticky", "pinned", "dedicated"].includes(affinity))
      throw Error("E_ACTOR_AFFINITY");
    if (serial && max !== 1) throw Error("E_SERIAL_PARALLELISM");
    if (["pinned", "dedicated"].includes(affinity) && max !== 1)
      throw Error("E_AFFINITY_REQUIRES_ONE");
    this.policy = {serial, max, affinity, actorCap, tenantCap, globalCap, domain, reserved};
    this.pool = Array.from({length: workers}, (_, id) => ({id, alive: true, domain}));
    this.running = new Map();
    this.suspended = new Map();
    this.liveReceives = 0;
    this.nextTicket = 1;
    this.generation = 1;
    this.home = null;
    this.stopped = false;
  }
  eligible() {
    return this.pool.filter(w => w.alive && w.domain === this.policy.domain);
  }
  cap() {
    const healthy = this.eligible().length;
    return Math.min(this.policy.max === "pool_size" ? healthy : this.policy.max,
      healthy, this.policy.actorCap, this.policy.tenantCap, this.policy.globalCap);
  }
  pickWorker() {
    if (this.policy.affinity === "dedicated" && !this.policy.reserved) return null;
    const free = this.eligible().filter(w => ![...this.running.values()].some(t => t.worker === w.id));
    if (["pinned", "dedicated"].includes(this.policy.affinity)) {
      const existingHome = this.home === null ? null : this.eligible().find(w => w.id === this.home);
      if (existingHome) return free.find(w => w.id === existingHome.id) ?? null;
      const replacement = free[0] ?? null;
      if (replacement) this.home = replacement.id;
      return replacement;
    }
    const choice = this.policy.affinity === "sticky"
      ? (free.find(w => w.id === this.home) ?? free[0]) : free[0];
    if (choice && this.home === null) this.home = choice.id;
    return choice ?? null;
  }
  start(kind = "receive", generation = this.generation) {
    if (this.stopped || generation !== this.generation || this.running.size >= this.cap()) return null;
    if (kind === "receive" && this.policy.serial && this.liveReceives > 0) return null;
    const worker = this.pickWorker();
    if (!worker) return null;
    const ticket = {id: this.nextTicket++, worker: worker.id, generation, kind};
    this.running.set(ticket.id, ticket);
    if (kind === "receive") this.liveReceives++;
    return ticket;
  }
  suspend(ticket) {
    if (ticket?.generation !== this.generation || !this.running.has(ticket.id)) return false;
    this.running.delete(ticket.id);
    this.suspended.set(ticket.id, ticket);
    return true;
  }
  resume(ticket) {
    if (this.stopped || ticket?.generation !== this.generation || !this.suspended.has(ticket.id)
      || this.running.size >= this.cap()) return null;
    const worker = this.pickWorker();
    if (!worker) return null;
    this.suspended.delete(ticket.id);
    ticket.worker = worker.id;
    this.running.set(ticket.id, ticket);
    return ticket;
  }
  finish(ticket) {
    if (ticket?.generation !== this.generation) return false;
    const exists = this.running.delete(ticket.id) || this.suspended.delete(ticket.id);
    if (exists && ticket.kind === "receive") this.liveReceives--;
    return exists;
  }
  resize(n) {
    assert.ok(Number.isSafeInteger(n) && n >= 0);
    while (this.pool.length < n) this.pool.push({id: this.pool.length, alive: true, domain: this.policy.domain});
    this.pool.forEach((w, i) => { w.alive = i < n; });
  }
  killWorker(id) {
    const w = this.pool.find(w => w.id === id);
    if (w) w.alive = false;
  }
  stop() { this.stopped = true; }
  restart() {
    this.generation++;
    this.running.clear();
    this.suspended.clear();
    this.liveReceives = 0;
    this.home = null;
    this.stopped = false;
  }
}

test("registry is explicit TARGET and every backend remains NOT EXECUTED", () => {
  assert.equal(registry.schema, "atto.actor-scheduling-policy.v1");
  assert.equal(registry.status, "TARGET_NOT_GUEST_EXECUTED");
  assert.equal(registry.cases.length, 26);
  assert.equal(new Set(registry.cases.map(c => c.id)).size, registry.cases.length);
  assert.deepEqual(Object.keys(registry.backends), backends);
  for (const c of registry.cases) {
    assert.equal(c.status, "not_executed", c.id);
    assert.ok(["runtime", "compile_reject"].includes(c.kind));
    assert.deepEqual(Object.keys(c.backend_statuses), backends);
    assert.ok(Object.values(c.backend_statuses).every(s => s === "not_executed"));
  }
  assert.equal(registry.rules.fixed_cap_min, 1);
  assert.equal(registry.rules.serial_live_receives, 1);
  assert.equal(registry.rules.serial_physical_max, 1);
  assert.equal(registry.rules.actor_owned_tasks_share_physical_cap, true);
  assert.equal(registry.receipt.source_free_model_is_guest_evidence, false);
  assert.equal(registry.receipt.zero_step, "not_executed");
});

test("fixed caps, healthy worker budgets and elastic pool size", () => {
  const fixed = new SchedulingOracle({max: 2, workers: 8});
  assert.equal(fixed.cap(), 2);
  assert.ok(fixed.start()); assert.ok(fixed.start("task"));
  assert.equal(fixed.start("method"), null);
  const elastic = new SchedulingOracle({workers: 1});
  assert.equal(elastic.cap(), 1);
  elastic.resize(8);
  assert.equal(elastic.cap(), 8);
  elastic.resize(2);
  assert.equal(elastic.cap(), 2);
  const quota = new SchedulingOracle({workers: 8, actorCap: 5, tenantCap: 3, globalCap: 4});
  assert.equal(quota.cap(), 3);
  assert.equal(new SchedulingOracle({workers: 0}).cap(), 0);
});

test("shrink drains existing work without new over-cap leases", () => {
  const o = new SchedulingOracle({workers: 4});
  const leases = [o.start(), o.start("task"), o.start("method"), o.start("task")];
  assert.ok(leases.every(Boolean));
  o.resize(1);
  assert.equal(o.cap(), 1);
  assert.equal(o.start("task"), null);
  for (const token of leases.slice(0, 3)) assert.equal(o.finish(token), true);
  assert.equal(o.start("method"), null);
  assert.equal(o.finish(leases[3]), true);
  assert.ok(o.start("method"));
});

test("serial receive retains logical permit over await; method can interleave, not overlap", () => {
  const o = new SchedulingOracle({serial: true, max: 1, workers: 4});
  const receive = o.start("receive");
  assert.ok(receive);
  assert.equal(o.start("receive"), null);
  assert.equal(o.start("method"), null);
  assert.equal(o.suspend(receive), true);
  assert.equal(o.liveReceives, 1);
  const method = o.start("method");
  assert.ok(method);
  assert.equal(o.resume(receive), null);
  assert.equal(o.finish(method), true);
  assert.ok(o.resume(receive));
  assert.equal(o.start("task"), null);
  assert.equal(o.finish(receive), true);
  assert.ok(o.start("receive"));
});

test("ordinary actor can concurrently run different stacks; child tasks share limit", () => {
  const o = new SchedulingOracle({workers: 3, max: 3});
  const a = o.start("receive"), b = o.start("receive"), t = o.start("task");
  assert.ok(a && b && t);
  assert.equal(new Set([a.worker, b.worker, t.worker]).size, 3);
  assert.equal(o.start("method"), null);
  o.finish(t); assert.ok(o.start("method"));
});

test("sticky prefers its original lane but permits bounded spill", () => {
  const o = new SchedulingOracle({max: 2, workers: 2, affinity: "sticky"});
  const first = o.start();
  const lane = first.worker;
  o.finish(first);
  assert.equal(o.start().worker, lane);
  assert.notEqual(o.start("task").worker, lane);
});

test("pinned reuses one worker until retirement then fenced re-pin", () => {
  const o = new SchedulingOracle({max: 1, workers: 2, affinity: "pinned"});
  const first = o.start();
  assert.ok(first); const lane = first.worker;
  o.finish(first);
  assert.equal(o.start("task").worker, lane);
  o.finish([...o.running.values()][0]);
  o.killWorker(lane);
  const replacement = o.start();
  assert.ok(replacement);
  assert.notEqual(replacement.worker, lane);
});

test("dedicated requires actual reservation; prohibited multi-carrier policies reject", () => {
  assert.equal(new SchedulingOracle({max: 1, affinity: "dedicated", reserved: false}).start(), null);
  assert.ok(new SchedulingOracle({max: 1, affinity: "dedicated", reserved: true}).start());
  assert.throws(() => new SchedulingOracle({serial: true, max: 2}), /E_SERIAL_PARALLELISM/);
  assert.throws(() => new SchedulingOracle({max: 2, affinity: "pinned"}), /E_AFFINITY_REQUIRES_ONE/);
  assert.throws(() => new SchedulingOracle({max: 0}), /E_ACTOR_PARALLELISM_CAP/);
  assert.throws(() => new SchedulingOracle({max: Number.MAX_SAFE_INTEGER + 1}), /E_ACTOR_PARALLELISM_CAP/);
});

test("domain isolation, stale generation and STOP prevent dispatch", () => {
  const o = new SchedulingOracle({workers: 2, domain: "untrusted"});
  const t = o.start();
  assert.ok(t);
  o.pool.forEach(w => { w.domain = "shared"; });
  assert.equal(o.cap(), 0);
  assert.equal(o.start(), null);
  o.pool.forEach(w => { w.domain = "untrusted"; });
  o.stop();
  assert.equal(o.start(), null);
  assert.equal(o.resume(t), null);
  o.restart();
  assert.equal(o.finish(t), false);
  assert.equal(o.start("task", t.generation), null);
  assert.ok(o.start("task"));
});

test("single-threaded host cap dominates elastic actor without changing declaration", () => {
  const o = new SchedulingOracle({workers: 8, globalCap: 1});
  assert.equal(o.cap(), 1);
  assert.ok(o.start());
  assert.equal(o.start(), null);
  assert.equal(o.policy.serial, false);
});

test("declaration/spawn policy may narrow but never increase authority", () => {
  function override(declared, requested) {
    if (declared === 1 && requested !== 1) throw Error("E_POLICY_ESCALATION");
    if (typeof declared === "number" && (requested === "pool_size" || requested > declared))
      throw Error("E_POLICY_ESCALATION");
    return requested;
  }
  assert.equal(override("pool_size", 2), 2);
  assert.equal(override(3, 2), 2);
  assert.throws(() => override(1, 2), /E_POLICY_ESCALATION/);
  assert.throws(() => override(2, "pool_size"), /E_POLICY_ESCALATION/);
});
