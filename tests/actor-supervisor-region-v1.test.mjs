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
