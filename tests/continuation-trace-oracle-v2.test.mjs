import assert from 'node:assert/strict';
import test from 'node:test';

// Host-only oracle. The collector must provide an authenticated causal order;
// this code does not attest the producer or compile/execute a guest.
const id = x => (typeof x === 'string' && x.length > 0) || (Number.isSafeInteger(x) && x >= 0);
const tuple = (...xs) => JSON.stringify(xs);
const requireIds = (e, fields) => {
  for (const f of fields) assert.ok(id(e[f]), `invalid ${f}`);
};

export function verifyTraceV2(events) {
  assert.ok(Array.isArray(events) && events.length > 0, 'empty trace');
  const waits = new Map(), active = new Map(), futures = new Map();
  const retired = new Set();
  const actorKey = e => e.actor === null ? null : tuple(e.tenant, e.actor, e.generation);
  const ownerKey = e => tuple(e.tenant, e.actor, e.generation, e.task);
  const futureKey = e => tuple(e.tenant, e.future);
  for (const e of events) {
    assert.ok(e && typeof e === 'object' && !Array.isArray(e), 'invalid event');
    requireIds(e, ['tenant']);
    if (e.kind === 'retire_actor') {
      requireIds(e, ['actor', 'generation']);
      const a = actorKey(e);
      assert.ok(!retired.has(a), 'duplicate retirement');
      retired.add(a);
      continue;
    }
    if (e.kind === 'settle') {
      requireIds(e, ['future']);
      assert.ok(['ok', 'error', 'cancelled'].includes(e.outcome), 'invalid outcome');
      const f = futureKey(e);
      assert.ok(!futures.has(f), 'duplicate settlement');
      futures.set(f, e.outcome);
      continue;
    }
    assert.ok(['suspend', 'release', 'cancel_wait', 'enqueue', 'resume', 'revoke'].includes(e.kind), 'unknown event');
    requireIds(e, ['task', 'generation', 'suspension', 'scheduler', 'dispatch', 'future']);
    assert.ok(e.actor === null || id(e.actor), 'invalid actor identity');
    const owner = ownerKey(e), a = actorKey(e), k = tuple(owner, e.suspension);
    const f = futureKey(e);
    if (e.kind === 'suspend') {
      assert.ok(!waits.has(k) && !active.has(owner), 'overlapping or duplicate suspension');
      assert.ok(!retired.has(a), 'retired actor suspension');
      waits.set(k, { ...e, released: false, queued: false, cancelled: false, terminal: false });
      active.set(owner, k);
      continue;
    }
    const w = waits.get(k);
    assert.ok(w && !w.terminal && active.get(owner) === k, 'unknown or terminal suspension');
    for (const field of ['scheduler', 'future']) assert.equal(e[field], w[field], `changed ${field}`);
    if (e.kind === 'release') {
      assert.ok(!w.released, 'duplicate release');
      assert.equal(e.dispatch, w.dispatch);
      w.released = true;
    } else if (e.kind === 'cancel_wait') {
      assert.ok(!w.cancelled, 'duplicate cancellation authority');
      w.cancelled = true;
    } else if (e.kind === 'enqueue') {
      // ENQUEUE means runnable admission, not early internal staging.
      assert.ok(w.released && !w.queued && !w.cancelled, 'invalid runnable admission');
      assert.ok(futures.has(f), 'enqueue before settlement');
      assert.ok(!retired.has(a), 'retired actor enqueue');
      w.queued = true;
    } else if (e.kind === 'resume') {
      assert.ok(w.queued && !w.cancelled, 'resume without live admission');
      assert.notEqual(e.dispatch, w.dispatch, 'inline resume');
      assert.equal(e.role, 'scheduler', 'guest resumed on producer');
      assert.ok(!retired.has(a), 'retired actor resume');
      assert.equal(e.outcome, futures.get(f), 'wrong outcome');
      w.terminal = true;
      active.delete(owner);
    } else {
      assert.ok(w.released && (w.cancelled || retired.has(a)), 'unauthorized revocation');
      w.terminal = true;
      active.delete(owner);
    }
  }
  assert.ok(waits.size > 0, 'no observed suspensions');
  assert.equal(active.size, 0, 'lost continuation');
}

const a = { tenant: 1, actor: 3, generation: 1, task: 2, suspension: 1, scheduler: 'actor', dispatch: 7, future: 'f' };
const e = (kind, extra = {}) => ({ ...a, kind, ...extra });
const s = e('suspend'), l = e('release'), q = e('enqueue');
const f = { kind: 'settle', tenant: 1, future: 'f', outcome: 'ok' };
const r = e('resume', { dispatch: 8, role: 'scheduler', outcome: 'ok' });
const c = e('cancel_wait'), v = e('revoke'), d = e('retire_actor');
const good = [s, l, f, q, r];
const rejects = (name, trace) => test(name, () => assert.throws(() => verifyTraceV2(trace)));
for (const [name, trace] of [
  ['pending Future', good],
  ['already complete', [f, s, l, q, r]],
  ['completion before release', [s, f, l, q, r]],
  ['cancel before release', [s, c, l, v]],
  ['cancel after enqueue', [s, l, f, q, c, v]],
  ['retirement fences admitted resume', [s, l, f, q, d, v]],
  ['cancelled Future delivers cancellation result', [s, l, { ...f, outcome: 'cancelled' }, q, { ...r, outcome: 'cancelled' }]],
  ['error Future delivers error result', [s, l, { ...f, outcome: 'error' }, q, { ...r, outcome: 'error' }]],
  ['tenant-local Future IDs may repeat', [...good, ...good.map(x => ({ ...x, tenant: 2 }))]],
  ['task IDs may repeat across actors', [...good, ...[s, l, q, r].map(x => ({ ...x, actor: 4 }))]],
  ['root tasks explicitly use null actor', good.map(x => x.kind === 'settle' ? x : { ...x, actor: null })],
  ['new generation can resume after retirement', [...good, d, ...[s, l, q, r].map(x => ({ ...x, generation: 2 }))]],
  ['sequential suspension on same task', [...good, ...[s, l, q, r].map(x => ({ ...x, suspension: 2, dispatch: x.dispatch + 1 }))]],
]) test(name, () => verifyTraceV2(trace));
for (const [name, trace] of [
  ['reject empty', []], ['reject no wait', [f]], ['reject malformed event', [null]],
  ['reject object IDs', [{ ...s, tenant: {} }]], ['reject missing actor', [{ ...s, actor: undefined }]],
  ['reject foreign tenant settlement', [s, l, { ...f, tenant: 2 }, q, r]],
  ['reject duplicate settlement', [s, l, f, f, q, r]], ['reject duplicate enqueue', [s, l, f, q, q, r]],
  ['reject duplicate resume', [...good, r]], ['reject lost wakeup', [s, l, f]],
  ['reject arbitrary revoke', [s, l, v]], ['reject revoke before release', [s, c, v]],
  ['reject duplicate cancellation', [s, c, c, l, v]], ['reject cancel then enqueue', [s, l, f, c, q, v]],
  ['reject cancel then resume', [s, l, f, q, c, r]], ['reject stale resume', [s, l, f, q, d, r]],
  ['reject stale enqueue', [s, l, f, d, q, r]], ['reject forged retirement', [s, l, { ...d, tenant: undefined }, v]],
  ['reject duplicate retirement', [d, d, ...good]], ['reject root retirement', [{ ...d, actor: null }, ...good]],
  ['reject overlapping task suspension', [s, { ...s, suspension: 2 }, l, f, q, r]],
  ['reject premature enqueue', [s, f, q, l, r]], ['reject no settlement', [s, l, q, r]],
  ['reject wrong scheduler', [...good.slice(0, -1), { ...r, scheduler: 'root' }]],
  ['reject wrong generation', [...good.slice(0, -1), { ...r, generation: 2 }]],
  ['reject inline resume', [...good.slice(0, -1), { ...r, dispatch: 7 }]],
  ['reject reactor resume', [...good.slice(0, -1), { ...r, role: 'nio' }]],
  ['reject wrong outcome', [...good.slice(0, -1), { ...r, outcome: 'error' }]],
  ['reject changed Future', [s, l, f, { ...q, future: 'other' }, r]],
]) rejects(name, trace);

// Exhaust all 120 permutations of five events; independent order constraints
// (settlement can be before suspension, but admission requires both release and settlement).
function* permutations(xs) {
  if (xs.length === 0) { yield []; return; }
  for (let i = 0; i < xs.length; i++) for (const tail of permutations(xs.filter((_, j) => j !== i))) yield [xs[i], ...tail];
}
test('exhaustive five-event order: exactly three valid permutations', () => {
  let accepted = 0, rejected = 0;
  for (const trace of permutations(good)) {
    const pos = x => trace.indexOf(x);
    const valid = pos(s) < pos(l) && pos(l) < pos(q) && pos(f) < pos(q) && pos(q) < pos(r);
    if (valid) { verifyTraceV2(trace); accepted++; }
    else { assert.throws(() => verifyTraceV2(trace)); rejected++; }
  }
  assert.equal(accepted, 3);
  assert.equal(rejected, 117);
});

// Strict qualification envelope: expected outcomes come from the independent
// fixture driver, not from the trace producer. This validates completeness
// relative to the supplied expectations, not authenticity of collector data.
export function verifyScenarioTrace({ events, dropped, eventCount }, expected) {
  assert.equal(dropped, 0, 'collector dropped events');
  assert.ok(Array.isArray(events), 'missing event stream');
  assert.equal(eventCount, events.length, 'event count mismatch');
  assert.ok(Array.isArray(expected) && expected.length > 0, 'missing independent expectations');
  const key = e => tuple(e.tenant, e.actor, e.generation, e.task, e.suspension);
  const outcomes = new Map();
  for (const e of expected) {
    requireIds(e, ['tenant', 'generation', 'task', 'suspension', 'scheduler', 'future']);
    assert.ok(e.actor === null || id(e.actor), 'invalid expected actor');
    assert.ok(['ok', 'error', 'cancelled', 'revoked'].includes(e.outcome), 'invalid expected outcome');
    assert.ok(!outcomes.has(key(e)), 'duplicate expected suspension');
    outcomes.set(key(e), e);
  }
  const seen = new Set();
  for (const [i, e] of events.entries()) {
    assert.ok(e && typeof e === 'object', 'invalid event');
    assert.equal(e.seq, i + 1, 'trace gap, duplicate or reordering');
    if (e.kind !== 'suspend' && e.kind !== 'resume' && e.kind !== 'revoke') continue;
    const k = key(e), want = outcomes.get(k);
    assert.ok(want, 'unexpected suspension or terminal event');
    assert.equal(e.scheduler, want.scheduler, 'unexpected scheduler');
    assert.equal(e.future, want.future, 'unexpected Future');
    if (e.kind !== 'suspend') {
      assert.ok(!seen.has(k), 'duplicate terminal outcome');
      assert.equal(e.kind === 'revoke' ? 'revoked' : e.outcome, want.outcome, 'unexpected terminal outcome');
      seen.add(k);
    }
  }
  assert.equal(seen.size, outcomes.size, 'missing expected suspension outcome');
  verifyTraceV2(events);
}

const envelope = events => ({ events: events.map((e, i) => ({ ...e, seq: i + 1 })), dropped: 0, eventCount: events.length });
const expectation = { ...a, outcome: 'ok' };
test('strict complete scenario', () => verifyScenarioTrace(envelope(good), [expectation]));
test('strict authorised revoke scenario', () => verifyScenarioTrace(envelope([s, c, l, v]), [{ ...expectation, outcome: 'revoked' }]));
for (const [name, packet, expected] of [
  ['missing expected task', envelope(good), [expectation, { ...expectation, task: 9 }]],
  ['no independent expectations', envelope(good), []],
  ['duplicate expected task', envelope(good), [expectation, expectation]],
  ['dropped events', { ...envelope(good), dropped: 1 }, [expectation]],
  ['missing drop counter', { ...envelope(good), dropped: undefined }, [expectation]],
  ['wrong count', { ...envelope(good), eventCount: 6 }, [expectation]],
  ['missing sequence', { ...envelope(good), events: good }, [expectation]],
  ['sequence gap', { ...envelope(good), events: envelope(good).events.map((e, i) => i === 2 ? { ...e, seq: 4 } : e) }, [expectation]],
  ['unexpected scheduler even if self-consistent', envelope(good.map(e => e.kind === 'settle' ? e : { ...e, scheduler: 'root' })), [expectation]],
  ['wrong expected outcome', envelope(good), [{ ...expectation, outcome: 'error' }]],
  ['revocation cannot replace required success', envelope([s, c, l, v]), [expectation]],
  ['extra unexpected task', envelope([...good, ...[s, l, q, r].map(e => ({ ...e, task: 9 }))]), [expectation]],
]) test(`strict rejects ${name}`, () => assert.throws(() => verifyScenarioTrace(packet, expected)));
