import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorUpgradeModel,assertSplitPublicationRejected} from '../src/actor-hot-reload-transaction-model.mjs';

test('atomic upgrade waits for executing turn then retires old unpinned generation',()=>{
 const model=new ActorUpgradeModel();
 assert.equal(model.send(1,41),true);
 assert.equal(model.dispatch(),true);
 assert.equal(model.freeze(),true);
 assert.equal(model.publish(),false);
 assert.equal(model.send(2,3),false);
 assert.equal(model.complete(),true);
 assert.equal(model.publish(),true);
 assert.equal(model.revision,2);
 assert.deepEqual(model.authority,{route:2,code:2});
 assert.equal(model.count,42);
 assert.equal(model.retire(),true);
 assert.equal(model.retired.has(1),true);
 assert.equal(model.invariant(),true);
});

test('queued work blocks publication until fully drained without losing receipt identity',()=>{
 const model=new ActorUpgradeModel();
 assert.equal(model.send(1,41),true);
 assert.equal(model.send(2,-1),true);
 assert.equal(model.send(2,7),false);
 assert.equal(model.freeze(),true);
 assert.equal(model.publish(),false);
 assert.equal(model.dispatch(),true);
 assert.equal(model.complete(),true);
 assert.equal(model.publish(),false);
 assert.equal(model.dispatch(),true);
 assert.equal(model.complete(),true);
 assert.equal(model.publish(),true);
 assert.equal(model.completed.size,2);
 assert.equal(model.outputs.length,2);
 assert.equal(model.invariant(),true);
});

test('stopped actors never reopen and a route/code split is detected',()=>{
 const model=new ActorUpgradeModel();
 assert.equal(model.freeze(),true);
 assert.equal(model.stop(),true);
 assert.equal(model.abort(),false);
 assert.equal(model.publish(),false);
 assert.equal(model.send(1,1),false);
 assert.equal(model.terminalEpoch,1);
 assert.equal(model.stop(),false);
 assert.equal(model.invariant(),true);
 assert.throws(()=>assertSplitPublicationRejected(),/SPLIT AUTHORITY/);
});