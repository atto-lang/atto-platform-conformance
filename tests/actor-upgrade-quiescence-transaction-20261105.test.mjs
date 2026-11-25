import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorUpgradeModel} from '../src/actor-hot-reload-transaction-model.mjs';

test('two previously admitted turns must both drain before atomic generation publication',()=>{
 const m=new ActorUpgradeModel(),ids=[m.actor,m.heap,m.mailbox];
 assert.equal(m.send(101,10),true);
 assert.equal(m.send(102,-3),true);
 assert.equal(m.freeze(),true);
 assert.equal(m.publish(),false);
 assert.equal(m.dispatch(),true);
 assert.equal(m.dispatch(),true);
 assert.equal(m.publish(),false);
 assert.equal(m.complete(),true);
 assert.equal(m.publish(),false);
 assert.equal(m.complete(),true);
 assert.equal(m.publish(),true);
 assert.deepEqual(m.outputs.map(o=>o.value),[11,8]);
 assert.equal(m.revision,2);
 assert.equal(m.retire(),true);
 assert.deepEqual([m.actor,m.heap,m.mailbox],ids);
 assert.equal(m.invariant(),true);
});

test('abort reopens ingress without discarding accepted message identity',()=>{
 const m=new ActorUpgradeModel();
 assert.equal(m.send(1,2),true);
 assert.equal(m.freeze(),true);
 assert.equal(m.send(2,3),false);
 assert.equal(m.abort(),true);
 assert.equal(m.send(1,7),false);
 assert.equal(m.send(2,3),true);
 assert.equal(m.dispatch(),true);
 assert.equal(m.complete(),true);
 assert.equal(m.dispatch(),true);
 assert.equal(m.complete(),true);
 assert.deepEqual(m.outputs.map(o=>o.id),[1,2]);
 assert.equal(m.invariant(),true);
});

test('terminal stop seals acceptance and increments stop epoch once',()=>{
 const m=new ActorUpgradeModel();
 assert.equal(m.freeze(),true);
 assert.equal(m.stop(),true);
 assert.equal(m.stop(),false);
 assert.equal(m.publish(),false);
 assert.equal(m.abort(),false);
 assert.equal(m.send(7,1),false);
 assert.equal(m.terminalEpoch,1);
 assert.equal(m.ingress,'sealed');
 assert.equal(m.invariant(),true);
});
