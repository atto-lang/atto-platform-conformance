import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorProtocolOracle,runBudgetedReference,OwnershipOracle,inspectBinaryFrame}
  from '../src/actor-execution-oracle-v1.mjs';
const spec=()=>({id:'worker',epoch:7,dataCapacity:2,controlCapacity:1,
  states:['idle','busy','finished'],initial:'idle',transitions:[
    {from:'idle',event:'begin',to:'busy'},
    {from:'busy',event:'done',to:'finished'}]});

test('selective receive preserves unmatched FIFO and does not swallow CONTROL',()=>{
  const m=new ActorProtocolOracle(spec());
  assert.equal(m.sendData({ticket:'a',kind:'image',epoch:7}),'ACCEPTED');
  assert.equal(m.sendData({ticket:'b',kind:'signal',epoch:7}),'ACCEPTED');
  assert.deepEqual(m.dispatch(['missing']),{status:'SUSPENDED'});
  assert.equal(m.sendControl({ticket:'panic',kind:'panic',epoch:7}),'ACCEPTED');
  assert.equal(m.sendControl({ticket:'extra',kind:'stop',epoch:7}),'FULL');
  assert.deepEqual(m.dispatch(['signal']),
    {status:'DELIVERED',ticket:'panic',kind:'panic',lane:'CONTROL'});
  assert.deepEqual(m.dispatch(['signal']),
    {status:'DELIVERED',ticket:'b',kind:'signal',lane:'DATA'});
  assert.deepEqual(m.dispatch(['image']),
    {status:'DELIVERED',ticket:'a',kind:'image',lane:'DATA'});
  assert.equal(m.settle('panic'),'SETTLED');
  assert.equal(m.settle('panic'),'INVALID');
});

test('bounded admission, generation fencing, closure and in-flight lifetime',()=>{
  const m=new ActorProtocolOracle(spec());
  assert.equal(m.sendData({ticket:'a',kind:'data',epoch:6}),'STALE_EPOCH');
  assert.equal(m.sendData({ticket:'a',kind:'data',epoch:7}),'ACCEPTED');
  assert.equal(m.sendData({ticket:'a',kind:'data',epoch:7}),'DUPLICATE_TICKET');
  assert.equal(m.sendData({ticket:'b',kind:'data',epoch:7}),'ACCEPTED');
  assert.equal(m.sendData({ticket:'c',kind:'data',epoch:7}),'FULL');
  assert.equal(m.dispatch(['data']).ticket,'a');
  assert.equal(m.close(),'CLOSED');
  assert.equal(m.close(),'ALREADY_CLOSED');
  assert.equal(m.drained(),false);
  assert.throws(()=>m.restart(8,'idle'),/INVALID_ACTOR_EXECUTION/);
  assert.equal(m.settle('a'),'SETTLED');
  assert.equal(m.drained(),true);
  assert.equal(m.restart(8,'idle'),'RESTARTED_MODEL_ONLY');
  assert.equal(m.sendData({ticket:'z',kind:'data',epoch:7}),'STALE_EPOCH');
  assert.equal(m.sendData({ticket:'a',kind:'data',epoch:8}),'ACCEPTED');
});

test('typed finite state transitions reject invalid events without changing state',()=>{
  const m=new ActorProtocolOracle(spec());
  assert.deepEqual(m.advance('done'),{status:'REJECTED',state:'idle'});
  assert.deepEqual(m.advance('begin'),{status:'TRANSITIONED',state:'busy'});
  assert.deepEqual(m.advance('begin'),{status:'REJECTED',state:'busy'});
  assert.deepEqual(m.advance('done'),{status:'TRANSITIONED',state:'finished'});
  assert.throws(()=>new ActorProtocolOracle({...spec(),transitions:[
    {from:'idle',event:'start',to:'busy'},
    {from:'idle',event:'start',to:'finished'}]}),/ambiguous transition/);
});

test('bounded reference slices make a second actor progress despite long running peer',()=>{
  const r=runBudgetedReference([{id:'greedy',work:1000000},{id:'peer',work:2}],
    {budget:4,turns:5});
  assert.deepEqual(r.history.map(x=>x.actor),['greedy','peer','greedy','greedy','greedy']);
  assert.equal(r.history[1].remaining,0);
  assert.equal(r.allCompleted,false);
  assert.equal(r.nativePreemptionProven,false);
  assert.ok(r.history.every(x=>x.charged<=4));
});

test('owner cannot move while borrowed; remote move forbidden; stale owner cannot reclaim',()=>{
  const m=new OwnershipOracle();
  assert.equal(m.allocate('resource','actorA',2),'ALLOCATED');
  assert.equal(m.borrow('resource','actorA',2),'BORROWED');
  assert.equal(m.transfer('resource','actorA',2,'actorB',3,'LOCAL_MOVE'),'BORROW_LIVE');
  assert.equal(m.release('resource','actorA',2),'RELEASED');
  assert.equal(m.transfer('resource','actorA',2,'actorB',3,'REMOTE'),'SERIALIZATION_REQUIRED');
  assert.equal(m.transfer('resource','actorA',2,'actorB',3,'LOCAL_MOVE'),'MOVED');
  assert.equal(m.reclaim('resource','actorA',2,true),'DENIED');
  assert.equal(m.reclaim('resource','actorB',3,false),'NOT_QUIESCENT');
  assert.equal(m.reclaim('resource','actorB',3,true),'RECLAIMED_MODEL_ONLY');
  assert.equal(m.reclaim('resource','actorB',3,true),'DENIED');
});

test('binary frames parse exact big-endian lengths with a view, not a copy',()=>{
  const bytes=new Uint8Array([1,0,3,10,11,12]);
  const out=inspectBinaryFrame(bytes,3);
  assert.equal(out.length,3);
  assert.equal(out.payload.buffer,bytes.buffer);
  out.payload[0]=99;assert.equal(bytes[3],99);
  assert.equal(out.nativeZeroCopyProven,false);
  for(const input of [new Uint8Array([1,0]),new Uint8Array([2,0,0]),
    new Uint8Array([1,0,5,7]),new Uint8Array([1,0,0,4])])
    assert.throws(()=>inspectBinaryFrame(input),/INVALID_ACTOR_EXECUTION/);
  assert.throws(()=>inspectBinaryFrame(new Uint8Array([1,0,1,7]),0),/INVALID_ACTOR_EXECUTION/);
});

test('reject unsafe protocol inputs and disguised success',()=>{
  for(const change of [s=>s.dataCapacity=0,s=>s.controlCapacity=5,
    s=>s.states=['idle','idle'],s=>s.initial='missing',
    s=>s.transitions=[{from:'idle',event:'begin',to:'busy',authenticated:true}]]) {
    const s=spec();change(s);
    assert.throws(()=>new ActorProtocolOracle(s),/INVALID_ACTOR_EXECUTION/);
  }
  const m=new ActorProtocolOracle(spec());
  assert.throws(()=>m.dispatch(['../../']),/INVALID_ACTOR_EXECUTION/);
  assert.throws(()=>m.sendData({ticket:'../leak',kind:'data',epoch:7}),/INVALID_ACTOR_EXECUTION/);
  assert.throws(()=>runBudgetedReference([{id:'loop',work:-1}]),/INVALID_ACTOR_EXECUTION/);
});

test('CONTROL queued during close cannot disappear or allow premature restart',()=>{
  const m=new ActorProtocolOracle(spec());
  assert.equal(m.sendControl({ticket:'panic',kind:'panic',epoch:7}),'ACCEPTED');
  assert.equal(m.close(),'CLOSED');
  assert.equal(m.drained(),false);
  assert.throws(()=>m.restart(8,'idle'),/INVALID_ACTOR_EXECUTION/);
  assert.equal(m.dispatch([]).ticket,'panic');
  assert.equal(m.drained(),false);
  assert.equal(m.settle('panic'),'SETTLED');
  assert.equal(m.drained(),true);
  assert.throws(()=>m.restart(8,'bogus'),/INVALID_ACTOR_EXECUTION/);
  assert.equal(m.restart(8,'idle'),'RESTARTED_MODEL_ONLY');
});
