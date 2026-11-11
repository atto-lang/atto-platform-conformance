import test from 'node:test';
import assert from 'node:assert/strict';
import { ApplicationSingletonRegistryV1, TrustedMultiActorSharedHostV1 } from '../src/multi-actor-shared-region-v1.mjs';

function setup(opts) {
  const host = new TrustedMultiActorSharedHostV1();
  const a = host.registerActor({ id: 'a', domain: 'app1', slice: 'slice1' });
  const b = host.registerActor({ id: 'b', domain: 'app1', slice: 'slice2' });
  const c = host.registerActor({ id: 'c', domain: 'app1', slice: 'slice3' });
  const x = host.beginExecution(a, 'turn-a');
  const y = host.beginExecution(b, 'turn-b');
  const z = host.beginExecution(c, 'turn-c');
  const region = host.createRegion(a, 1, opts);
  return { host, a, b, c, x, y, z, region };
}

test('singleton canonical identity for imported alias; deep copy/freeze blocks source mutation', () => {
  const r = new ApplicationSingletonRegistryV1();
  let attempts = 0;
  const source = { nested: { n: 1 } };
  const one = r.get('app1', 'mod#Settings', () => { attempts++; return source; });
  const two = r.get('app1', 'mod#Settings', () => { attempts++; return { bad: true }; });
  assert.strictEqual(one, two); assert.equal(attempts, 1);
  source.nested.n = 20;
  assert.equal(two.nested.n, 1);
  assert.throws(() => { two.nested.n = 4; }, TypeError);
  assert.notStrictEqual(r.get('app2', 'mod#Settings', () => ({ nested: { n: 1 } })), one);
});

test('singleton sticky failure and no second initialization after exception', () => {
  const r = new ApplicationSingletonRegistryV1(); let calls = 0;
  const err = new Error('init boom');
  assert.throws(() => r.get('app1', 'X', () => { calls++; throw err; }), e => e === err);
  assert.throws(() => r.get('app1', 'X', () => { calls++; return 1; }), e => e === err);
  assert.equal(calls, 1);
});

test('singleton direct cycle stays failed even if nested cycle was caught', () => {
  const r = new ApplicationSingletonRegistryV1();
  assert.throws(() => r.get('app1', 'X', () => {
    try { r.get('app1', 'X', () => 10); } catch {}
    return { x: 1 };
  }), /cycle/);
  assert.throws(() => r.get('app1', 'X', () => 10), /cycle/);
});

test('singleton cannot publish getters, mutable classes, cycles, async results or oversized graphs', () => {
  for (const val of [{ get x() { throw Error('side effect'); } }, new Date(), Promise.resolve(5)]) {
    const r = new ApplicationSingletonRegistryV1();
    assert.throws(() => r.get('app1', 'X', () => val));
  }
  const cyc = {}; cyc.x = cyc;
  assert.throws(() => new ApplicationSingletonRegistryV1().get('app1', 'X', () => cyc), /cyclic/);
  const huge = Array(1100).fill(0);
  assert.throws(() => new ApplicationSingletonRegistryV1().get('app1', 'X', () => huge), /budget/);
});

test('three cross-slice actors: reader cohort and writer barrier prevent barging', () => {
  const { host, region, x, y, z, b, c } = setup();
  const rb = region.delegate(x, y, 'read');
  const rc = region.delegate(x, z, 'read');
  const readB = region.request(y, 'read', rb);
  const readC = region.request(z, 'read', rc);
  assert.equal(region.read(y, readB), 1); assert.equal(region.read(z, readC), 1);
  const writeA = region.request(x, 'write');
  assert.equal(region.ticketState(writeA), 'pending');
  const y2 = host.beginExecution(b, 'turn-b-late');
  const r2 = region.delegate(x, y2, 'read');
  const late = region.request(y2, 'read', r2);
  assert.equal(region.ticketState(late), 'pending');
  assert.throws(() => region.read(y2, late), /active lease/);
  region.release(y, readB);
  assert.equal(region.ticketState(writeA), 'pending');
  region.release(z, readC);
  assert.equal(region.ticketState(writeA), 'active');
  assert.equal(region.ticketState(late), 'pending');
  region.write(x, writeA, 8);
  region.release(x, writeA);
  assert.equal(region.ticketState(late), 'active');
  assert.equal(region.read(y2, late), 8);
  region.release(y2, late);
  assert.deepEqual({ readers: region.stats.readers, writers: region.stats.writers }, { readers: 0, writers: 0 });
});

test('foreign and stale actor cannot read or write even with a ticket from different execution', () => {
  const { region, x, y, b, host } = setup();
  const r = region.request(x, 'read');
  assert.throws(() => region.read(y, r), /foreign/);
  assert.throws(() => region.write(x, r, 4), /active lease/);
  assert.throws(() => region.release(y, r), /invalid/);
  region.release(x, r);
  assert.throws(() => region.read(x, r), /active lease/);
  host.stopActor(b);
  assert.throws(() => region.request(y, 'read'), /stale/);
});

test('owner cannot bypass existing read lease; recursion/upgrades and suspension denied', () => {
  const { region, x, y, b } = setup();
  const cap = region.delegate(x, y, 'read');
  const t = region.request(y, 'read', cap);
  assert.throws(() => region.write(x, t, 7), /active lease/);
  assert.throws(() => region.request(y, 'write', cap), /recursive/);
  assert.throws(() => region.assertCanSuspend(y), /span/);
  region.release(y, t);
  region.assertCanSuspend(y);
});

test('forged, cross-domain and untrusted actor claims denied', () => {
  const { host, region, x, b } = setup();
  assert.throws(() => region.request({}, 'read'), /stale or forged/);
  const other = host.registerActor({ id: 'other', domain: 'tenant2', slice: 'other' });
  const untrusted = host.registerActor({ id: 'evil', domain: 'app1', slice: 'untrusted', trust: 'untrusted' });
  const oy = host.beginExecution(other, 'o');
  const uy = host.beginExecution(untrusted, 'u');
  assert.throws(() => region.delegate(x, oy, 'read'), /cross-domain/);
  assert.throws(() => region.delegate(x, uy, 'read'), /cross-domain/);
  assert.throws(() => region.request(oy, 'read'), /cross-domain/);
  assert.throws(() => region.request(uy, 'write'), /cross-domain/);
  assert.throws(() => region.request(host.beginExecution(b, 'another'), 'read'), /delegation/);
});

test('full queue does not burn one-use delegation; cancel redrives FIFO', () => {
  const { region, x, y, z, b, c } = setup({ maxPending: 1 });
  const w = region.request(x, 'write');
  const cb = region.delegate(x, y, 'read');
  const cc = region.delegate(x, z, 'read');
  const queued = region.request(y, 'read', cb);
  assert.throws(() => region.request(z, 'read', cc), /queue full/);
  assert.equal(region.stats.grants, 1);
  region.cancel(y, queued);
  const reattempt = region.request(z, 'read', cc);
  assert.equal(region.ticketState(reattempt), 'pending');
  region.release(x, w);
  assert.equal(region.ticketState(reattempt), 'active');
  region.release(z, reattempt);
});

test('bounded readers and delegation ledger, no hidden unbounded growth', () => {
  const { region, x, y, z, b, c } = setup({ maxReaders: 1, maxGrants: 2, maxPending: 1 });
  const a = region.delegate(x, y, 'read');
  const d = region.delegate(x, z, 'read');
  assert.throws(() => region.delegate(x, y, 'read'), /grant quota/);
  const t = region.request(y, 'read', a);
  const q = region.request(z, 'read', d);
  assert.equal(region.ticketState(q), 'pending');
  assert.equal(region.stats.grants, 0);
  region.release(y, t);
  assert.equal(region.ticketState(q), 'active');
  region.release(z, q);
});

test('transfer requires all pending loans and unconsumed grants drained; stale authority denied', () => {
  const { region, x, y, b } = setup();
  const grant = region.delegate(x, y, 'write');
  assert.throws(() => region.transferOwner(x, b), /quiescence/);
  const t = region.request(y, 'write', grant);
  assert.throws(() => region.transferOwner(x, b), /quiescence/);
  region.release(y, t);
  region.transferOwner(x, b);
  assert.throws(() => region.request(x, 'read'), /delegation/);
  assert.throws(() => region.delegate(x, y, 'read'), /only region owner/);
  const t2 = region.request(y, 'write');
  region.write(y, t2, 22); region.release(y, t2);
});

test('owner stop seals region, cannot reclaim until active physical loan released', () => {
  const { host, region, a, x, y, b } = setup();
  const g = region.delegate(x, y, 'read');
  const r = region.request(y, 'read', g);
  host.stopActor(a);
  assert.equal(region.stats.sealed, true);
  assert.throws(() => host.reclaimRegion(region), /quiescent/);
  assert.throws(() => region.read(y, r), /sealed/);
  region.release(y, r);
  host.reclaimRegion(region);
  assert.equal(region.stats.reclaimed, true);
  assert.throws(() => host.reclaimRegion(region), /requires/);
});

test('borrower stop cancels pending but holds physical active slot until cleanup', () => {
  const { host, region, x, y, b } = setup();
  const g = region.delegate(x, y, 'read');
  const w = region.request(x, 'write');
  const r = region.request(y, 'read', g);
  host.stopActor(b);
  assert.equal(region.ticketState(r), 'cancelled');
  region.release(x, w);
  const host2 = new TrustedMultiActorSharedHostV1();
  assert.throws(() => region.request(host2.beginExecution(host2.registerActor({ id: 'z', domain: 'app1', slice: 'q' }), 'x'), 'read'), /stale or forged/);
});

test('same actor name in next incarnation does not resurrect old delegation or active ticket', () => {
  const { host, region, x, y, b } = setup();
  const g = region.delegate(x, y, 'read');
  host.stopActor(b);
  const revived = host.registerActor({ id: 'b', domain: 'app1', slice: 'slice2' });
  const y2 = host.beginExecution(revived, 'turn-b');
  assert.throws(() => region.request(y2, 'read', g), /delegation/);
  assert.throws(() => region.request(y, 'read', g), /stale/);
});

test('logical execution identity cannot be duplicated while live or ended with active loan', () => {
  const { host, region, a, x } = setup();
  assert.throws(() => host.beginExecution(a, 'turn-a'), /already active/);
  const t = region.request(x, 'read');
  assert.throws(() => host.endExecution(x), /active or pending/);
  region.release(x, t);
  host.endExecution(x);
  assert.throws(() => region.request(x, 'read'), /stale/);
  const next = host.beginExecution(a, 'turn-a');
  const lease = region.request(next, 'read'); region.release(next, lease);
});

test('deterministic state machine sweeps writer/read queues across capacities', () => {
  for (let pending = 0; pending <= 3; pending++) for (let readers = 1; readers <= 3; readers++) {
    const { region, x, y, b } = setup({ maxPending: pending, maxReaders: readers });
    const writer = region.request(x, 'write');
    const read = region.delegate(x, y, 'read');
    if (pending === 0) {
      assert.throws(() => region.request(y, 'read', read), /queue full/);
      region.release(x, writer);
    } else {
      const t = region.request(y, 'read', read);
      assert.equal(region.ticketState(t), 'pending');
      region.release(x, writer);
      assert.equal(region.ticketState(t), 'active');
      region.release(y, t);
    }
    assert.equal(region.stats.writers, 0);
  }
});


test('terminal tickets are not retained as an ever-growing strong reference ledger', () => {
  const { region, x } = setup();
  for (let i = 0; i < 1000; i++) {
    const t = region.request(x, 'write');
    region.write(x, t, i);
    region.release(x, t);
    assert.equal(region.stats.retainedTickets, 0);
  }
});

test('borrower stopped inside active loan cannot write or free its physical slot early', () => {
  const { host, region, x, y, b } = setup();
  const g = region.delegate(x, y, 'write');
  const t = region.request(y, 'write', g);
  host.stopActor(b);
  assert.equal(region.stats.writers, 1);
  assert.throws(() => region.write(y, t, 9), /stale/);
  const queued = region.request(x, 'read');
  assert.equal(region.ticketState(queued), 'pending');
  region.release(y, t);
  assert.equal(region.ticketState(queued), 'active');
  assert.equal(region.read(x, queued), 1);
  region.release(x, queued);
});


test('cross-host actor identity is not admitted even with same textual application domain', () => {
  const { region, x } = setup();
  const host = new TrustedMultiActorSharedHostV1();
  const actor = host.registerActor({ id: 'a', domain: 'app1', slice: 'q' });
  const exec = host.beginExecution(actor, 'turn-a');
  assert.throws(() => region.request(exec, 'read'), /stale or forged/);
  assert.throws(() => region.delegate(x, actor, 'read'), /cross-domain/);
  assert.throws(() => host.reclaimRegion(region), /foreign/);
});

test('trusted host authority cannot be invoked directly on a region for stop/reclaim', () => {
  const { region } = setup();
  assert.throws(() => region.onActorStop({}), /trusted runtime/);
  assert.throws(() => region.reclaim(), /trusted runtime/);
});

test('sparse singleton arrays preserve exact lengths without publishing mutable aliases', () => {
  const original = new Array(5); original[3] = { yes: true };
  const copied = new ApplicationSingletonRegistryV1().get('app1', 'Arr', () => original);
  assert.equal(copied.length, 5); assert.equal(0 in copied, false);
  assert.equal(copied[3].yes, true);
  assert.throws(() => { copied[3].yes = false; }, TypeError);
});


test('delegated loan is bound to one logical execution, not merely an actor label', () => {
  const { host, region, x, y, b } = setup();
  const second = host.beginExecution(b, 'another-turn');
  const grant = region.delegate(x, y, 'read');
  assert.throws(() => region.request(second, 'read', grant), /delegation/);
  const borrowed = region.request(y, 'read', grant);
  assert.throws(() => region.request(second, 'read', grant), /delegation/);
  region.release(y, borrowed);
});

test('cross-region nested loans fail closed until global ordering is proven', () => {
  const { host, region, a, x } = setup();
  const otherRegion = host.createRegion(a, 2);
  const t1 = region.request(x, 'read');
  assert.throws(() => otherRegion.request(x, 'write'), /cross-region nested/);
  region.release(x, t1);
  const t2 = otherRegion.request(x, 'write');
  otherRegion.write(x, t2, 3);
  otherRegion.release(x, t2);
});

test('retired execution revokes unused scoped grants, permitting owner transfer without quota leaks', () => {
  const { host, region, x, y, b } = setup({ maxGrants: 1 });
  const oldGrant = region.delegate(x, y, 'read');
  assert.equal(region.stats.grants, 1);
  assert.throws(() => region.transferOwner(x, b), /quiescence/);
  assert.throws(() => region.onExecutionEnd(y, {}), /trusted runtime/);
  host.endExecution(y);
  assert.equal(region.stats.grants, 0);
  // A reused logical name has a new execution identity, not the old grant.
  const fresh = host.beginExecution(b, 'turn-b');
  assert.throws(() => region.request(fresh, 'read', oldGrant), /delegation/);
  region.transferOwner(x, b);
  const newWrite = region.request(fresh, 'write');
  region.write(fresh, newWrite, 41);
  region.release(fresh, newWrite);
  assert.equal(region.stats.retainedTickets, 0);
});

test('cross-region order fails closed in both directions without consuming scoped grants', () => {
  const { host, a, region, x, y } = setup();
  const second = host.createRegion(a, 9);
  const firstGrant = region.delegate(x, y, 'read');
  const secondGrant = second.delegate(x, y, 'write');
  const first = region.request(y, 'read', firstGrant);
  assert.throws(() => second.request(y, 'write', secondGrant), /cross-region nested/);
  assert.equal(second.stats.grants, 1);
  region.release(y, first);
  const writing = second.request(y, 'write', secondGrant);
  assert.throws(() => region.request(y, 'read', firstGrant), /cross-region nested/);
  // The first grant is consumed only when its request is actually admitted.
  assert.equal(region.stats.grants, 0);
  second.release(y, writing);
  const renewed = region.delegate(x, y, 'read');
  const read = region.request(y, 'read', renewed);
  region.release(y, read);
  assert.deepEqual([region.stats.retainedTickets, second.stats.retainedTickets], [0, 0]);
});

test('STOP and cancellation races drain reservations but preserve physical writer retirement', () => {
  const { host, region, a, x, y, z, b, c } = setup({ maxPending: 2 });
  const ownerWrite = region.request(x, 'write');
  const readerGrant = region.delegate(x, y, 'read');
  const writerGrant = region.delegate(x, z, 'write');
  const pendingRead = region.request(y, 'read', readerGrant);
  const pendingWrite = region.request(z, 'write', writerGrant);
  region.cancel(y, pendingRead);
  assert.equal(region.ticketState(pendingRead), 'cancelled');
  host.stopActor(c);
  assert.equal(region.ticketState(pendingWrite), 'cancelled');
  assert.equal(region.stats.pending, 0);
  host.stopActor(a);
  assert.equal(region.stats.sealed, true);
  assert.equal(region.stats.writers, 1);
  assert.throws(() => host.reclaimRegion(region), /quiescent/);
  assert.throws(() => region.write(x, ownerWrite, 12), /stale/);
  region.release(x, ownerWrite);
  host.reclaimRegion(region);
  assert.equal(region.stats.reclaimed, true);
  assert.equal(region.stats.retainedTickets, 0);
  assert.throws(() => region.request(y, 'read'), /sealed|stale/);
});

test('3, 7 and 15 cross-slice readers cannot barge ahead of a queued writer', () => {
  for (const n of [3, 7, 15]) {
    const host = new TrustedMultiActorSharedHostV1();
    const owner = host.registerActor({ id: 'owner', domain: 'app', slice: 'owner-slice' });
    const x = host.beginExecution(owner, 'turn-owner');
    const writerExecution = host.beginExecution(owner, 'turn-writer');
    const region = host.createRegion(owner, 0, { maxPending: 20, maxReaders: 20, maxGrants: 20 });
    const headRead = region.request(x, 'read');
    const queuedWriter = region.request(writerExecution, 'write');
    assert.equal(region.ticketState(queuedWriter), 'pending');
    const readers = [];
    for (let i = 0; i < n; i++) {
      const actor = host.registerActor({ id: 'reader-' + i, domain: 'app', slice: 'slice-' + i });
      const exec = host.beginExecution(actor, 'turn-' + i);
      const grant = region.delegate(x, exec, 'read');
      const ticket = region.request(exec, 'read', grant);
      assert.equal(region.ticketState(ticket), 'pending');
      readers.push({ exec, ticket });
    }
    region.release(x, headRead);
    assert.equal(region.ticketState(queuedWriter), 'active');
    assert.equal(region.stats.readers, 0);
    region.write(writerExecution, queuedWriter, n);
    region.release(writerExecution, queuedWriter);
    assert.equal(region.stats.readers, n);
    for (const { exec, ticket } of readers) {
      assert.equal(region.ticketState(ticket), 'active');
      assert.equal(region.read(exec, ticket), n);
      region.release(exec, ticket);
    }
    assert.equal(region.stats.retainedTickets, 0);
    assert.equal(region.stats.pending, 0);
  }
});

test('physical guest turn fences owner move and STOP reclamation even after loan release', () => {
  const { host, region, a, x, b } = setup();
  host.beginRegionTurn(region, x);
  const loan = region.request(x, 'write');
  region.release(x, loan);
  assert.equal(region.stats.retainedTickets, 0);
  assert.equal(region.stats.physicalTurns, 1);
  assert.throws(() => host.endExecution(x), /active or pending/);
  assert.throws(() => region.transferOwner(x, b), /quiescence/);
  host.stopActor(a);
  assert.throws(() => host.reclaimRegion(region), /quiescent/);
  assert.throws(() => region.read(x, loan), /stale/);
  host.endRegionTurn(region, x);
  assert.equal(region.stats.physicalTurns, 0);
  host.reclaimRegion(region);
  assert.equal(region.stats.reclaimed, true);
});

test('physical turn admission is trusted, bounded and once-ended; STOP cannot resurrect guest authority', () => {
  const { host, region, x, y, b } = setup({ maxTurns: 1 });
  assert.throws(() => region.beginPhysicalTurn(x, {}), /trusted runtime/);
  assert.throws(() => region.endPhysicalTurn(x, {}), /trusted runtime/);
  host.beginRegionTurn(region, x);
  assert.throws(() => host.beginRegionTurn(region, x), /already active/);
  assert.throws(() => host.beginRegionTurn(region, y), /quota/);
  host.endRegionTurn(region, x);
  assert.throws(() => host.endRegionTurn(region, x), /invalid or duplicate/);
  host.beginRegionTurn(region, y);
  host.stopActor(b);
  assert.throws(() => host.beginRegionTurn(region, x), /quota/);
  host.endRegionTurn(region, y);
  assert.throws(() => host.beginRegionTurn(region, y), /stale/);
  assert.equal(region.stats.physicalTurns, 0);
});

test('suspension cannot be certified by an idle region while a different region is borrowed', () => {
  const { host, region, a, x } = setup();
  const idleRegion = host.createRegion(a, 7);
  const read = region.request(x, 'read');
  assert.throws(() => idleRegion.assertCanSuspend(x), /loan or physical region turn/);
  region.release(x, read);
  idleRegion.assertCanSuspend(x);

  host.beginRegionTurn(region, x);
  assert.throws(() => idleRegion.assertCanSuspend(x), /loan or physical region turn/);
  host.endRegionTurn(region, x);
  idleRegion.assertCanSuspend(x);

  const pendingWriter = region.request(x, 'write');
  assert.throws(() => idleRegion.assertCanSuspend(x), /loan or physical region turn/);
  region.release(x, pendingWriter);
  assert.equal(region.stats.retainedTickets, 0);
});
