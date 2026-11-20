import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorUpgradeModel} from '../src/actor-hot-reload-transaction-model.mjs';

test('duplicate and noninteger message identities never enter accepted queue',()=>{
 const model=new ActorUpgradeModel();
 assert.equal(model.send(1,2),true);
 for(const [id,delta] of [[1,2],[2,NaN],[2,1.5],[Number.MAX_SAFE_INTEGER+1,1]])
  assert.equal(model.send(id,delta),false);
 assert.equal(model.queue.length,1);
 assert.equal(model.dispatch(),true);assert.equal(model.complete(),true);
 assert.equal(model.send(1,3),false);
 assert.equal(model.outputs.length,1);
 assert.equal(model.invariant(),true);
});
test('abort unfreezes admission without losing queued work or replaying on_start',()=>{
 const model=new ActorUpgradeModel();
 assert.equal(model.send(1,4),true);
 assert.equal(model.freeze(),true);
 assert.equal(model.send(2,1),false);
 assert.equal(model.abort(),true);
 assert.equal(model.publish(),false);
 assert.equal(model.send(2,1),true);
 while(model.dispatch())assert.equal(model.complete(),true);
 assert.deepEqual(model.outputs.map(o=>o.id),[1,2]);
 assert.equal(model.onStartRuns,1);
 assert.equal(model.invariant(),true);
});
test('postpublication negative delta is a generation-specific model rule',()=>{
 const model=new ActorUpgradeModel();
 assert.equal(model.freeze(),true);assert.equal(model.publish(),true);
 assert.equal(model.send(1,-3),true);
 assert.equal(model.dispatch(),true);assert.equal(model.complete(),true);
 assert.equal(model.outputs[0].generation,2);
 assert.equal(model.count,4);
 assert.equal(model.invariant(),true);
});
test('terminal stop remains sealed through rejected upgrade transitions',()=>{
 const model=new ActorUpgradeModel();
 assert.equal(model.stop(),true);
 assert.equal(model.stop(),false);
 assert.equal(model.freeze(),false);
 assert.equal(model.abort(),false);
 assert.equal(model.publish(),false);
 assert.equal(model.send(1,1),false);
 assert.equal(model.terminalEpoch,1);
 assert.equal(model.invariant(),true);
});
