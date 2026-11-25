import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingReport,evaluateHotReloadReport,MATRIX,ACTOR_KINDS}
 from '../src/actor-hot-reload-matrix.mjs';

const exactObservation=()=>({
 actor_id_before:'actor-a',actor_id_after:'actor-a',
 heap_id_before:'heap-a',heap_id_after:'heap-a',
 allocation_domain_before:'domain-a',allocation_domain_after:'domain-a',
 mailbox_id_before:'mailbox-a',mailbox_id_after:'mailbox-a',
 generation_before:1,generation_after:2,outputs:[42,43,45],on_start_runs:1,
 old_code_pin_blocked_commit:true,old_code_retired_after_last_pin:true,
 rejected_upgrade_kept_previous_epoch:true,duplicate_delivery_count:0,
 guest_compiled:true,guest_executed:true,real_image_switch:true
});

test('pending model tracks all sixteen backend/mode/actor-kind cases as unexecuted',()=>{
 const p=pendingReport(),result=evaluateHotReloadReport(p);
 assert.equal(MATRIX.length,8);
 assert.equal(ACTOR_KINDS.length,2);
 assert.equal(p.cases.length,16);
 assert.equal(result.required_cases,16);
 assert.equal(result.structurally_passing_cases,0);
 assert.equal(result.blocked_cases.length,16);
 assert.equal(result.authenticated_execution,false);
 assert.equal(result.production_hot_reload_certified,false);
});

test('duplicate transitions, fake blocked evidence, and zero-step CI cannot be admitted',()=>{
 const duplicated=pendingReport();
 duplicated.cases[1]={...duplicated.cases[0]};
 assert.throws(()=>evaluateHotReloadReport(duplicated),/duplicate actor-kind/);
 const forged=pendingReport();
 forged.cases[0].source_commit='a'.repeat(40);
 assert.throws(()=>evaluateHotReloadReport(forged),/fake execution evidence/);
 const zero=pendingReport();
 Object.assign(zero.cases[0],{status:'executed',source_commit:'a'.repeat(40),
  source_tree:'b'.repeat(40),compiled_image_sha256:'c'.repeat(64),
  ci:{head_sha:'a'.repeat(40),run_id:1,job_id:2,steps_executed:0},
  observed:exactObservation()});
 assert.throws(()=>evaluateHotReloadReport(zero),/wrong CI head or zero-step job/);
});

test('even a valid shape-only guest claim cannot self-certify host provenance',()=>{
 const report=pendingReport();
 Object.assign(report.cases[0],{status:'executed',source_commit:'a'.repeat(40),
  source_tree:'b'.repeat(40),compiled_image_sha256:'c'.repeat(64),
  ci:{head_sha:'a'.repeat(40),run_id:1,job_id:2,steps_executed:3},
  observed:exactObservation()});
 const result=evaluateHotReloadReport(report);
 assert.equal(result.structurally_passing_cases,1);
 assert.equal(result.structurally_complete,false);
 assert.equal(result.authenticated_execution,false);
 assert.equal(result.production_hot_reload_certified,false);
});
