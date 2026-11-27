import test from 'node:test';
import assert from 'node:assert/strict';
import {registry} from '../src/actor-resilience-registry-v1.mjs';

function* permutations(values) {
  if (!values.length) { yield []; return; }
  for (let i=0; i<values.length; i++) {
    for (const rest of permutations(values.filter((_, j)=>i!==j))) yield [values[i], ...rest];
  }
}

// Sequential reference-data oracle only. Physical release is synthetic.
for (const fault of ['stack_quota', 'arena_quota']) {
  test(`registry retirement order and reuse: ${fault}`, () => {
    let schedules=0, prematureDenials=0;
    for (const order of permutations(['permit','physical','decision','recovery','descendant','reclaim'])) {
      const r=registry({capacity:4, admissions:1});
      const parent=r.admit(r.guardian), child=r.admit(parent), sibling=r.admit(r.guardian);
      assert.ok(parent && child && sibling);
      const permit=r.beginData(parent); assert.ok(permit);
      assert.equal(r.fault(parent,fault),true);
      assert.equal(r.fault(parent,'secondary'),false);
      const decision=r.beginDecision(parent); assert.ok(decision);
      const done=new Set();
      const ready=()=>['permit','physical','decision','recovery','descendant'].every(x=>done.has(x));
      function step(op) {
        switch(op) {
          case 'permit': assert.equal(r.finishData(permit),true); break;
          case 'physical': {
            const allowed=done.has('permit');
            assert.equal(r.observePhysicalRelease(parent),allowed);
            if(!allowed)return;
            break;
          }
          case 'decision': assert.equal(r.finishDecision(decision,true),true); break;
          case 'recovery': assert.equal(r.recoveryDrained(parent),true); break;
          case 'descendant': {
            assert.equal(r.fault(child,'parent_cancel'),true);
            const d=r.beginDecision(child); assert.ok(d);
            assert.equal(r.finishDecision(d,true),true);
            assert.equal(r.recoveryDrained(child),true);
            assert.equal(r.observePhysicalRelease(child),true);
            assert.equal(r.reclaim(child),true);
            break;
          }
          case 'reclaim': {
            assert.equal(r.reclaim(parent),ready());
            if(!ready()){prematureDenials++;return;}
            break;
          }
        }
        done.add(op);
      }
      for(const op of order) {
        step(op);
        if(!done.has('reclaim')) {
          const status=r.status(parent); assert.ok(status);
          assert.equal(status.primary,fault);
          assert.equal(status.certified,false);
          assert.equal(r.beginData(parent),null);
          assert.equal(r.admit(parent),null);
          if(!ready()) assert.equal(r.reclaim(parent),false);
        }
      }
      for(const op of ['permit','physical','decision','recovery','descendant','reclaim']) {
        if(!done.has(op)) step(op);
      }
      assert.equal(r.status(parent),null);
      const replacement=r.admit(r.guardian); assert.ok(replacement);
      assert.equal(replacement.slot,parent.slot);
      assert.notEqual(replacement.identity,parent.identity);
      assert.equal(r.finishData(permit),false);
      assert.equal(r.finishDecision(decision,true),false);
      assert.equal(r.reclaim(parent),false);
      assert.equal(r.status(replacement).alive,true);
      const siblingPermit=r.beginData(sibling); assert.ok(siblingPermit);
      assert.equal(r.finishData(siblingPermit),true);
      assert.equal(r.status(sibling).alive,true);
      schedules++;
    }
    assert.equal(schedules,720);
    assert.ok(prematureDenials>0);
  });
}
