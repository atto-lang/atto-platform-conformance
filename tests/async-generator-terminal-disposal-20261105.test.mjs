import test from 'node:test';
import assert from 'node:assert/strict';
import {AsyncGeneratorModel} from '../src/safepoint-policy.mjs';

test('closing a running pull defers disposal until producer exit',()=>{
  const g=new AsyncGeneratorModel();
  g.next();
  assert.equal(g.state,'RUNNING');
  assert.equal(g.pendingPull,true);
  g.close();
  g.close();
  assert.equal(g.state,'CLOSING');
  assert.equal(g.disposals,0);
  assert.throws(()=>g.next(),/concurrent or closed pull/);
  g.producerExited();
  assert.equal(g.state,'CLOSED');
  assert.equal(g.disposals,1);
  assert.equal(g.pendingPull,false);
  g.close();
  assert.equal(g.disposals,1);
  assert.throws(()=>g.producerExited(),/producer exit without close/);
});

test('each generator emission is demand-driven, and closed park is terminal',()=>{
  const g=new AsyncGeneratorModel();
  assert.throws(()=>g.emit(),/emit without pull/);
  g.next();
  assert.throws(()=>g.next(),/concurrent or closed pull/);
  g.emit();
  assert.equal(g.state,'PARKED');
  assert.equal(g.pendingPull,false);
  assert.equal(g.emissions,1);
  g.next();
  g.emit();
  assert.equal(g.emissions,2);
  g.close();
  g.close();
  assert.equal(g.state,'CLOSED');
  assert.equal(g.disposals,1);
  assert.throws(()=>g.next(),/concurrent or closed pull/);
  assert.throws(()=>g.emit(),/emit without pull/);
});
