import test from 'node:test';
import assert from 'node:assert/strict';
import {registry} from '../src/actor-resilience-registry-v1.mjs';

function complete(r,h){
  assert.equal(r.fault(h,'primary'),true);
  assert.equal(r.fault(h,'secondary'),false);
  const d=r.beginDecision(h);assert.ok(d);
  assert.equal(r.finishDecision(d,true),true);
  assert.equal(r.recoveryDrained(h),true);
  assert.equal(r.observePhysicalRelease(h),true);
  return d;
}

test('100000 retire/reuse cycles preserve bounded capacity and stale identity rejection',()=>{
  const r=registry({capacity:2});let previous=null,oldDecision=null,oldPermit=null;
  for(let i=0;i<100000;i++){
    const h=r.admit(r.guardian);assert.ok(h);assert.equal(h.slot,1);assert.equal(h.identity,i+2);
    assert.equal(r.occupied(),2);assert.equal(r.admit(r.guardian),null);
    const permit=r.beginData(h);assert.ok(permit);
    if(previous){assert.equal(r.status(previous),null);assert.equal(r.beginData(previous),null);
      assert.equal(r.reclaim(previous),false);assert.equal(r.finishDecision(oldDecision,true),false);
      assert.equal(r.finishData(oldPermit),false);}
    assert.equal(r.finishData(permit),true);assert.equal(r.finishData(permit),false);
    const decision=complete(r,h);
    assert.equal(r.reclaim(h),true);assert.equal(r.reclaim(h),false);assert.equal(r.occupied(),1);
    previous=h;oldDecision=decision;oldPermit=permit;
  }
});

test('parent reclamation waits for descendant, I/O, decision, recovery and physical evidence',()=>{
  const r=registry({capacity:4,admissions:1});const p=r.admit(r.guardian),c=r.admit(p),b=r.admit(r.guardian);
  const io=r.beginData(p);assert.ok(io);assert.equal(r.beginData(p),null);
  assert.equal(r.fault(p,'stack_quota'),true);assert.equal(r.status(c).fenced,true);
  assert.equal(r.admit(p),null);assert.equal(r.beginData(c),null);assert.equal(r.reclaim(p),false);
  const d=r.beginDecision(p);assert.ok(d);assert.equal(r.beginDecision(p),null);
  assert.equal(r.observePhysicalRelease(p),false);assert.equal(r.reclaim(p),false);
  assert.equal(r.finishDecision(d,false),true);assert.equal(r.status(p).pending,true);
  assert.equal(r.finishDecision(d,true),false);const d2=r.beginDecision(p);assert.ok(d2);
  assert.equal(r.finishDecision(d2,true),true);assert.equal(r.reclaim(p),false);
  assert.equal(r.finishData(io),true);assert.equal(r.observePhysicalRelease(p),true);
  assert.equal(r.reclaim(p),false);assert.equal(r.recoveryDrained(p),true);
  assert.equal(r.reclaim(p),false,'descendant still registered');
  complete(r,c);assert.equal(r.reclaim(c),true);assert.equal(r.reclaim(p),true);
  const bp=r.beginData(b);assert.ok(bp);assert.equal(r.finishData(bp),true);
  assert.equal(r.status(b).alive,true);assert.equal(r.status(b).certified,false);
});

test('identity exhaustion does not wrap, and structurally equal handles have no authority',()=>{
  const r=registry({capacity:2,maxIdentity:3});const a=r.admit(r.guardian);
  assert.equal(r.status({...a}),null);assert.equal(r.beginData({...a}),null);
  complete(r,a);assert.equal(r.reclaim(a),true);const b=r.admit(r.guardian);assert.equal(b.identity,3);
  complete(r,b);assert.equal(r.reclaim(b),true);assert.equal(r.admit(r.guardian),null);
  assert.equal(r.occupied(),1);assert.equal(r.reclaim(r.guardian),false);
  for(const opts of [{capacity:1},{capacity:4097},{maxIdentity:0},{admissions:0}])
    assert.throws(()=>registry(opts),RangeError);
});

test('pending CONTROL and each decision lease independently hold a physically retired slot',()=>{
  const r=registry({capacity:2,admissions:1});const h=r.admit(r.guardian);
  assert.ok(h);assert.equal(r.fault(h,'stack_quota'),true);
  assert.equal(r.recoveryDrained(h),true);
  assert.equal(r.observePhysicalRelease(h),true);
  assert.equal(r.reclaim(h),false,'pending CONTROL without a decision lease');
  assert.equal(r.admit(r.guardian),null);
  const d=r.beginDecision(h);assert.ok(d);
  assert.equal(r.reclaim(h),false,'decision in flight');
  assert.equal(r.finishDecision(d,false),true);
  assert.equal(r.reclaim(h),false,'aborted decision must leave CONTROL pending');
  const retry=r.beginDecision(h);assert.ok(retry);assert.notEqual(retry,d);
  assert.equal(r.finishDecision(d,true),false,'obsolete decision cannot clear pending CONTROL');
  assert.equal(r.reclaim(h),false);
  assert.equal(r.finishDecision(retry,true),true);
  assert.equal(r.reclaim(h),true);
  const next=r.admit(r.guardian);assert.ok(next);assert.equal(next.slot,h.slot);
  assert.notEqual(next.identity,h.identity);
});
