import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

// SOURCE-FREE POLICY ORACLE ONLY. This does not compile or execute AttoLang guest code.
const registry = JSON.parse(readFileSync(new URL("../contracts/actor-scheduling-policy-v1.json", import.meta.url), "utf8"));
const backends = ["java", "llvm", "wasm", "forge", "net"];

class SchedulingOracle {
  constructor({serial = false, max = "pool_size", receives = serial ? 1 : 64, affinity = "sticky", workers = 2,
    actorCap = 64, tenantCap = 64, globalCap = 64, domain = "shared", reserved = false} = {}) {
    if (!(max === "pool_size" || Number.isSafeInteger(max) && max >= 1))
      throw Error("E_ACTOR_PARALLELISM_CAP");
    if (!["none", "sticky", "pinned", "dedicated"].includes(affinity))
      throw Error("E_ACTOR_AFFINITY");
    if (!Number.isSafeInteger(receives) || receives < 1) throw Error("E_ACTOR_RECEIVE_LIMIT");
    if (serial && (max !== 1 || receives !== 1)) throw Error("E_SERIAL_PARALLELISM");
    if (["pinned", "dedicated"].includes(affinity) && max !== 1)
      throw Error("E_AFFINITY_REQUIRES_ONE");
    this.policy = {serial, max, receives, affinity, actorCap, tenantCap, globalCap, domain, reserved};
    this.pool = [];
    this.workerGenerations = new Map();
    this.running = new Map();
    this.suspended = new Map();
    this.liveReceives = 0;
    this.nextTicket = 1;
    this.generation = 1;
    this.home = null;
    this.stopped = false;
    this.resize(workers);
  }
  eligible() {
    return this.pool.filter(w => w.alive && w.domain === this.policy.domain);
  }
  cap() {
    if (this.stopped) return 0;
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
    if (kind === "receive" && this.liveReceives >= this.policy.receives) return null;
    const worker = this.pickWorker();
    if (!worker) return null;
    const ticket = {id: this.nextTicket++, worker: worker.id, workerGeneration: worker.generation,
      generation, kind};
    this.running.set(ticket.id, ticket);
    if (kind === "receive") this.liveReceives++;
    return ticket;
  }
  suspend(ticket) {
    if (ticket?.generation !== this.generation || this.running.get(ticket.id) !== ticket) return false;
    this.running.delete(ticket.id);
    this.suspended.set(ticket.id, ticket);
    return true;
  }
  resume(ticket) {
    if (this.stopped || ticket?.generation !== this.generation || this.suspended.get(ticket.id) !== ticket
      || this.running.size >= this.cap()) return null;
    const worker = this.pickWorker();
    if (!worker) return null;
    this.suspended.delete(ticket.id);
    ticket.worker = worker.id;
    ticket.workerGeneration = worker.generation;
    this.running.set(ticket.id, ticket);
    return ticket;
  }
  finish(ticket) {
    if (ticket?.generation !== this.generation ||
        (this.running.get(ticket.id) !== ticket && this.suspended.get(ticket.id) !== ticket)) return false;
    this.running.delete(ticket.id);
    this.suspended.delete(ticket.id);
    if (ticket.kind === "receive") this.liveReceives--;
    return true;
  }
  resize(n) {
    assert.ok(Number.isSafeInteger(n) && n >= 0);
    this.replaceWorkers(Array.from({length: n}, (_, id) =>
      ({id, generation: this.workerGenerations.get(id) ?? 1})));
  }
  replaceWorkers(workers) {
    if (this.stopped) throw Error("E_ACTOR_STOPPED");
    const next = new Map();
    for (const {id, generation} of workers) {
      if (!Number.isSafeInteger(id) || id < 0 || next.has(id) ||
          !Number.isSafeInteger(generation) || generation < 1)
        throw Error("E_INVALID_WORKER_GENERATION");
      if (generation < (this.workerGenerations.get(id) ?? 0))
        throw Error("E_STALE_WORKER_INVENTORY");
      next.set(id, {id, generation, alive: true, domain: this.policy.domain});
    }
    for (const worker of next.values()) this.workerGenerations.set(worker.id, worker.generation);
    this.pool = [...next.values()];
  }
  killWorker(id) {
    const w = this.pool.find(w => w.id === id);
    if (w) w.alive = false;
  }
  stop() { this.stopped = true; }
  restart() {
    if (!this.stopped || this.running.size !== 0) throw Error("E_PHYSICAL_LEASES_OUTSTANDING");
    this.generation++;
    this.suspended.clear();
    this.liveReceives = 0;
    this.home = null;
    this.stopped = false;
  }
}

test("registry is explicit TARGET and every backend remains NOT EXECUTED", () => {
  assert.equal(registry.schema, "atto.actor-scheduling-policy.v1");
  assert.equal(registry.status, "TARGET_NOT_GUEST_EXECUTED");
  assert.equal(registry.cases.length, 28);
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
  assert.equal(registry.rules.ordinary_concurrent_default, true);
  assert.equal(registry.rules.ordinary_receive_interleaving, "REENTRANT_WITH_BOUNDED_LIVE_LIMIT");
  assert.equal(registry.rules.worker_inventory, "MONOTONIC_GENERATION_PER_AUTHORIZED_POOL_SLOT");
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

test("ordinary actor may admit a second receive while the first is suspended by default", () => {
  const o = new SchedulingOracle({workers: 1});
  const first = o.start();
  assert.ok(first);
  assert.equal(o.suspend(first), true);
  assert.equal(o.running.size, 0);
  const second = o.start();
  assert.ok(second);
  assert.notEqual(first.id, second.id);
  assert.equal(o.liveReceives, 2);
  assert.equal(o.resume(first), null);
  assert.equal(o.finish(second), true);
  assert.equal(o.resume(first), first);
  assert.equal(o.finish(first), true);
});

test("ordinary actor with explicit receive concurrency runs different stacks within the physical cap", () => {
  const o = new SchedulingOracle({workers: 3, max: 3, receives: 2});
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
  assert.throws(() => new SchedulingOracle({serial: true, max: 1, receives: 2}), /E_SERIAL_PARALLELISM/);
  assert.throws(() => new SchedulingOracle({max: 2, affinity: "pinned"}), /E_AFFINITY_REQUIRES_ONE/);
  assert.throws(() => new SchedulingOracle({max: 0}), /E_ACTOR_PARALLELISM_CAP/);
  assert.throws(() => new SchedulingOracle({max: Number.MAX_SAFE_INTEGER + 1}), /E_ACTOR_PARALLELISM_CAP/);
});

test("domain isolation, stale generation and STOP prevent dispatch", () => {
  const o = new SchedulingOracle({workers: 2, domain: "untrusted"});
  const t = o.start();
  assert.ok(t);
  assert.equal(o.suspend({...t}), false);
  assert.equal(o.finish({...t}), false);
  o.pool.forEach(w => { w.domain = "shared"; });
  assert.equal(o.cap(), 0);
  assert.equal(o.start(), null);
  o.pool.forEach(w => { w.domain = "untrusted"; });
  o.stop();
  assert.equal(o.cap(), 0);
  assert.equal(o.start(), null);
  assert.equal(o.resume(t), null);
  assert.throws(() => o.restart(), /E_PHYSICAL_LEASES_OUTSTANDING/);
  assert.equal(o.finish(t), true);
  o.restart();
  assert.equal(o.finish(t), false);
  assert.equal(o.start("task", t.generation), null);
  assert.ok(o.start("task"));
});

test("worker replacement rejects a stale inventory and waits for physical retirement", () => {
  const o = new SchedulingOracle({workers: 0});
  o.replaceWorkers([{id: 0, generation: 7}]);
  const retiring = o.start("method");
  assert.equal(retiring.workerGeneration, 7);
  o.replaceWorkers([{id: 0, generation: 8}]);
  assert.equal(o.start("method"), null);
  o.replaceWorkers([]);
  assert.throws(() => o.replaceWorkers([{id: 0, generation: 7}, {id: 1, generation: 10}]),
    /E_STALE_WORKER_INVENTORY/);
  assert.equal(o.cap(), 0);
  assert.equal(o.running.size, 1);
  o.replaceWorkers([{id: 0, generation: 8}, {id: 1, generation: 9}]);
  assert.equal(o.cap(), 2);
  assert.equal(o.finish(retiring), true);
  const replacement = o.start("method");
  assert.equal(replacement.worker, 0);
  assert.equal(replacement.workerGeneration, 8);
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

test("target .atto policy fixtures are linked, fail closed and not reported as compiled", () => {
  assert.equal(registry.fixture_status, "TARGET_ONLY_NEVER_COMPILED_OR_EXECUTED");
  const linked = registry.cases.filter(c => c.source);
  assert.equal(linked.length, 5);
  assert.equal(new Set(linked.map(c => c.source)).size, 5);
  for (const c of linked) {
    assert.match(c.source, /^fixtures\/actor-scheduling-policy-v1\/[a-z0-9_]+\.atto$/);
    const source = readFileSync(new URL("../" + c.source, import.meta.url), "utf8");
    assert.match(source, /^\/\/ TARGET/);
    assert.match(source, /@actor_schedule\(/);
    assert.match(source, /define (serial )?actor/);
    assert.equal(c.status, "not_executed");
    if (c.kind === "compile_reject") {
      assert.ok(c.expected_diagnostic?.startsWith("E_"));
      assert.match(source, /COMPILE REJECT/);
    }
  }
  const override = linked.find(c => c.id === "override-only-narrows");
  assert.ok(override);
  assert.match(readFileSync(new URL("../" + override.source, import.meta.url), "utf8"), /spawn Worker\(\) with schedule\(/);
});

test("suspended receives consume logical capacity independently of carrier availability", () => {
  const o = new SchedulingOracle({workers: 1, max: 1, receives: 2});
  const first = o.start();
  assert.ok(first);
  assert.equal(o.suspend(first), true);
  const second = o.start();
  assert.ok(second);
  assert.equal(o.suspend(second), true);
  assert.equal(o.running.size, 0);
  assert.equal(o.liveReceives, 2);
  assert.equal(o.start(), null);
  const unrelated = o.start("method");
  assert.ok(unrelated);
  assert.equal(o.finish(unrelated), true);
  assert.equal(o.finish(first), true);
  assert.equal(o.finish(first), false);
  assert.equal(o.resume(first), null);
  assert.equal(o.liveReceives, 1);
  const third = o.start();
  assert.ok(third);
  assert.equal(o.resume(second), null);
  assert.equal(o.finish(third), true);
  assert.equal(o.resume(second), second);
  assert.equal(o.finish(second), true);
  assert.equal(o.liveReceives, 0);
});

test("retiring a suspended sibling does not revoke a running invocation", () => {
  const o = new SchedulingOracle({workers: 1, max: 1, receives: 2});
  const suspended = o.start();
  assert.ok(suspended);
  assert.equal(o.suspend(suspended), true);
  const running = o.start();
  assert.ok(running);
  assert.equal(o.finish(suspended), true);
  assert.equal(o.running.get(running.id), running);
  assert.equal(o.liveReceives, 1);
  assert.equal(o.resume(suspended), null);
  assert.equal(o.finish({...running}), false);
  assert.equal(o.start(), null);
  assert.equal(o.finish(running), true);
  assert.equal(o.liveReceives, 0);
});

test("serial receive cannot admit another DATA receive after a suspend and pool expansion", () => {
  const o = new SchedulingOracle({serial: true, max: 1, workers: 1});
  const a = o.start();
  assert.ok(a);
  assert.equal(o.suspend(a), true);
  o.resize(8);
  assert.equal(o.cap(), 1);
  assert.equal(o.start(), null);
  assert.equal(o.resume(a), a);
  assert.equal(o.finish(a), true);
  const b = o.start();
  assert.ok(b);
  assert.equal(o.finish(a), false);
  assert.equal(o.finish(b), true);
});


// Source-free cancellation lifecycle oracle. The retirement witness models
// scheduler authority, not a claim that any backend provides that witness.
function verifyCancellationRetirement(unsafeEarlyRelease = false) {
  const actor = new SchedulingOracle({serial: true, max: 1, workers: 1});
  const turn = actor.start();
  const pending = new Set();
  const retired = new Set();
  let loans = 2;
  const request = t => {
    if (actor.running.get(t.id) !== t && actor.suspended.get(t.id) !== t) return false;
    pending.add(t);
    if (unsafeEarlyRelease) actor.finish(t);
    return true;
  };
  const acknowledge = t => {
    if (!pending.has(t) || !retired.has(t) || loans !== 0) return false;
    if (!actor.finish(t)) return false;
    pending.delete(t);
    retired.delete(t);
    return true;
  };
  assert.equal(request(turn), true);
  assert.equal(request(turn), true);
  assert.equal(actor.liveReceives, 1);
  assert.equal(actor.start(), null);
  assert.equal(acknowledge(turn), false);
  assert.equal(actor.running.get(turn.id), turn);
  loans--;
  assert.equal(acknowledge(turn), false);
  loans--;
  assert.equal(acknowledge(turn), false); // zero loans is not carrier retirement
  retired.add(turn);
  assert.equal(acknowledge({...turn}), false);
  assert.equal(acknowledge(turn), true);
  assert.equal(acknowledge(turn), false);
  assert.equal(request(turn), false);
  const next = actor.start();
  assert.ok(next);
  assert.notEqual(next.id, turn.id);
  assert.equal(actor.finish(next), true);
}

test("cancel request retains actor admission until unwind and retirement", () => {
  verifyCancellationRetirement();
});

test("cancellation oracle detects premature logical retirement mutation", () => {
  assert.throws(() => verifyCancellationRetirement(true));
});


// Source-free readiness oracle only. A ready signal is not redemption or
// carrier admission authority; terminal records are independently bounded.
async function verifyTerminalReadiness(dropWake = false) {
  const parent = {ready: [], pending: null, retired: false};
  const unrelated = {ready: [], pending: null, retired: false};
  const wait = p => {
    if (p.retired) throw Error('E_STALE_PARENT');
    if (p.ready.length) return Promise.resolve(true);
    if (!p.pending) {
      let signal;
      const promise = new Promise(resolve => { signal = resolve; });
      p.pending = {promise, signal};
    }
    return p.pending.promise;
  };
  const publish = (p, ticket) => {
    if (p.retired) throw Error('E_STALE_PARENT');
    p.ready.push(ticket);
    const pending = p.pending;
    p.pending = null;
    if (!dropWake) pending?.signal(true);
  };
  const take = p => {
    if (p.retired) throw Error('E_STALE_PARENT');
    return p.ready.shift() ?? null;
  };
  const close = p => {
    assert.equal(p.ready.length, 0);
    p.retired = true;
    p.pending?.signal(false);
    p.pending = null;
  };
  const first = wait(parent);
  assert.equal(wait(parent), first);
  const other = wait(unrelated);
  let signaled = false;
  first.then(value => { signaled = value; });
  publish(parent, 'child:1');
  publish(parent, 'child:2');
  await Promise.resolve();
  assert.equal(signaled, true);
  assert.equal(await wait(parent), true);
  assert.equal(take(unrelated), null);
  assert.equal(take(parent), 'child:1');
  assert.equal(await wait(parent), true);
  assert.equal(take(parent), 'child:2');
  assert.equal(take(parent), null);
  const rearmed = wait(parent);
  assert.notEqual(rearmed, first);
  publish(parent, 'child:3');
  assert.equal(await rearmed, true);
  assert.equal(take(parent), 'child:3');
  const final = wait(parent);
  close(parent);
  close(unrelated);
  assert.equal(await final, false);
  assert.equal(await other, false);
  assert.throws(() => wait(parent), /E_STALE_PARENT/);
}

test("reserved supervisor terminal readiness coalesces, rearms and fences retired parents", async () => {
  await verifyTerminalReadiness();
});

test("terminal readiness oracle detects deliberately lost wakeup", async () => {
  await assert.rejects(() => verifyTerminalReadiness(true));
});
