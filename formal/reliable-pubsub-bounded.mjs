// Source-free bounded model of reliable publisher/subscription admission.
// This does not execute .atto code or establish compiler/backend parity.
const MAX_SEQUENCE = 2;
const MAX_GENERATION = 2;
const CAPACITY = 1;
function copy(s) { return JSON.parse(JSON.stringify(s)); }
function key(s) { return JSON.stringify(s); }
function requireSafe(ok, why, s) { if (!ok) throw new Error(why + "\nstate=" + key(s)); }
function item(p, seq, gen) { return { p, seq, gen, id: gen + ":" + p + ":" + seq }; }
function begin(s, publisher, mutant) {
  if (!s.active || s.pending[publisher] || s.next[publisher] > MAX_SEQUENCE) return null;
  const n = copy(s);
  const m = item(publisher, n.next[publisher]++, n.generation);
  if (n.queue.length < CAPACITY) {
    n.queue.push(m);
    n.accepted.push(m);
    n.acked.push(m.id);
  } else {
    n.pending[publisher] = m; // backpressure is not an acknowledgement.
    if (mutant === "early-ack") n.acked.push(m.id);
  }
  return n;
}
function admit(s) {
  if (!s.active || s.queue.length >= CAPACITY) return [];
  const out = [];
  for (let p = 0; p < 2; p++) {
    if (!s.pending[p]) continue;
    const n = copy(s);
    const m = n.pending[p];
    n.pending[p] = null;
    n.queue.push(m);
    n.accepted.push(m);
    n.acked.push(m.id);
    out.push(["admit-pending-" + p, n]);
  }
  return out;
}
function deliver(s) {
  if (!s.active || s.queue.length === 0) return null;
  const n = copy(s);
  const m = n.queue.shift();
  n.delivered.push({ ...m, activeAtDelivery: s.active, currentGenerationAtDelivery: s.generation });
  return n;
}
function cancel(s, publisher) {
  if (!s.pending[publisher]) return null;
  const n = copy(s);
  n.cancelled.push(n.pending[publisher].id);
  n.pending[publisher] = null;
  return n;
}
function leave(s, mutant) {
  if (!s.active) return null;
  const n = copy(s);
  n.active = false;
  if (mutant !== "retain-old-queue") n.queue = [];
  for (const m of n.pending.filter(Boolean)) n.cancelled.push(m.id);
  n.pending = [null, null];
  return n;
}
function rejoin(s) {
  if (s.active || s.generation >= MAX_GENERATION) return null;
  const n = copy(s);
  n.generation++;
  n.active = true;
  return n;
}
function invariant(s) {
  requireSafe(s.queue.length <= CAPACITY, "unbounded subscription queue", s);
  requireSafe(s.pending.length === 2, "publisher association lost", s);
  const ackSet = new Set(s.acked);
  requireSafe(ackSet.size === s.acked.length, "duplicate reliable acknowledgement", s);
  const accepted = new Set(s.accepted.map(m => m.id));
  requireSafe(accepted.size === s.accepted.length, "duplicate queue admission", s);
  requireSafe(s.acked.every(id => accepted.has(id)), "ack without successful admission", s);
  requireSafe(s.accepted.every(m => ackSet.has(m.id)), "admission not acknowledged", s);
  const cancelledSet = new Set(s.cancelled);
  requireSafe(cancelledSet.size === s.cancelled.length, "duplicate pending cancellation", s);
  requireSafe(s.cancelled.every(id => !ackSet.has(id)), "cancelled backpressure acknowledged", s);
  requireSafe(s.pending.filter(Boolean).every(m => !cancelledSet.has(m.id)), "cancelled item remains pending", s);
  const previously = new Map();
  for (const m of s.delivered) {
    requireSafe(m.activeAtDelivery && m.gen === m.currentGenerationAtDelivery,
      "stale subscription generation delivered", s);
    requireSafe(accepted.has(m.id), "delivered without queue admission", s);
    const edge = m.gen + ":" + m.p;
    requireSafe(m.seq > (previously.get(edge) || 0),
      "publisher to subscription edge FIFO violated", s);
    previously.set(edge, m.seq);
  }
  // Pending work cannot have a queued admission or an acknowledgement.
  for (const m of s.pending.filter(Boolean)) {
    requireSafe(m.gen === s.generation && s.active, "stale pending work", s);
    requireSafe(!ackSet.has(m.id) && !accepted.has(m.id), "backpressure acknowledged early", s);
  }
}
function explore(mutant = null) {
  const initial = {
    generation: 1, active: true, next: [1, 1], pending: [null, null],
    queue: [], accepted: [], acked: [], cancelled: [], delivered: []
  };
  const todo = [{ state: initial, trace: [] }];
  const seen = new Set();
  let edges = 0;
  while (todo.length) {
    const { state: s, trace } = todo.shift();
    if (seen.has(key(s))) continue;
    seen.add(key(s));
    try { invariant(s); } catch(e) {
      throw new Error(e.message + "\ntrace=" + trace.join(" -> "));
    }
    const transitions = [];
    for (let p = 0; p < 2; p++) {
      const n = begin(s, p, mutant);
      if (n) transitions.push(["publish-" + p, n]);
      const c = cancel(s, p);
      if (c) transitions.push(["cancel-" + p, c]);
    }
    transitions.push(...admit(s));
    const delivered = deliver(s);
    if (delivered) transitions.push(["deliver", delivered]);
    const left = leave(s, mutant);
    if (left) transitions.push(["leave", left]);
    const joined = rejoin(s);
    if (joined) transitions.push(["rejoin", joined]);
    for (const [action, state] of transitions) {
      edges++;
      if (!seen.has(key(state))) todo.push({ state, trace: trace.concat(action) });
    }
    requireSafe(seen.size < 80000, "state bound unexpectedly large", s);
  }
  return { states: seen.size, edges, capacity: CAPACITY, publishers: 2, generations: MAX_GENERATION };
}
function verify() {
  const ok = explore();
  requireSafe(ok.states > 50 && ok.edges > ok.states, "insufficient model coverage", ok);
  const expected = {
    "early-ack": ["ack without successful admission", "backpressure acknowledged early"],
    "retain-old-queue": ["stale subscription generation delivered"]
  };
  for (const [mutant, violations] of Object.entries(expected)) {
    let found = false;
    try { explore(mutant); } catch (e) {
      const message = String(e.message);
      const trace = message.split("\ntrace=")[1];
      const steps = trace?.split(" -> ") || [];
      const relevantTrace = mutant === "early-ack"
        ? steps.filter(step => step.startsWith("publish-")).length >= 2
        : steps.includes("leave") && steps.includes("rejoin") && steps.includes("deliver");
      found = violations.some(violation => message.startsWith(violation + "\nstate="))
        && relevantTrace;
    }
    requireSafe(found, "mutation lacked its intended invariant counterexample: " + mutant, ok);
  }
  return { ...ok, negativeControls: 2, classification: "SOURCE_FREE_BOUNDED_MODEL" };
}
if (typeof process !== "undefined" && process.argv?.[1]?.endsWith("reliable-pubsub-bounded.mjs")) {
  process.stdout.write(JSON.stringify(verify()) + "\n");
}
