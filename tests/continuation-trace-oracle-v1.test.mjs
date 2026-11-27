import assert from 'node:assert/strict';
import test from 'node:test';

// Source-free trace oracle. This does not compile or execute Atto guests.
// Events must be causally ordered by the collector, not sorted by wall time.
export function verifyTrace(events) {
  assert.ok(Array.isArray(events) && events.length > 0, 'empty trace');
  const waits = new Map();
  const futures = new Map();
  const retired = new Set();
  const key = e => JSON.stringify([e.tenant, e.task, e.generation, e.suspension]);
  const actorKey = e => JSON.stringify([e.tenant, e.actor, e.generation]);
  for (const e of events) {
    if (e.kind === 'retire_actor') {
      assert.notEqual(e.actor, null);
      assert.notEqual(e.actor, undefined);
      retired.add(actorKey(e));
      continue;
    }
    if (e.kind === 'settle') {
      assert.ok(typeof e.future === 'string' && e.future.length);
      assert.ok(['ok', 'error', 'cancelled'].includes(e.outcome), 'invalid terminal outcome');
      assert.ok(!futures.has(e.future), 'duplicate Future settlement');
      futures.set(e.future, e.outcome);
      continue;
    }
    assert.ok(['suspend', 'release', 'enqueue', 'resume', 'revoke'].includes(e.kind), 'unknown event');
    for (const f of ['tenant', 'task', 'generation', 'suspension', 'scheduler', 'dispatch', 'future']) {
      assert.ok(e[f] !== undefined && e[f] !== null && e[f] !== '', `missing ${f}`);
    }
    const id = key(e);
    if (e.kind === 'suspend') {
      assert.ok(!waits.has(id), 'duplicate suspension');
      assert.ok(!retired.has(actorKey(e)), 'suspending retired actor');
      waits.set(id, { ...e, released: false, queued: false, terminal: false });
      continue;
    }
    const w = waits.get(id);
    assert.ok(w && !w.terminal, 'unknown or terminal suspension');
    for (const f of ['actor', 'scheduler', 'future']) assert.equal(e[f], w[f], `changed ${f}`);
    if (e.kind === 'release') {
      assert.ok(!w.released, 'duplicate release');
      assert.equal(e.dispatch, w.dispatch);
      w.released = true;
    } else if (e.kind === 'enqueue') {
      assert.ok(w.released && !w.queued, 'enqueue before release or duplicate enqueue');
      assert.ok(futures.has(w.future), 'enqueue before settlement');
      assert.ok(!retired.has(actorKey(e)), 'enqueue for retired actor');
      w.queued = true;
    } else if (e.kind === 'resume') {
      assert.ok(w.queued, 'resume without enqueue');
      assert.notEqual(e.dispatch, w.dispatch, 'inline resume');
      assert.equal(e.role, 'scheduler', 'guest resumed on producer');
      assert.ok(!retired.has(actorKey(e)), 'stale actor resume');
      assert.equal(e.outcome, futures.get(w.future), 'wrong outcome');
      w.terminal = true;
    } else {
      assert.ok(w.released, 'revocation receipt before release');
      w.terminal = true;
    }
  }
  assert.ok(waits.size > 0, 'no observed suspensions');
  for (const w of waits.values()) assert.ok(w.terminal, 'lost continuation');
}

const a = { tenant: 1, task: 2, actor: 3, generation: 1, suspension: 1, scheduler: 'actor', dispatch: 7, future: '1:f' };
const event = (kind, extra = {}) => ({ ...a, kind, ...extra });
const settle = { kind: 'settle', future: a.future, outcome: 'ok' };
const suspend = event('suspend');
const release = event('release');
const enqueue = event('enqueue');
const resume = event('resume', { dispatch: 8, role: 'scheduler', outcome: 'ok' });
const retire = event('retire_actor');
const revoke = event('revoke');
const good = [suspend, release, settle, enqueue, resume];

test('pending completion resumes once', () => verifyTrace(good));
test('already settled Future still needs a fresh dispatch', () => verifyTrace([settle, suspend, release, enqueue, resume]));
test('settlement can race carrier release', () => verifyTrace([suspend, settle, release, enqueue, resume]));
test('retired actor can revoke but cannot resume', () => verifyTrace([suspend, release, retire, settle, revoke]));
test('shared Future resumes distinct owners', () => {
  const other = e => ({ ...e, task: 4, actor: 5, scheduler: 'other' });
  verifyTrace([suspend, other(suspend), release, other(release), settle, enqueue, other(enqueue), resume, other(resume)]);
});
for (const [name, trace] of [
  ['empty trace', []],
  ['settlement only', [settle]],
  ['missing outcome', [suspend, release, { ...settle, outcome: undefined }, enqueue, resume]],
  ['duplicate settlement', [suspend, release, settle, settle, enqueue, resume]],
  ['duplicate enqueue', [suspend, release, settle, enqueue, enqueue, resume]],
  ['duplicate resume', [...good, resume]],
  ['lost wakeup', [suspend, release, settle]],
  ['enqueue before carrier release', [suspend, settle, enqueue, release, resume]],
  ['enqueue before settlement', [suspend, release, enqueue, settle, resume]],
  ['inline continuation', [...good.slice(0, -1), { ...resume, dispatch: 7 }]],
  ['NIO guest execution', [...good.slice(0, -1), { ...resume, role: 'nio' }]],
  ['wrong scheduler', [...good.slice(0, -1), { ...resume, scheduler: 'root' }]],
  ['wrong generation', [...good.slice(0, -1), { ...resume, generation: 2 }]],
  ['late callback after actor retirement', [suspend, release, settle, enqueue, retire, resume]],
  ['wrong outcome', [...good.slice(0, -1), { ...resume, outcome: 'error' }]],
  ['unknown event', [...good, { ...resume, kind: 'oops' }]],
]) test(`rejects ${name}`, () => assert.throws(() => verifyTrace(trace)));
