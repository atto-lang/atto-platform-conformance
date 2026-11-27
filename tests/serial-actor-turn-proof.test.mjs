import assert from 'node:assert/strict';
import test from 'node:test';

// Narrow serial-actor profile. This checks observations, not their provenance.
// Scheduler IDs are supplied by the fixture driver, not the trace producer.
export function verifySerialActorTurns({ events, dropped, eventCount }, expected) {
  assert.equal(dropped, 0, 'trace loss');
  assert.ok(Array.isArray(events) && events.length > 0, 'empty trace');
  assert.equal(eventCount, events.length, 'event count');
  const key = e => JSON.stringify([e.tenant, e.actor]);
  const id = x => typeof x === 'string' && x.length > 0;
  const plan = new Map(), state = new Map();
  for (const e of expected) {
    assert.ok([e.tenant, e.actor, e.scheduler].every(id));
    assert.ok(Number.isSafeInteger(e.turns) && e.turns > 0);
    assert.ok(!plan.has(key(e)), 'duplicate actor expectation');
    plan.set(key(e), e);
  }
  assert.ok(plan.size > 0, 'no independent expectations');
  for (const [i, e] of events.entries()) {
    assert.equal(e.seq, i + 1, 'trace sequence');
    const k = key(e), want = plan.get(k);
    assert.ok(want, 'unexpected actor or tenant');
    assert.ok(Number.isSafeInteger(e.generation) && e.generation >= 1);
    let s = state.get(k);
    if (e.kind === 'activate') {
      assert.ok(!s || (s.retired && e.generation > s.generation), 'overlapping or stale incarnation');
      state.set(k, { generation: e.generation, retired: false, active: null,
        used: new Set(), turns: s?.turns ?? 0 });
      continue;
    }
    assert.ok(s && !s.retired && e.generation === s.generation, 'stale or unknown incarnation');
    if (e.kind === 'retire') {
      assert.equal(s.active, null, 'retired while guest executing');
      s.retired = true;
      continue;
    }
    assert.ok([e.task, e.dispatch].every(id), 'missing turn identity');
    assert.equal(e.role, 'scheduler', 'guest executed on producer');
    assert.equal(e.scheduler, want.scheduler, 'wrong actor scheduler');
    if (e.kind === 'enter') {
      assert.equal(s.active, null, 'actor turn overlap');
      assert.ok(!s.used.has(e.dispatch), 'replayed dispatch');
      s.used.add(e.dispatch);
      s.active = [e.task, e.dispatch];
    } else if (e.kind === 'leave') {
      assert.deepEqual(s.active, [e.task, e.dispatch], 'foreign or duplicate release');
      s.active = null;
      s.turns++;
    } else assert.fail('unknown event');
  }
  for (const [k, want] of plan) {
    const s = state.get(k);
    assert.ok(s?.retired && s.active === null, 'missing actor retirement');
    assert.equal(s.turns, want.turns, 'missing or extra turns');
  }
}

const expectation = { tenant: 't', actor: 'a', scheduler: 'actor-pool', turns: 2 };
const e = (kind, extra = {}) => ({ kind, tenant: 't', actor: 'a', generation: 1,
  scheduler: 'actor-pool', role: 'scheduler', task: 'task', dispatch: 'd1', ...extra });
const a = e('activate'), x = e('enter'), y = e('leave');
const u = e('enter', { task: 'sibling', dispatch: 'd2' });
const v = e('leave', { task: 'sibling', dispatch: 'd2' });
const r = e('retire');
const good = [a, x, y, u, v, r];
const packet = events => ({ events: events.map((e, i) => ({ ...e, seq: i + 1 })), dropped: 0, eventCount: events.length });
test('serial actor turns', () => verifySerialActorTurns(packet(good), [expectation]));
test('new generation after retirement', () => verifySerialActorTurns(packet([a, x, y, r,
  ...[a, u, v, r].map(e => ({ ...e, generation: 2 }))]), [expectation]));
test('different tenants may overlap', () => {
  const other = e => ({ ...e, tenant: 'other' });
  verifySerialActorTurns(packet([a, other(a), x, other(x), y, other(y), u, other(u), v, other(v), r, other(r)]),
    [expectation, { ...expectation, tenant: 'other' }]);
});
for (const [name, events] of [
  ['overlap', [a, x, u, y, v, r]],
  ['foreign release', [a, x, v, u, v, r]],
  ['duplicate release', [a, x, y, y, u, v, r]],
  ['replay', [a, x, y, x, y, r]],
  ['retire while executing', [a, x, r, y, u, v]],
  ['new generation while old live', [a, x, e('activate', { generation: 2 }), y, u, v, r]],
  ['stale callback', [a, x, y, r, e('activate', { generation: 2 }), u, v, e('retire', { generation: 2 })]],
  ['generation rollback', [a, x, y, r, a, u, v, r]],
  ['reactor execution', [a, { ...x, role: 'nio' }, y, u, v, r]],
  ['control pool execution', [a, { ...x, scheduler: 'control' }, y, u, v, r]],
  ['wrong tenant', [a, { ...x, tenant: 'foreign' }, y, u, v, r]],
  ['missing retirement', good.slice(0, -1)],
  ['missing turn', [a, x, y, r]],
]) test(`reject ${name}`, () => assert.throws(() => verifySerialActorTurns(packet(events), [expectation])));
test('reject dropped events', () => assert.throws(() => verifySerialActorTurns({ ...packet(good), dropped: 1 }, [expectation])));
