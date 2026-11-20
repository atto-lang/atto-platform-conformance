import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorUpgradeModel,assertSplitPublicationRejected}
  from '../src/actor-hot-reload-transaction-model.mjs';

test('same actor/heap/mailbox survives v1 42 -> v2 43 and 45',()=>{
  const s=new ActorUpgradeModel(),ids=[s.actor,s.heap,s.mailbox];
  assert.equal(s.send(1,41),true);s.dispatch();s.complete();
  assert.equal(s.outputs[0].value,42);
  assert.equal(s.freeze(),true);assert.equal(s.publish(),true);assert.equal(s.retire(),true);
  assert.equal(s.send(2,-1),true);s.dispatch();s.complete();
  assert.equal(s.send(3,-2),true);s.dispatch();s.complete();
  assert.deepEqual(s.outputs.map(x=>x.value),[42,43,45]);
  assert.deepEqual([s.actor,s.heap,s.mailbox],ids);
  assert.equal(s.onStartRuns,1);assert.equal(s.revision,2);
});
test('suspended old code lease blocks publication and reclamation',()=>{
  const s=new ActorUpgradeModel();
  assert.equal(s.send(1,41),true);assert.equal(s.dispatch(),true);
  assert.equal(s.freeze(),true);assert.equal(s.send(2,-1),false);
  assert.equal(s.publish(),false);assert.equal(s.retire(),false);
  assert.equal(s.complete(),true);assert.equal(s.publish(),true);
  assert.equal(s.retire(),true);assert.equal(s.send(2,-1),true);
  s.dispatch();s.complete();assert.deepEqual(s.outputs.map(x=>x.value),[42,43]);
});
test('previously admitted message drains before generation changes',()=>{
  const s=new ActorUpgradeModel();s.send(1,41);s.freeze();
  assert.equal(s.publish(),false);s.dispatch();
  assert.equal(s.publish(),false);s.complete();assert.equal(s.publish(),true);
});
test('aborted upgrade restores previous code and ingress',()=>{
  const s=new ActorUpgradeModel();s.freeze();assert.equal(s.abort(),true);
  assert.equal(s.revision,1);assert.equal(s.authority.code,1);assert.equal(s.send(1,41),true);
});
test('commit never permits implicit rollback of already published code',()=>{
  const s=new ActorUpgradeModel();s.freeze();s.publish();
  assert.equal(s.abort(),false);assert.equal(s.revision,2);
});
test('stop is terminal, including pending freeze ticket',()=>{
  const s=new ActorUpgradeModel();s.freeze();s.stop();
  assert.equal(s.publish(),false);assert.equal(s.abort(),false);
  assert.equal(s.send(1,41),false);assert.equal(s.ingress,'sealed');
});
test('retransmission cannot duplicate accepted actor delivery',()=>{
  const s=new ActorUpgradeModel();assert.equal(s.send(1,41),true);
  assert.equal(s.send(1,41),false);s.dispatch();s.complete();
  assert.equal(s.send(1,41),false);assert.equal(s.outputs.length,1);
});
test('detect split code CAS / scheduler route publication',()=>{
  assert.throws(assertSplitPublicationRejected,/SPLIT AUTHORITY/);
});
test('59,049 adversarial five-step schedules preserve invariants',()=>{
  const commands=['send1','send2','dispatch','complete','freeze','publish',
    'abort','retire','stop'];
  let checked=0;
  function walk(prefix,depth){
    if(depth===0){
      const s=new ActorUpgradeModel();
      for(const command of prefix)s.step(command);
      checked++;return;
    }
    for(const command of commands)walk([...prefix,command],depth-1);
  }
  walk([],5);
  assert.equal(checked,59049);
});
