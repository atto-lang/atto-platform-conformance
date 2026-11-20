import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingReport,evaluateHotReloadReport,MATRIX,ACTOR_KINDS} from '../src/actor-hot-reload-matrix.mjs';
const rejected=(report,pattern)=>assert.throws(()=>evaluateHotReloadReport(report),pattern);

test('all sixteen pending actor transition cases are blocked, never certified',()=>{
  const pending=pendingReport();
  assert.equal(pending.cases.length,16);
  assert.equal(new Set(pending.cases.map(c=>c.actor_kind+'|'+c.transition)).size,16);
  assert.equal(MATRIX.length,8);
  assert.deepEqual(ACTOR_KINDS,['shared','private']);
  const result=evaluateHotReloadReport(pending);
  assert.equal(result.structurally_passing_cases,0);
  assert.equal(result.blocked_cases.length,16);
  assert.equal(result.authenticated_execution,false);
  assert.equal(result.production_hot_reload_certified,false);
});

test('duplicate or missing actor case cannot be accepted as complete',()=>{
  const p=pendingReport();p.cases[1]={...p.cases[0]};
  rejected(p,/duplicate actor-kind \/ transition/);
  const absent=pendingReport();absent.cases.pop();
  rejected(absent,/must include all sixteen/);
});

test('blocked status cannot claim execution, a CI run or an image identity',()=>{
  for (const key of ['ci','observed','source_tree','compiled_image_sha256']) {
    const p=pendingReport();p.cases[0][key]=key==='ci'?{steps_executed:1}:'forged';
    rejected(p,/blocked case contains fake execution evidence/);
  }
});

test('self-reported executed status with no exact-head receipt is rejected',()=>{
  const p=pendingReport();p.cases[0].status='executed';
  rejected(p,/invalid exact-head source\/image fields/);
});
