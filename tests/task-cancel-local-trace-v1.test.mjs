// These tests execute a source-free model, NEVER an AttoLang compiler or guest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TaskBoundaryModel } from '../src/task-cancel-local-trace-v1.mjs';

const contract = JSON.parse(readFileSync(new URL('../contracts/task-cancel-local-trace-v1.json', import.meta.url)));
const fail = (fn, code) => assert.throws(fn, new RegExp(code));

test('candidate contract cannot be mistaken for five-backend guest evidence', () => {
  assert.equal(contract.status, 'TARGET_NOT_EXECUTED');
  assert.equal(contract.referenceModelIsGuestEvidence, false);
  assert.equal(contract.zeroStepMeans, 'RUNNER_ADMISSION_FAILURE');
  assert.deepEqual(contract.backends, ['java','llvm','net','forge','wasm']);
  assert.equal(new Set(contract.scenarios.map(s => s.id)).size, contract.scenarios.length);
  assert.ok(contract.scenarios.length >= 16);
  for (const scenario of contract.scenarios) {
    assert.equal(scenario.verified, false);
    assert.ok(scenario.mustHold.length > 15);
  }
});

test('TaskLocal survives await and carrier migration; carrier TLS does not follow', () => {
  const m=new TaskBoundaryModel(), t=m.root(m.actor('A'));
  m.threadSet('carrier-1','physical','one');
  m.threadSet('carrier-2','physical','two');
  m.enter(t,'carrier-1'); m.taskSet(t,'trace','ctx'); m.suspend(t);
  m.enter(t,'carrier-2');
  assert.equal(m.taskGet(t,'trace'),'ctx');
  assert.equal(m.threadGet('carrier-2','physical'),'two');
  assert.equal(m.threadGet('carrier-1','physical'),'one');
  m.suspend(t); assert.equal(m.retire(t).success,true);
});

test('child Task gets no implicit locals; explicit immutable copy cannot alias parent', () => {
  const m=new TaskBoundaryModel(), p=m.root(m.actor('A'));
  m.enter(p,'c'); m.taskSet(p,'trace','before'); m.suspend(p);
  const isolated=m.child(p), inherited=m.child(p,['trace']);
  m.enter(p,'c'); m.taskSet(p,'trace','after'); m.suspend(p);
  m.enter(isolated,'c2'); assert.equal(m.taskGet(isolated,'trace'),undefined); m.suspend(isolated);
  m.enter(inherited,'c3'); assert.equal(m.taskGet(inherited,'trace'),'before'); m.suspend(inherited);
  m.retire(isolated); m.retire(inherited); assert.equal(m.retire(p).quiescent,true);
});

test('no unverified mutable aliases or fabricated Task authority cross spawn', () => {
  const m=new TaskBoundaryModel(), p=m.root(m.actor('A'));
  m.enter(p,'c'); fail(()=>m.taskSet(p,'pointer',{ffi:1}),'INVALID_TASK_LOCAL_WRITE');
  m.taskSet(p,'key','value'); m.suspend(p);
  fail(()=>m.child(p,['missing']),'INVALID_SNAPSHOT');
  fail(()=>m.child(p,['key','key']),'INVALID_SNAPSHOT');
  fail(()=>m.enter({...p},'c'),'UNAUTHENTICATED_TASK');
});

test('cancel requests cannot unlock a currently running task', () => {
  const m=new TaskBoundaryModel(), p=m.root(m.actor('A'));
  let released=0;
  m.enter(p,'c1'); m.acquire(p,'logical',()=>released++,{transferable:true});
  assert.equal(m.cancel(p),true); assert.equal(released,0);
  fail(()=>m.retire(p),'NOT_PHYSICALLY_QUIESCENT');
  m.suspend(p); assert.equal(released,0);
  assert.equal(m.retire(p).cancelled,true); assert.equal(released,1);
});

test('physical retirement waits for child; cancellation cascades without retiring a live lease early', () => {
  const m=new TaskBoundaryModel(), p=m.root(m.actor('A'));
  const c=m.child(p); let released=0;
  m.enter(c,'c'); m.acquire(c,'logical',()=>released++,{transferable:true});
  m.cancel(p); fail(()=>m.retire(p),'NOT_PHYSICALLY_QUIESCENT');
  assert.equal(released,0);
  m.suspend(c); m.retire(c); assert.equal(released,1);
  assert.equal(m.retire(p).quiescent,true);
});

test('child cancellation never cancels parent or sibling', () => {
  const m=new TaskBoundaryModel(), p=m.root(m.actor('A')), a=m.child(p), b=m.child(p);
  m.cancel(a); assert.equal(m.done(p).cancelled,false); assert.equal(m.done(b).cancelled,false);
  m.retire(a); m.retire(b); m.retire(p);
});

test('only owning logical task may close lease; never publish successful cleanup on failed release', () => {
  const m=new TaskBoundaryModel(), p=m.root(m.actor('A')), sibling=m.child(p);
  let calls=0; m.enter(p,'c');
  const lease=m.acquire(p,'logical',()=>{calls++; throw new Error('release failed');},{transferable:true});
  m.enter(sibling,'other'); fail(()=>m.release(sibling,lease),'FOREIGN_OR_RETIRED_LEASE');
  m.suspend(sibling); m.retire(sibling);
  m.suspend(p); const receipt=m.retire(p);
  assert.equal(calls,1); assert.equal(receipt.quiescent,true); assert.equal(receipt.success,false);
  assert.equal(receipt.cleanupFailures,1); fail(()=>m.retire(p),'DOUBLE_RETIRE');
});

test('runtime retires logical leases LIFO and at most once', () => {
  const m=new TaskBoundaryModel(), p=m.root(m.actor('A')); const order=[];
  m.enter(p,'c');
  const a=m.acquire(p,'a',()=>order.push('a'),{transferable:true});
  m.acquire(p,'b',()=>order.push('b'),{transferable:true});
  m.release(p,a); m.suspend(p); m.retire(p);
  assert.deepEqual(order,['a','b']);
});

test('native thread-affine lock cannot masquerade as transferable logical lease', () => {
  const m=new TaskBoundaryModel(), p=m.root(m.actor('A'));
  m.enter(p,'c'); fail(()=>m.acquire(p,'monitor',()=>{},{}),'UNSAFE_LEASE');
  m.suspend(p); m.retire(p);
});

test('ActorLocal is generation-owned, mutable writes require critical authority', () => {
  const m=new TaskBoundaryModel(), actor=m.actor('A',1), restarted=m.actor('A',2);
  const t=m.root(actor); m.enter(t,'c');
  fail(()=>m.actorSet(t,'shared',1),'ACTOR_WRITE_NOT_AUTHORIZED');
  m.actorSet(t,'shared',1,true); m.suspend(t); m.enter(t,'other');
  assert.equal(m.actorGet(t,'shared'),1); m.suspend(t); m.retire(t);
  const next=m.root(restarted); m.enter(next,'other');
  assert.equal(m.actorGet(next,'shared'),undefined); m.suspend(next); m.retire(next);
});

test('async causal trace retains parent link and avoids false sibling ordering', () => {
  const m=new TaskBoundaryModel(), p=m.root(m.actor('A'));
  m.enter(p,'c1'); m.suspend(p);
  const a=m.child(p), b=m.child(p);
  m.enter(a,'c2'); m.suspend(a);
  m.enter(b,'c3'); m.suspend(b);
  m.cancel(a); m.retire(a); m.retire(b); m.retire(p);
  const events=m.events(), childA=events.find(e=>e.task===a.id&&e.kind==='admit');
  const childB=events.find(e=>e.task===b.id&&e.kind==='admit');
  assert.equal(childA.traceId,childB.traceId);
  assert.equal(childA.parentSpanId,'span-'+p.id);
  assert.equal(childB.parentSpanId,'span-'+p.id);
  assert.notEqual(childA.spanId,childB.spanId);
  assert.equal(events.filter(e=>e.task===b.id&&e.kind==='cancel-request').length,0);
  assert.equal(Object.isFrozen(events[0]),true);
});

test('bounded trace overflow never aborts child cancellation; incomplete traces cannot certify causality', () => {
  const m = new TaskBoundaryModel(), parent = m.root(m.actor('A')), children = [];
  for (let i = 0; i < 140; i++) children.push(m.child(parent));
  assert.equal(m.traceComplete(), false);
  assert.ok(m.droppedTraceEvents() > 0);
  assert.equal(m.cancel(parent), true);
  assert.ok(children.every(child => m.done(child).cancelled));
  assert.equal(m.cancel(parent), false);
  assert.equal(m.events().length, 256);
  for (const child of children) assert.equal(m.retire(child).quiescent, true);
  assert.equal(m.retire(parent).quiescent, true);
});
