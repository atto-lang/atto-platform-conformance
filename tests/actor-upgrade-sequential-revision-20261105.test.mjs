// Source-free actor reference model; not a compiled AttoLang hotloading test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorUpgradeModel} from '../src/actor-hot-reload-transaction-model.mjs';

test('three consecutive generations preserve actor/heap/mailbox and exactly-once delivery',()=>{
  const model=new ActorUpgradeModel();
  const ids=[model.actor,model.heap,model.mailbox];
  assert.equal(model.send(1,41),true);
  assert.equal(model.dispatch(),true);
  assert.equal(model.complete(),true);
  assert.equal(model.outputs[0].value,42);
  for(const generation of [2,3,4]){
    assert.equal(model.freeze(),true);
    assert.equal(model.publish(),true);
    assert.equal(model.revision,generation);
    assert.equal(model.authority.route,model.authority.code);
    assert.equal(model.retire(),true);
    assert.equal(model.send(generation,-1),true);
    assert.equal(model.send(generation,-1),false);
    model.dispatch();model.complete();
  }
  assert.equal(model.outputs.length,4);
  assert.equal(new Set(model.outputs.map(row=>row.id)).size,4);
  assert.deepEqual([model.actor,model.heap,model.mailbox],ids);
  assert.equal(model.onStartRuns,1);
  assert.equal(model.invariant(),true);
});

test('uncompleted prior-generation turn blocks publication until pins drain',()=>{
  const model=new ActorUpgradeModel();
  model.send(1,41);model.dispatch();
  model.freeze();
  assert.equal(model.publish(),false);
  assert.equal(model.retire(),false);
  model.complete();
  assert.equal(model.publish(),true);
  assert.equal(model.retire(),true);
  assert.equal(model.invariant(),true);
});
