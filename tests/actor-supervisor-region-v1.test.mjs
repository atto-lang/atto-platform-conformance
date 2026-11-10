import test from 'node:test';
import assert from 'node:assert/strict';
import { ActorSupervisorRegionV1, checkBorrowTrace } from '../src/actor-supervisor-region-v1.mjs';

const actor = Object.freeze({ role: 'actor', id: 'child' });
const supervisor = Object.freeze({ role: 'supervisor', id: 'parent' });
const mk = (n = 8) => new ActorSupervisorRegionV1({ actorId: 'child', supervisorId: 'parent', maxPending: n });
const denied = (f, msg) => assert.throws(f, msg ? new RegExp(msg) : undefined);

test('static borrow trace: read cohorts legal; write overlap rejected', () => {
  assert.deepEqual(checkBorrowTrace([
    ['init', 'state', 'actor'], ['read', 'state', 'r1', 'actor'],
    ['grant', 'state', 'g2', 'supervisor', 'read', 'actor'],
    ['read', 'state', 'r2', 'supervisor', 'g2'],
    ['release', 'r1'], ['release', 'r2'], ['end']]), { ok: true });
  assert.match(checkBorrowTrace([
    ['init','state','actor'], ['read','state','r','actor'],
    ['grant','state','gw','supervisor','write','actor'],
    ['write','state','w','supervisor','gw']]).why, /conflicting/);
});

test('static borrow trace: exclusive writer and move only after release', () => {
  assert.equal(checkBorrowTrace([
    ['init','state','actor'], ['write','state','w','actor'],
    ['release','w'], ['move','state','supervisor'],
    ['owner-use','state','supervisor'], ['end']]).ok, true);
  assert.match(checkBorrowTrace([
    ['init','state','actor'], ['read','state','r','actor'],
    ['move','state','supervisor']]).why, /outstanding/);
});

test('static borrow trace: no implicit supervisor authority, suspend, or escape', () => {
  const pre = [['init','state','actor']];
  assert.match(checkBorrowTrace([...pre, ['owner-use','state','supervisor']]).why, /non-owner/);
  assert.match(checkBorrowTrace([...pre, ['read','state','r','supervisor']]).why, /typed grant/);
  assert.match(checkBorrowTrace([...pre, ['read','state','r','actor'], ['await','actor']]).why, /suspension/);
  assert.match(checkBorrowTrace([...pre, ['read','state','r','actor'], ['escape','r']]).why, /escapes/);
  assert.match(checkBorrowTrace([...pre, ['read','state','r','actor'], ['end']]).why, /unreleased/);
  assert.match(checkBorrowTrace([...pre, ['release','unknown']]).why, /released/);
  assert.match(checkBorrowTrace([...pre, ['read','state','r','supervisor',true]]).why, /typed grant/);
  assert.match(checkBorrowTrace([...pre, ['grant','state','g','supervisor','read','supervisor']]).why, /only current owner/);
  assert.match(checkBorrowTrace([...pre, ['grant','state','g','supervisor','read','actor'],
    ['move','state','supervisor'], ['move','state','actor'],
    ['read','state','r','supervisor','g']]).why, /typed grant/);
});

test('owner is unique; supervisor STOP cannot mint raw owner or memory loan', () => {
  const r = mk();
  assert.equal(r.owner.principal.role, 'actor');
  denied(() => r.acquire(supervisor, 'read'), /grant/);
  denied(() => r.transfer({ ...r.owner }, supervisor), /only semantic owner/);
  denied(() => r.delegate({ ...r.owner }, supervisor, 'read'), /semantic owner/);
  denied(() => r.stop(actor), /only supervisor/);
  r.stop(supervisor);
  denied(() => r.acquire(actor, 'read', { ownerToken: r.owner }), /sealed/);
});

test('actor + supervisor may hold two read loans with delegation', () => {
  const r = mk(); const owner = r.owner;
  const cap = r.delegate(owner, supervisor, 'read');
  const a = r.acquire(actor, 'read', { ownerToken: owner });
  const s = r.acquire(supervisor, 'read', { grant: cap });
  assert.equal(r.stats.activeReaders, 2);
  assert.equal(r.access(a, actor, 'read'), true);
  assert.equal(r.access(s, supervisor, 'read'), true);
  denied(() => r.access(s, supervisor, 'write'), /write requires/);
  denied(() => r.acquire(supervisor, 'read', { grant: cap }), /consumed grant/);
  r.release(s, supervisor); r.release(a, actor);
  assert.equal(r.stats.activeReaders, 0);
});

test('write is exclusive; writer queue blocks later reader with fair handoff', () => {
  const r = mk(); let owner = r.owner;
  const read = r.acquire(actor, 'read', { ownerToken: owner });
  const supWrite = r.acquire(supervisor, 'write', {
    grant: r.delegate(owner, supervisor, 'write') });
  assert.equal(r.granted(supWrite, supervisor), false);
  denied(() => r.acquire(actor, 'read', { ownerToken: owner }), /recursive/);
  r.release(read, actor);
  assert.equal(r.granted(supWrite, supervisor), true);
  assert.equal(r.stats.activeWriters, 1);
  const queuedActor = r.acquire(actor, 'write', { ownerToken: owner });
  assert.equal(r.granted(queuedActor, actor), false);
  r.release(supWrite, supervisor);
  assert.equal(r.granted(queuedActor, actor), true);
  r.release(queuedActor, actor);
  assert.equal(r.stats.activeWriters, 0);
});

test('writer at head blocks later reader until writer releases', () => {
  const r = mk(); const owner = r.owner;
  const a = r.acquire(actor, 'read', { ownerToken: owner });
  const w = r.acquire(supervisor, 'write', { grant: r.delegate(owner, supervisor, 'write') });
  r.release(a, actor);
  assert.equal(r.granted(w, supervisor), true);
  const later = r.acquire(actor, 'read', { ownerToken: owner });
  assert.equal(r.granted(later, actor), false);
  r.release(w, supervisor);
  assert.equal(r.granted(later, actor), true);
  r.release(later, actor);
});

test('queued writer cancellation unblocks eligible following readers', () => {
  const r = mk(); const owner = r.owner;
  const r1 = r.acquire(actor, 'read', { ownerToken: owner });
  const w = r.acquire(supervisor, 'write', { grant: r.delegate(owner, supervisor, 'write') });
  assert.equal(r.cancelQueued(w, supervisor), true);
  const s = r.acquire(supervisor, 'read', { grant: r.delegate(owner, supervisor, 'read') });
  assert.equal(r.granted(s, supervisor), true);
  r.release(s, supervisor); r.release(r1, actor);
  denied(() => r.release(w, supervisor), /stale loan/);
});

test('queued cancellation and full bounded queue do not abandon reservations', () => {
  const r = mk(1); const owner = r.owner;
  const a = r.acquire(actor, 'write', { ownerToken: owner });
  const s = r.acquire(supervisor, 'read', { grant: r.delegate(owner, supervisor, 'read') });
  assert.equal(r.stats.pending, 1);
  denied(() => r.acquire(actor, 'read', { ownerToken: owner }), /recursive/);
  assert.equal(r.cancelQueued(s, supervisor), true);
  const s2 = r.acquire(supervisor, 'read', { grant: r.delegate(owner, supervisor, 'read') });
  r.release(a, actor); assert.equal(r.granted(s2, supervisor), true);
  r.release(s2, supervisor);
});

test('owner transfer waits for read/write loans and guest turns', () => {
  const r = mk(); const owner = r.owner;
  r.beginActorTurn(owner);
  denied(() => r.transfer(owner, supervisor), /quiescence/);
  r.endActorTurn(owner);
  const read = r.acquire(actor, 'read', { ownerToken: owner });
  denied(() => r.transfer(owner, supervisor), /quiescence/);
  r.release(read, actor);
  const next = r.transfer(owner, supervisor);
  assert.equal(next.principal.role, 'supervisor');
  denied(() => r.acquire(actor, 'read', { ownerToken: owner }), /grant/);
  const s = r.acquire(supervisor, 'write', { ownerToken: next });
  assert.equal(r.access(s, supervisor, 'write'), true);
  r.release(s, supervisor);
});

test('revoked and old-generation delegations cannot survive owner move', () => {
  const r = mk(); const old = r.owner;
  const grant = r.delegate(old, supervisor, 'read');
  const next = r.transfer(old, supervisor);
  denied(() => r.acquire(supervisor, 'read', { grant }), /grant/);
  denied(() => r.delegate(old, supervisor, 'read'), /semantic owner/);
  const newGrant = r.delegate(next, actor, 'read');
  const a = r.acquire(actor, 'read', { grant: newGrant });
  assert.equal(r.access(a, actor, 'read'), true); r.release(a, actor);
});

test('STOP fences logical memory access but physical loan blocks reclamation', () => {
  const r = mk(); const a = r.acquire(actor, 'write', { ownerToken: r.owner });
  r.stop(supervisor);
  denied(() => r.access(a, actor, 'write'), /after STOP/);
  denied(() => r.reclaim(supervisor), /physical loans/);
  assert.equal(r.cancelQueued(a, actor), false);
  denied(() => r.assertMaySuspend(actor), /loan live/);
  r.release(a, actor);
  assert.equal(r.physicallyQuiescent(), true);
  r.reclaim(supervisor);
  assert.equal(r.stats.reclaimed, true);
});

test('STOP with queued writer cancels queue and protects live read until release', () => {
  const r = mk(); const owner = r.owner;
  const a = r.acquire(actor, 'read', { ownerToken: owner });
  const w = r.acquire(supervisor, 'write', { grant: r.delegate(owner, supervisor, 'write') });
  r.stop(supervisor);
  assert.equal(r.stats.pending, 0);
  denied(() => r.access(w, supervisor, 'write'), /stale loan/);
  denied(() => r.reclaim(supervisor), /physical loans/);
  r.release(a, actor); r.reclaim(supervisor);
});

test('restart fences old owner, grants, tickets, and generation ABA', () => {
  const r = mk(); const old = r.owner;
  const oldGrant = r.delegate(old, supervisor, 'read');
  r.stop(supervisor); r.reclaim(supervisor);
  const fresh = r.restart(supervisor);
  assert.equal(r.generation, 2);
  assert.equal(fresh.principal.role, 'actor');
  denied(() => r.acquire(actor, 'write', { ownerToken: old }), /grant/);
  denied(() => r.acquire(supervisor, 'read', { grant: oldGrant }), /grant/);
  const a = r.acquire(actor, 'write', { ownerToken: fresh });
  r.release(a, actor);
});

test('no suspension under live/queued loan; release clears execution reservation', () => {
  const r = mk(); const owner = r.owner;
  const a = r.acquire(actor, 'write', { ownerToken: owner });
  denied(() => r.assertMaySuspend(actor), /loan live/);
  const s = r.acquire(supervisor, 'read', { grant: r.delegate(owner, supervisor, 'read') });
  denied(() => r.assertMaySuspend(supervisor), /loan live/);
  r.release(a, actor); r.release(s, supervisor);
  assert.equal(r.assertMaySuspend(actor), true);
  assert.equal(r.assertMaySuspend(supervisor), true);
});

test('hostile forged ticket, cross-principal release and double-release denied', () => {
  const r = mk(); const owner = r.owner;
  const a = r.acquire(actor, 'read', { ownerToken: owner });
  denied(() => r.release({ ...a }, actor), /invalid/);
  denied(() => r.release(a, supervisor), /invalid/);
  r.release(a, actor);
  denied(() => r.release(a, actor), /invalid/);
});


test('independent logical executions may read concurrently; writer FIFO beats late reader', () => {
  const r = mk(); const owner = r.owner;
  const a1 = { ...actor, executionId: 'actor-turn-1' };
  const a2 = { ...actor, executionId: 'actor-turn-2' };
  const a3 = { ...actor, executionId: 'actor-turn-3' };
  const s1 = { ...supervisor, executionId: 'supervisor-turn-1' };
  const r1 = r.acquire(a1, 'read', { ownerToken: owner });
  const r2 = r.acquire(a2, 'read', { ownerToken: owner });
  const w = r.acquire(s1, 'write', { grant: r.delegate(owner, s1, 'write') });
  const late = r.acquire(a3, 'read', { ownerToken: owner });
  assert.equal(r.stats.activeReaders, 2);
  assert.equal(r.granted(late, a3), false);
  r.release(r1, a1);
  assert.equal(r.granted(w, s1), false);
  r.release(r2, a2);
  assert.equal(r.granted(w, s1), true);
  assert.equal(r.granted(late, a3), false);
  r.release(w, s1);
  assert.equal(r.granted(late, a3), true);
  r.release(late, a3);
});

test('cross-execution ticket and delegated grant replay denied', () => {
  const r = mk(); const owner = r.owner;
  const s1 = { ...supervisor, executionId: 'supervisor-execution-1' };
  const s2 = { ...supervisor, executionId: 'supervisor-execution-2' };
  const grant = r.delegate(owner, s1, 'read');
  denied(() => r.acquire(s2, 'read', { grant }), /grant/);
  const t = r.acquire(s1, 'read', { grant });
  denied(() => r.release(t, s2), /invalid/);
  assert.equal(r.access(t, s1, 'read'), true);
  r.release(t, s1);
});

test('6,400 deterministic interleavings preserve exclusive writer and bounded queue', () => {
  let transitions = 0;
  for (let seed = 1; seed <= 64; seed++) {
    let state = seed;
    const next = (n) => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) % n);
    const r = mk(4); const owner = r.owner;
    const principals = [
      { ...actor, executionId: 'a0' },
      { ...actor, executionId: 'a1' },
      { ...supervisor, executionId: 's0' },
      { ...supervisor, executionId: 's1' },
    ];
    const tickets = [];
    for (let step = 0; step < 100; step++) {
      const op = next(4);
      if (op <= 1) {
        const who = principals[next(principals.length)];
        const mode = next(3) === 0 ? 'write' : 'read';
        try {
          const auth = who.role === 'actor'
            ? { ownerToken: owner }
            : { grant: r.delegate(owner, who, mode) };
          tickets.push({ who, ticket: r.acquire(who, mode, auth) });
        } catch (e) {
          assert.match(String(e), /recursive|queue full/);
        }
      } else if (tickets.length) {
        const index = next(tickets.length);
        const { who, ticket } = tickets[index];
        if (r.granted(ticket, who)) {
          if (op === 2) r.release(ticket, who);
          else { // an active cancel cannot revoke a physical loan
            assert.equal(r.cancelQueued(ticket, who), false);
            r.release(ticket, who);
          }
        } else {
          assert.equal(r.cancelQueued(ticket, who), true);
        }
        tickets.splice(index, 1);
      }
      const x = r.stats;
      assert.ok(x.activeWriters <= 1);
      assert.ok(x.activeWriters === 0 || x.activeReaders === 0);
      assert.ok(x.pending <= 4);
      assert.equal(x.owner, 'actor');
      transitions++;
    }
    for (const { who, ticket } of tickets) {
      if (r.granted(ticket, who)) r.release(ticket, who);
      else r.cancelQueued(ticket, who);
    }
    r.stop(supervisor);
    assert.equal(r.physicallyQuiescent(), true);
    r.reclaim(supervisor);
  }
  assert.equal(transitions, 6_400);
});

test('HARDEN: a failed queue admission must not consume the one-use delegated grant', () => {
  const r = mk(0), owner = r.owner;
  const actorWrite = r.acquire(actor, 'write', { ownerToken: owner });
  const grant = r.delegate(owner, supervisor, 'read');
  denied(() => r.acquire(supervisor, 'read', { grant }), /queue full/);
  // Failed admission did not buy a ticket; it cannot consume authorization.
  r.release(actorWrite, actor);
  const supervisorRead = r.acquire(supervisor, 'read', { grant });
  assert.equal(r.access(supervisorRead, supervisor, 'read'), true);
  r.release(supervisorRead, supervisor);
  denied(() => r.acquire(supervisor, 'read', { grant }), /grant/);
});

test('HARDEN: recursive acquisition must not burn a second valid delegation', () => {
  const r = mk(), owner = r.owner;
  const firstGrant = r.delegate(owner, supervisor, 'read');
  const secondGrant = r.delegate(owner, supervisor, 'write');
  const first = r.acquire(supervisor, 'read', { grant: firstGrant });
  denied(() => r.acquire(supervisor, 'write', { grant: secondGrant }), /recursive/);
  r.release(first, supervisor);
  const second = r.acquire(supervisor, 'write', { grant: secondGrant });
  assert.equal(r.access(second, supervisor, 'write'), true);
  r.release(second, supervisor);
});

test('HARDEN: bounded grant ledger prevents unbounded unconsumed capability growth', () => {
  const r = new ActorSupervisorRegionV1({ actorId: actor.id, supervisorId: supervisor.id,
    maxPending: 2, maxDelegations: 2 });
  const owner = r.owner;
  const s1 = { ...supervisor, executionId: 's1' };
  const s2 = { ...supervisor, executionId: 's2' };
  const g1 = r.delegate(owner, s1, 'read');
  const g2 = r.delegate(owner, s2, 'read');
  denied(() => r.delegate(owner, supervisor, 'write'), /delegation capacity/);
  assert.equal(r.stats.outstandingDelegations, 2);
  const t1 = r.acquire(s1, 'read', { grant: g1 });
  assert.equal(r.stats.outstandingDelegations, 1);
  const g3 = r.delegate(owner, supervisor, 'write');
  assert.equal(r.stats.outstandingDelegations, 2);
  r.release(t1, s1);
  denied(() => r.acquire(supervisor, 'read', { grant: g3 }), /grant/);
  const t2 = r.acquire(s2, 'read', { grant: g2 });
  r.release(t2, s2);
  const t3 = r.acquire(supervisor, 'write', { grant: g3 });
  r.release(t3, supervisor);
  assert.equal(r.stats.outstandingDelegations, 0);
});

test('HARDEN: stale and foreign principals cannot claim may-suspend proof', () => {
  const r = mk();
  denied(() => r.assertMaySuspend({ role: 'actor', id: 'other' }), /foreign/);
  denied(() => r.assertMaySuspend({ role: 'supervisor', id: 'other' }), /foreign/);
  r.stop(supervisor);
  denied(() => r.assertMaySuspend(actor), /sealed/);
});

test('HARDEN: transfer revokes outstanding grants without rebinding them to next owner', () => {
  const r = mk(), a = r.owner;
  const g = r.delegate(a, supervisor, 'write');
  assert.equal(r.stats.outstandingDelegations, 1);
  const s = r.transfer(a, supervisor);
  assert.equal(r.stats.outstandingDelegations, 0);
  denied(() => r.acquire(supervisor, 'write', { grant: g }), /grant/);
  const t = r.acquire(supervisor, 'write', { ownerToken: s });
  r.release(t, supervisor);
});

test('HARDEN: borrowed writer must block owner raw reads and writes in static trace', () => {
  const ops = [
    ['init', 'state', 'actor'],
    ['grant', 'state', 'grant', 'supervisor', 'write', 'actor'],
    ['write', 'state', 'loan', 'supervisor', 'grant'],
  ];
  assert.match(checkBorrowTrace([...ops, ['owner-use', 'state', 'actor']]).why, /conflicting/);
  assert.match(checkBorrowTrace([...ops, ['owner-use', 'state', 'actor', 'write']]).why, /conflicting/);
  assert.equal(checkBorrowTrace([...ops, ['release', 'loan'],
    ['owner-use', 'state', 'actor', 'write'], ['end']]).ok, true);
});

test('HARDEN: outstanding immutable loan blocks owner raw writes but permits reads', () => {
  const ops = [['init', 'state', 'actor'], ['read', 'state', 'loan', 'actor']];
  assert.match(checkBorrowTrace([...ops, ['owner-use', 'state', 'actor', 'write']]).why, /conflicting/);
  assert.equal(checkBorrowTrace([...ops, ['owner-use', 'state', 'actor', 'read'],
    ['release', 'loan'], ['end']]).ok, true);
  assert.match(checkBorrowTrace([...ops, ['owner-use', 'state', 'actor', 'raw']]).why, /mode/);
});

test('HARDEN: escape of a released loan and malformed suspension must not silently pass', () => {
  const ops = [['init', 'state', 'actor'], ['read', 'state', 'loan', 'actor'], ['release', 'loan']];
  assert.match(checkBorrowTrace([...ops, ['escape', 'loan']]).why, /escape|invalid/);
  assert.match(checkBorrowTrace([...ops, ['await', 'ghost']]).why, /role/);
  assert.match(checkBorrowTrace([...ops, ['await']]).why, /role/);
});

test('HARDEN: end marker is terminal and loan IDs cannot be recycled after release', () => {
  assert.match(checkBorrowTrace([['init', 'state', 'actor'], ['end'],
    ['write', 'state', 'fresh', 'actor']]).why, /after end/);
  assert.match(checkBorrowTrace([['init', 'state', 'actor'],
    ['read', 'state', 'loan', 'actor'], ['release', 'loan'],
    ['write', 'state', 'loan', 'actor']]).why, /loan/);
});

test('HARDEN: moving to current owner and invalid root/loan IDs fail closed', () => {
  assert.match(checkBorrowTrace([['init', 'state', 'actor'],
    ['move', 'state', 'actor']]).why, /change/);
  assert.equal(checkBorrowTrace([['init', '', 'actor'], ['end']]).ok, false);
  assert.equal(checkBorrowTrace([['init', 'state', 'actor'],
    ['read', 'state', '', 'actor']]).ok, false);
});

test('HARDEN: malformed runtime delegation bounds fail closed', () => {
  for (const maxDelegations of [-1, 0.5, Number.POSITIVE_INFINITY]) {
    denied(() => new ActorSupervisorRegionV1({ actorId: actor.id,
      supervisorId: supervisor.id, maxDelegations }), /delegation/);
  }
});

test('HARDEN: projected and indirect aliases cannot launder a shared read into writer', () => {
  const common = [
    ['init', 'record', 'actor'],
    ['alias', 'record', 'aliasOne'],
    ['project', 'aliasOne', 'record.field'],
    ['read', 'record.field', 'r', 'actor'],
    ['grant', 'record', 'gw', 'supervisor', 'write', 'actor'],
  ];
  assert.match(checkBorrowTrace([...common,
    ['write', 'record', 'w', 'supervisor', 'gw']]).why, /conflicting/);
  assert.match(checkBorrowTrace([...common,
    ['owner-use', 'aliasOne', 'actor', 'write']]).why, /conflicting/);
  assert.equal(checkBorrowTrace([...common,
    ['release', 'r', 'actor'], ['drop-alias', 'record.field'],
    ['drop-alias', 'aliasOne'], ['end']]).ok, true);
});

test('HARDEN: borrowed alias blocks transfer even after last loan is released', () => {
  const ops = [['init', 'region', 'actor'], ['alias', 'region', 'handle'],
    ['read', 'handle', 'r', 'actor'], ['release', 'r']];
  assert.match(checkBorrowTrace([...ops, ['move', 'region', 'supervisor']]).why, /aliases/);
  assert.equal(checkBorrowTrace([...ops, ['drop-alias', 'handle'],
    ['move', 'region', 'supervisor'], ['end']]).ok, true);
  assert.match(checkBorrowTrace([...ops, ['end']]).why, /alias/);
});

test('HARDEN: foreign role cannot release another borrower static loan', () => {
  const ops = [['init', 'region', 'actor'],
    ['grant', 'region', 'grant', 'supervisor', 'read', 'actor'],
    ['read', 'region', 'loan', 'supervisor', 'grant']];
  assert.match(checkBorrowTrace([...ops, ['release', 'loan', 'actor']]).why, /borrower/);
  assert.equal(checkBorrowTrace([...ops, ['release', 'loan', 'supervisor'], ['end']]).ok, true);
});

test('HARDEN: caller cannot issue duplicate projection names or outlive alias root', () => {
  assert.match(checkBorrowTrace([['init','region','actor'], ['alias','region','r1'],
    ['project','r1','r1']]).why, /alias/);
  assert.match(checkBorrowTrace([['init','region','actor'], ['drop-alias','missing']]).why, /alias/);
  assert.match(checkBorrowTrace([['init','region','actor'], ['alias','region','a'],
    ['drop-alias','a'], ['read','a','loan','actor']]).why, /root/);
});

test('HARDEN: total active-reader count is bounded even for independent executions', () => {
  const r = new ActorSupervisorRegionV1({actorId: actor.id, supervisorId: supervisor.id,
    maxPending: 2, maxActiveReaders: 1});
  const owner = r.owner;
  const a1 = {...actor, executionId:'r1'}, a2 = {...actor, executionId:'r2'};
  const s1 = {...supervisor, executionId:'w1'};
  const first = r.acquire(a1, 'read', {ownerToken:owner});
  const second = r.acquire(a2, 'read', {ownerToken:owner});
  const writer = r.acquire(s1, 'write', {grant:r.delegate(owner,s1,'write')});
  assert.equal(r.granted(second,a2),false);
  assert.equal(r.granted(writer,s1),false);
  denied(() => r.acquire({...actor,executionId:'r3'},'read',{ownerToken:owner}), /queue full/);
  r.release(first,a1);
  assert.equal(r.granted(second,a2),true);
  assert.equal(r.granted(writer,s1),false);
  r.release(second,a2);
  assert.equal(r.granted(writer,s1),true);
  r.release(writer,s1);
  assert.equal(r.stats.activeReaders,0);
});

test('HARDEN: malformed active-reader limits fail closed', () => {
  for (const maxActiveReaders of [-1, 0, 0.5, Number.POSITIVE_INFINITY]) {
    denied(() => new ActorSupervisorRegionV1({actorId: actor.id,
      supervisorId: supervisor.id,maxActiveReaders}), /reader bound/);
  }
});

test('HARDEN: inert-looking aliases are live read borrows and forbid exclusive mutation', () => {
  const ops = [['init','region','actor'],['alias','region','savedRef']];
  assert.match(checkBorrowTrace([...ops,['owner-use','region','actor','write']]).why,/conflicting/);
  assert.match(checkBorrowTrace([...ops,['write','region','w','actor']]).why,/conflicting/);
  assert.match(checkBorrowTrace([...ops,
    ['grant','region','g','supervisor','write','actor'],
    ['write','region','w','supervisor','g']]).why,/conflicting/);
  assert.match(checkBorrowTrace([...ops,['await','actor']]).why,/suspension/);
  assert.equal(checkBorrowTrace([...ops,['drop-alias','savedRef'],
    ['write','region','w','actor'],['release','w'],['end']]).ok,true);
});

test('HARDEN: creating a new alias while an exclusive writer is live is rejected', () => {
  const ops = [['init','region','actor'],['write','region','w','actor']];
  assert.match(checkBorrowTrace([...ops,['alias','region','r']]).why,/exclusive writer/);
  assert.equal(checkBorrowTrace([...ops,['release','w'],['alias','region','r'],
    ['drop-alias','r'],['end']]).ok,true);
});

test('AUDIT: supervisor physical guest turn prevents owner transfer even without a loan', () => {
  const r = mk(), original = r.owner;
  r.beginSupervisorTurn(supervisor);
  assert.equal(r.stats.activeSupervisorTurn, true);
  denied(() => r.transfer(original, supervisor), /quiescence/);
  denied(() => r.beginSupervisorTurn(supervisor), /non-reentrant/);
  denied(() => r.endSupervisorTurn(actor), /foreign/);
  r.endSupervisorTurn(supervisor);
  const next = r.transfer(original, supervisor);
  assert.equal(next.principal.role, 'supervisor');
  denied(() => r.transfer(original, actor), /owner/);
});

test('AUDIT: STOP cannot reclaim while supervisor execution still physically active', () => {
  const r = mk();
  r.beginSupervisorTurn(supervisor);
  r.stop(supervisor);
  assert.equal(r.physicallyQuiescent(), false);
  denied(() => r.reclaim(supervisor), /physical/);
  denied(() => r.beginSupervisorTurn(supervisor), /sealed/);
  r.endSupervisorTurn(supervisor);
  assert.equal(r.physicallyQuiescent(), true);
  r.reclaim(supervisor);
  denied(() => r.endSupervisorTurn(supervisor), /duplicate/);
});

test('AUDIT: a derived alias must be dropped before its parent alias', () => {
  const prefix = [['init', 's', 'actor'], ['alias', 's', 'a'], ['project', 'a', 'a.f']];
  assert.match(checkBorrowTrace([...prefix, ['drop-alias', 'a']]).why, /derived projection/);
  assert.equal(checkBorrowTrace([...prefix, ['drop-alias', 'a.f'], ['drop-alias', 'a'], ['end']]).ok, true);
});

test('AUDIT: dropping a projected alias with a live derived loan is rejected', () => {
  const prefix = [['init', 's', 'actor'], ['alias', 's', 'a'], ['read', 'a', 'lr', 'actor']];
  assert.match(checkBorrowTrace([...prefix, ['drop-alias', 'a']]).why, /derived loan/);
  assert.equal(checkBorrowTrace([...prefix, ['release', 'lr'], ['drop-alias', 'a'], ['end']]).ok, true);
});

test('AUDIT: STOP before physical exit cannot be bypassed through restart', () => {
  const r = mk(), owner = r.owner;
  r.beginActorTurn(owner);
  r.beginSupervisorTurn(supervisor);
  r.stop(supervisor);
  r.endActorTurn(owner);
  assert.equal(r.physicallyQuiescent(), false);
  denied(() => r.reclaim(supervisor), /physical/);
  denied(() => r.restart(supervisor), /prior physical/);
  r.endSupervisorTurn(supervisor);
  r.reclaim(supervisor);
  const restarted = r.restart(supervisor);
  assert.notEqual(restarted, owner);
  assert.equal(r.generation, 2);
});

test('AUDIT: transfer never creates a second owner while any physical turn exists', () => {
  for (let i=0;i<500;i++) {
    const r = mk();
    const owner = r.owner;
    if (i%2 === 0) r.beginActorTurn(owner);
    if (i%3 === 0) r.beginSupervisorTurn(supervisor);
    if (r.stats.activeActorTurn || r.stats.activeSupervisorTurn) {
      denied(() => r.transfer(owner, supervisor), /quiescence/);
    }
    if (r.stats.activeActorTurn) r.endActorTurn(owner);
    if (r.stats.activeSupervisorTurn) r.endSupervisorTurn(supervisor);
    const next = r.transfer(owner, supervisor);
    assert.equal(r.stats.owner,'supervisor');
    denied(() => r.transfer(owner, actor), /owner/);
    assert.equal(next.principal.role,'supervisor');
  }
});
