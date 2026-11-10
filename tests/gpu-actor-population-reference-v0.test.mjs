import test from 'node:test';
import assert from 'node:assert/strict';
import { GpuActorPopulationReference as Model } from '../src/gpu-actor-population-reference-v0.mjs';
const state = m => m.snapshot().actors;

test('multiple logical actors dispatch concurrently without assigning a physical core', () => {
  const m = new Model({actorCount: 3});
  for (let i = 0; i < 3; i++) m.send(i, i + 1);
  const batch = m.dispatch(3);
  assert.deepEqual(batch.map(x=>x.actorId), [0,1,2]);
  assert.deepEqual(state(m).map(x=>x.value), [0,0,0]);
  for (const t of batch.toReversed()) assert.equal(m.complete(t).committed, true);
  assert.deepEqual(state(m).map(x=>x.value), [1,2,3]);
});

test('same actor has at most one inflight message, ordered commits and credits', () => {
  const m = new Model({actorCount: 1,mailboxCapacity: 2});
  assert.equal(m.send(0, 2).sequence, 1);
  assert.equal(m.send(0, 3).sequence, 2);
  assert.throws(()=>m.send(0,5),/MAILBOX_FULL/);
  const [first] = m.dispatch(1);
  assert.equal(first.sequence, 1);
  assert.deepEqual(m.dispatch(), []);
  assert.equal(state(m)[0].value, 0);
  assert.equal(m.complete(first).committed,true);
  const [second] = m.dispatch();
  assert.equal(second.sequence, 2);
  assert.equal(m.complete(second).committed,true);
  assert.equal(state(m)[0].value,5);
});

test('failed kernel and arithmetic overflow never publish staged writes', () => {
  const m = new Model({actorCount:1,initialValue:Number.MAX_SAFE_INTEGER});
  m.send(0,1);
  const [t] = m.dispatch();
  assert.equal(m.complete(t).error,'ARITHMETIC_OVERFLOW');
  assert.equal(state(m)[0].value,Number.MAX_SAFE_INTEGER);
  m.send(0,-1);
  const [other] = m.dispatch();
  assert.equal(m.complete(other,{deviceSuccess:false}).error,'KERNEL_FAILED');
  assert.equal(state(m)[0].value,Number.MAX_SAFE_INTEGER);
});

test('cancellation is requested but buffers remain in flight until a fence', () => {
  const m = new Model({actorCount:1});
  m.send(0,10);
  const [ticket] = m.dispatch();
  m.requestClose(0);
  assert.equal(state(m)[0].active,true);
  assert.equal(state(m)[0].closed,false);
  assert.throws(()=>m.complete(ticket,{fenceObserved:false}),/DEVICE_NOT_QUIESCENT/);
  assert.equal(state(m)[0].active,true);
  assert.equal(m.complete(ticket,{fenceObserved:true}).error,'CANCELLED');
  assert.equal(state(m)[0].closed,true);
  assert.equal(state(m)[0].value,0);
});

test('old generation cannot commit after a quiescent restart', () => {
  const m = new Model({actorCount:1});
  m.send(0,5);
  const [old] = m.dispatch();
  m.requestClose(0);
  assert.throws(()=>m.restart(0),/DEVICE_NOT_QUIESCENT/);
  m.complete(old);
  assert.equal(m.restart(0,100),2);
  assert.throws(()=>m.complete(old),/STALE_OR_FORGED_TICKET/);
  assert.equal(state(m)[0].value,100);
});

test('device failure affects entire cohort and cannot imply actor-local isolation', () => {
  const m = new Model({actorCount:3});
  m.send(0,5);m.send(1,7);m.send(2,1);
  const batch = m.dispatch(2);
  assert.equal(m.loseDevice(), true);
  assert.equal(m.loseDevice(), false);
  assert.equal(m.snapshot().notifications.length,3);
  assert.throws(()=>m.dispatch(),/DEVICE_LOST/);
  assert.throws(()=>m.send(2,1),/DEVICE_LOST/);
  assert.equal(m.complete(batch[0]).error,'DEVICE_LOST');
  assert.equal(m.complete(batch[1]).error,'DEVICE_LOST');
  assert.deepEqual(state(m).map(x=>x.value),[0,0,0]);
  assert.equal(state(m).every(x=>x.closed),true);
});

test('malformed input and forged ticket fail closed without modifying committed value', () => {
  for (const args of [{actorCount:0},{actorCount:1.5},{actorCount:1,mailboxCapacity:0}]) assert.throws(()=>new Model(args),/INVALID_/);
  const m = new Model({actorCount:1});
  assert.throws(()=>m.send(5,4),/INVALID_ACTOR_ID/);
  assert.throws(()=>m.send(0,1.1),/INVALID_DELTA/);
  m.send(0,7);
  const [t]=m.dispatch();
  assert.throws(()=>m.complete({...t}),/STALE_OR_FORGED_TICKET/);
  assert.equal(state(m)[0].value,0);
  assert.equal(m.complete(t).committed,true);
  assert.throws(()=>m.complete(t),/STALE_OR_FORGED_TICKET/);
});

test('bounded exhaustive event orders preserve no overlapping turns and exact totals', () => {
  // Every one of 2^8 interleavings on two actors exercises cancellation-free overlap.
  for (let bits=0;bits<256;bits++) {
    const m=new Model({actorCount:2,mailboxCapacity:8});
    const expected=[0,0];
    for(let step=0;step<8;step++) {
      const id=(bits>>step)&1;
      expected[id]++;
      m.send(id,1);
      const pending=m.dispatch(2);
      for(const t of pending.toReversed()) m.complete(t);
      assert.equal(state(m).every(a=>!a.active),true);
    }
    let pending;
    while((pending=m.dispatch(2)).length) for(const t of pending) m.complete(t);
    assert.deepEqual(state(m).map(a=>a.value),expected);
  }
});

test('1024 logical actors execute 4096 independent turns under bounded batches', () => {
  const count = 1024;
  const m = new Model({actorCount:count, mailboxCapacity:4});
  for (let id=0;id<count;id++) for (let n=1;n<=4;n++) m.send(id,n);
  let commits=0, batches=0;
  for (;;) {
    const batch=m.dispatch(64);
    if (!batch.length) break;
    assert.ok(batch.length<=64);
    assert.equal(new Set(batch.map(t=>t.actorId)).size,batch.length);
    for (const ticket of batch.toReversed()) {
      assert.equal(m.complete(ticket).committed,true);
      commits++;
    }
    batches++;
    assert.ok(batches<=64, 'bounded progress must not starve actors');
  }
  assert.equal(commits,4096);
  assert.equal(batches,64);
  assert.ok(state(m).every(a=>a.value===10 && a.pending===0 && !a.active));
});

test('1024-actor device loss fences all outstanding state publication', () => {
  const count=1024;
  const m=new Model({actorCount:count});
  for(let id=0;id<count;id++) m.send(id,1);
  const batch=m.dispatch(256);
  assert.equal(batch.length,256);
  assert.equal(m.loseDevice(),true);
  for(const t of batch.toReversed()) {
    assert.equal(m.complete(t).error,'DEVICE_LOST');
  }
  assert.equal(m.snapshot().notifications.length, count);
  assert.equal(new Set(m.snapshot().notifications.map(x=>x.actorId)).size, count);
  assert.ok(state(m).every(a=>a.value===0 && a.pending===0 && a.closed));
});

test('dispatch fairness rotates across actors even with continual low-id work', () => {
  const m=new Model({actorCount:4,mailboxCapacity:8});
  for(let i=0;i<4;i++) m.send(i,1);
  const seen=[];
  for(let round=0;round<4;round++) {
    const [ticket]=m.dispatch(1);
    assert.ok(ticket);
    seen.push(ticket.actorId);
    m.complete(ticket);
    if(round<3) m.send(ticket.actorId,1);
  }
  assert.deepEqual(seen,[0,1,2,3]);
});
