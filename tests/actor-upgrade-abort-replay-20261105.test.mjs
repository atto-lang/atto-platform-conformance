// Source-free actor-upgrade model. NOT executable AttoLang runtime parity.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorUpgradeModel} from '../src/actor-hot-reload-transaction-model.mjs';

test('aborted freeze does not change revision, and next freeze can commit atomically',()=>{
  const m=new ActorUpgradeModel(), identity=[m.actor,m.heap,m.mailbox];
  assert.equal(m.send(1,41),true);
  assert.equal(m.freeze(),true);
  assert.equal(m.publish(),false); // queued pre-freeze delivery still pending
  assert.equal(m.abort(),true);
  assert.equal(m.send(1,41),false); // accepted replay cannot enter again
  m.dispatch();m.complete();
  assert.equal(m.outputs[0].value,42);
  assert.equal(m.freeze(),true);
  assert.equal(m.publish(),true);
  assert.equal(m.revision,2);
  assert.deepEqual([m.actor,m.heap,m.mailbox],identity);
  assert.equal(m.retire(),true);
  assert.equal(m.invariant(),true);
});

test('stop during frozen upgrade permanently seals ingress and candidate publication',()=>{
  const m=new ActorUpgradeModel();
  m.send(1,5);
  assert.equal(m.freeze(),true);
  assert.equal(m.stop(),true);
  for(const action of [()=>m.send(2,10),()=>m.publish(),()=>m.abort(),
    ()=>m.freeze(),()=>m.dispatch(),()=>m.stop()])
    assert.equal(action(),false);
  assert.equal(m.revision,1);
  assert.equal(m.ingress,'sealed');
  assert.equal(m.invariant(),true);
});
