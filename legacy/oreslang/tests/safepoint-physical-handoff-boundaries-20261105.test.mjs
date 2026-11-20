import test from 'node:test';
import assert from 'node:assert/strict';
import {HandoffModel} from '../src/safepoint-policy.mjs';

test('cooperative handoff cannot resume before physical carrier exit',()=>{
  const m=new HandoffModel();
  assert.equal(m.state,'RUNNING');
  m.commitEffect();
  m.requestCooperate();
  assert.equal(m.state,'UNWINDING');
  assert.equal(m.carrierActive,true);
  assert.throws(()=>m.resume(),/overlapping resume/);
  assert.throws(()=>m.commitEffect(),/not running/);
  assert.equal(m.epochs,0);
  m.carrierExited();
  assert.equal(m.state,'RUNNABLE');
  assert.equal(m.carrierActive,false);
  m.resume();
  assert.equal(m.state,'RUNNING');
  assert.equal(m.epochs,1);
  m.commitEffect();
  m.complete();
  assert.equal(m.completions,1);
  assert.equal(m.sideEffects,2);
  assert.equal(m.carrierActive,false);
  assert.throws(()=>m.resume(),/overlapping resume/);
  assert.throws(()=>m.complete(),/not running/);
});

test('cancellation during unwind finalizes once after physical exit',()=>{
  const m=new HandoffModel();
  m.requestCooperate();
  m.cancel();
  assert.equal(m.state,'CANCEL_PENDING');
  assert.equal(m.finalizers,0);
  assert.equal(m.carrierActive,true);
  m.carrierExited();
  assert.equal(m.state,'CANCELLED');
  assert.equal(m.carrierActive,false);
  assert.equal(m.finalizers,1);
  m.cancel();m.cancel();
  assert.equal(m.finalizers,1);
  assert.throws(()=>m.resume(),/overlapping resume/);
  assert.throws(()=>m.carrierExited(),/invalid physical exit/);
});
