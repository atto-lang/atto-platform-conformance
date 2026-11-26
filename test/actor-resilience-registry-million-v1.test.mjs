import test from 'node:test';
import assert from 'node:assert/strict';
import {registry} from '../src/actor-resilience-registry-v1.mjs';

// Sequential reference model, not a native runtime or concurrency receipt.
test('one million incarnations reuse one slot with two outstanding permits and a healthy sibling',()=>{
  const cycles=1_000_000;
  const r=registry({capacity:3,admissions:2,maxIdentity:cycles+2});
  const sibling=r.admit(r.guardian);
  let previous=null,oldPermit=null,oldDecision=null;
  for(let i=0;i<cycles;i++){
    const h=r.admit(r.guardian);assert.ok(h);
    assert.equal(h.slot,2);assert.equal(h.identity,i+3);
    assert.equal(r.occupied(),3);assert.equal(r.admit(r.guardian),null);
    const a=r.beginData(h),b=r.beginData(h);assert.ok(a&&b);
    assert.equal(r.beginData(h),null);
    if(previous){
      assert.equal(r.status(previous),null);
      assert.equal(r.finishData(oldPermit),false);
      assert.equal(r.finishDecision(oldDecision,true),false);
      assert.equal(r.reclaim(previous),false);
    }
    const fault=i%2?'arena_quota':'stack_quota';
    assert.equal(r.fault(h,fault),true);
    assert.equal(r.fault(h,'secondary'),false);
    assert.equal(r.status(h).primary,fault);
    assert.equal(r.beginData(h),null);
    assert.equal(r.observePhysicalRelease(h),false);
    assert.equal(r.finishData(a),true);
    assert.equal(r.observePhysicalRelease(h),false);
    assert.equal(r.finishData(b),true);
    assert.equal(r.observePhysicalRelease(h),true);
    assert.equal(r.recoveryDrained(h),true);
    assert.equal(r.reclaim(h),false);
    const denied=r.beginDecision(h);assert.ok(denied);
    assert.equal(r.finishDecision(denied,false),true);
    const decision=r.beginDecision(h);assert.ok(decision);
    assert.equal(r.finishDecision(denied,true),false);
    assert.equal(r.reclaim(h),false);
    assert.equal(r.finishDecision(decision,true),true);
    assert.equal(r.reclaim(h),true);assert.equal(r.occupied(),2);
    const probe=r.beginData(sibling);assert.ok(probe);
    assert.equal(r.finishData(probe),true);
    assert.equal(r.status(sibling).alive,true);
    previous=h;oldPermit=b;oldDecision=decision;
  }
  assert.equal(r.admit(r.guardian),null,'identity exhaustion cannot wrap');
  assert.equal(r.occupied(),2);assert.equal(r.status(sibling).alive,true);
  assert.equal(r.status(sibling).certified,false);
});
