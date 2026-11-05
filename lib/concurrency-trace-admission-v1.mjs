// Source-free trace consistency oracle. NOT an AttoLang compiler, runner, or proof verifier.
// Every field is caller-supplied; a passing trace is an UNAUTHENTICATED candidate only.
export const BACKENDS = Object.freeze(["java-graal", "llvm", "net", "wasm", "cranelift"]);
const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const KINDS = Object.freeze({
  "critical.enter": ["lock", "task"],
  "critical.queue": ["lock", "task"],
  "critical.try": ["lock", "task", "outcome"],
  "critical.cancel": ["lock", "task"],
  "critical.exit": ["lock", "task"],
  "critical.grant": ["lock", "task"],
  "actor.open": ["actor", "generation"],
  "actor.start": ["actor", "generation", "task"],
  "actor.queue": ["actor", "generation", "task"],
  "actor.suspend": ["actor", "generation", "task"],
  "actor.resume": ["actor", "generation", "task"],
  "actor.finish": ["actor", "generation", "task"],
  "actor.control-stop": ["actor", "generation"],
  "select.open": ["select", "generation"],
  "select.arm": ["select", "generation", "arm"],
  "select.win": ["select", "generation", "arm", "outcome"],
  "select.publish": ["select", "generation", "arm"],
  "select.wake": ["select", "generation"],
  "select.close": ["select", "generation"],
  "scope.open": ["scope"],
  "scope.cancel": ["scope"],
  "scope.close": ["scope"],
  "task.spawn": ["scope", "task"],
  "task.terminal": ["scope", "task"],
  "task.quiesce": ["scope", "task"],
  "task.retire": ["scope", "task"]
});
const requireCondition = (ok, reason) => { if (!ok) throw Error(reason); };
const named = value => typeof value === "string" && ID.test(value);
const generation = value => Number.isSafeInteger(value) && value > 0;
const fresh = (map, key, max, description) => {
  requireCondition(!map.has(key), "duplicate " + description);
  requireCondition(map.size < max, description + " quota");
};
const get = (map, key, description) => {
  requireCondition(map.has(key), "unknown " + description);
  return map.get(key);
};
function validateEvent(e, index) {
  requireCondition(e !== null && typeof e === "object" && !Array.isArray(e), "malformed event");
  requireCondition(Object.hasOwn(KINDS, e.kind), "unknown event kind");
  requireCondition(e.seq === index + 1, "noncontiguous event sequence");
  const expected = new Set(["kind", "seq", ...KINDS[e.kind]]);
  requireCondition(Object.keys(e).length === expected.size &&
    Object.keys(e).every(k => expected.has(k)), "unexpected or missing event fields");
  for (const key of KINDS[e.kind]) {
    if (key === "generation") requireCondition(generation(e[key]), "invalid generation");
    else if (key === "outcome") requireCondition(
      e.kind === "critical.try" ? ["busy", "granted"].includes(e[key]) :
        ["success", "failure"].includes(e[key]), "invalid outcome");
    else requireCondition(named(e[key]), "invalid " + key);
  }
}
export function evaluateConcurrencyTrace(input) {
  let index = -1;
  try {
    requireCondition(input && typeof input === "object" && !Array.isArray(input), "invalid input");
    requireCondition(BACKENDS.includes(input.backend), "unknown backend");
    requireCondition(Object.keys(input).length === 2 &&
      Object.hasOwn(input, "events"), "unsupported input fields");
    requireCondition(Array.isArray(input.events) && input.events.length > 0 &&
      input.events.length <= 512, "event count invalid or over quota");
    const locks = new Map(), actors = new Map(), selects = new Map();
    const scopes = new Map(), tasks = new Map();
    const lockFor = id => {
      if (!locks.has(id)) {
        fresh(locks, id, 128, "critical lock");
        locks.set(id, {owner: null, queue: []});
      }
      return locks.get(id);
    };
    const taskKey = e => e.scope + "/" + e.task;
    for (index = 0; index < input.events.length; index++) {
      const e = input.events[index];
      validateEvent(e, index);
      if (e.kind.startsWith("critical.")) {
        const l = lockFor(e.lock);
        if (e.kind === "critical.enter") {
          requireCondition(l.owner === null && l.queue.length === 0, "unfair or concurrent critical enter");
          requireCondition(![...locks.values()].some(other => other.owner === e.task),
            "nested critical owner across guards");
          l.owner = e.task;
        } else if (e.kind === "critical.queue") {
          requireCondition(l.owner !== null || l.queue.length > 0, "critical queue without contention");
          requireCondition(l.owner !== e.task && !l.queue.includes(e.task), "duplicate critical waiter");
          requireCondition(l.queue.length < 64, "critical queue saturated");
          l.queue.push(e.task);
        } else if (e.kind === "critical.try") {
          const available = l.owner === null && l.queue.length === 0;
          requireCondition(e.outcome === (available ? "granted" : "busy"), "incorrect try critical outcome");
          if (available) {
            requireCondition(![...locks.values()].some(other => other.owner === e.task),
              "nested critical try across guards");
            l.owner = e.task;
          }
        } else if (e.kind === "critical.cancel") {
          const at = l.queue.indexOf(e.task);
          requireCondition(at >= 0, "cancel of unqueued critical waiter");
          l.queue.splice(at, 1);
        } else if (e.kind === "critical.exit") {
          requireCondition(l.owner === e.task, "nonowner critical release");
          l.owner = null;
        } else if (e.kind === "critical.grant") {
          requireCondition(l.owner === null && l.queue[0] === e.task, "critical grant bypasses FIFO");
          l.queue.shift();
          l.owner = e.task;
        }
      } else if (e.kind.startsWith("actor.")) {
        if (e.kind === "actor.open") {
          fresh(actors, e.actor, 128, "actor");
          actors.set(e.actor, {generation:e.generation, owner:null, phase:null, queue:[]});
          continue;
        }
        const a = get(actors, e.actor, "actor");
        requireCondition(a.generation === e.generation, "stale actor generation");
        if (e.kind === "actor.queue") {
          requireCondition(a.owner !== null && a.owner !== e.task &&
            !a.queue.includes(e.task), "invalid actor queue");
          requireCondition(a.queue.length < 64, "actor queue saturated");
          a.queue.push(e.task);
        } else if (e.kind === "actor.start") {
          requireCondition(a.owner === null, "actor handler reentrancy");
          if (a.queue.length) requireCondition(a.queue.shift() === e.task, "actor DATA FIFO violated");
          a.owner = e.task; a.phase = "running";
        } else if (e.kind === "actor.control-stop") {
          // CONTROL may signal shutdown while DATA remains logically reserved.
        } else {
          requireCondition(a.owner === e.task, "actor turn owner mismatch");
          if (e.kind === "actor.suspend") {
            requireCondition(a.phase === "running", "invalid actor suspension");
            a.phase = "suspended";
          } else if (e.kind === "actor.resume") {
            requireCondition(a.phase === "suspended", "invalid actor resume");
            a.phase = "running";
          } else if (e.kind === "actor.finish") {
            requireCondition(a.phase === "running", "actor finish before resume");
            a.owner = null; a.phase = null;
          }
        }
      } else if (e.kind.startsWith("select.")) {
        if (e.kind === "select.open") {
          const prior = selects.get(e.select);
          requireCondition(!prior || (prior.closed && e.generation > prior.generation), "select generation not retired");
          if (!prior) fresh(selects, e.select, 128, "select");
          selects.set(e.select, {generation:e.generation, closed:false, arms:new Set(),
            winner:null, outcome:null, published:false, woke:false});
          continue;
        }
        const s = get(selects, e.select, "select");
        requireCondition(!s.closed && s.generation === e.generation, "stale or closed select");
        if (e.kind === "select.arm") {
          requireCondition(s.winner === null && !s.arms.has(e.arm), "late or duplicate select arm");
          requireCondition(s.arms.size < 64, "select arm quota");
          s.arms.add(e.arm);
        } else if (e.kind === "select.win") {
          requireCondition(s.winner === null && s.arms.has(e.arm), "duplicate or foreign select winner");
          s.winner = e.arm; s.outcome = e.outcome;
        } else if (e.kind === "select.publish") {
          requireCondition(s.winner === e.arm && s.outcome === "success" && !s.published,
            "losing select arm published or duplicate publication");
          s.published = true;
        } else if (e.kind === "select.wake") {
          requireCondition(s.winner !== null && !s.woke &&
            (s.outcome === "failure" || s.published), "early or duplicate select wake");
          s.woke = true;
        } else if (e.kind === "select.close") {
          requireCondition(s.winner === null ? !s.published && !s.woke :
            s.woke && (s.outcome === "failure" || s.published), "select not settled");
          s.closed = true;
        }
      } else if (e.kind.startsWith("scope.")) {
        if (e.kind === "scope.open") {
          fresh(scopes, e.scope, 128, "scope");
          scopes.set(e.scope, {closed:false, cancel:false});
          continue;
        }
        const s = get(scopes, e.scope, "scope");
        requireCondition(!s.closed, "closed scope mutation");
        if (e.kind === "scope.cancel") {
          requireCondition(!s.cancel, "duplicate scope cancellation");
          s.cancel = true;
        } else if (e.kind === "scope.close") {
          requireCondition([...tasks.values()].every(t => t.scope !== e.scope || t.retired),
            "scope closed before physical task retirement");
          s.closed = true;
        }
      } else {
        const s = get(scopes, e.scope, "scope");
        const key = taskKey(e);
        if (e.kind === "task.spawn") {
          requireCondition(!s.closed && !s.cancel, "task admission after scope cancel/close");
          fresh(tasks, key, 256, "scope child task");
          tasks.set(key, {scope:e.scope, terminal:false, quiescent:false, retired:false});
        } else {
          const t = get(tasks, key, "scope child task");
          requireCondition(!t.retired, "task mutated after retirement");
          if (e.kind === "task.terminal") {
            requireCondition(!t.terminal, "duplicate task terminal");
            t.terminal = true;
          } else if (e.kind === "task.quiesce") {
            requireCondition(!t.quiescent, "duplicate physical quiescence");
            t.quiescent = true;
          } else if (e.kind === "task.retire") {
            requireCondition(t.terminal && t.quiescent, "task retired before terminal plus quiescence");
            t.retired = true;
          }
        }
      }
    }
    requireCondition([...locks.values()].every(l=>l.owner === null && l.queue.length === 0), "critical lock not drained");
    requireCondition([...actors.values()].every(a=>a.owner === null && a.queue.length === 0), "actor turn not drained");
    requireCondition([...selects.values()].every(s=>s.closed), "select not closed");
    requireCondition([...scopes.values()].every(s=>s.closed), "scope not closed");
    requireCondition([...tasks.values()].every(t=>t.retired), "task not physically retired");
    return {classification:"CONSISTENT_REFERENCE_TRACE_ONLY", events:input.events.length,
      backend:input.backend, compiler_executed:false, guest_executed:false,
      semantic_parity_certified:false, source_transfer_authorized:false};
  } catch (error) {
    return {classification:"TRACE_REJECTED", index, reason:String(error.message),
      compiler_executed:false, guest_executed:false, semantic_parity_certified:false};
  }
}
