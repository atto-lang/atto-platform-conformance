import test from 'node:test';
import assert from 'node:assert/strict';
import {MATRIX,ACTOR_KINDS,pendingReport,evaluateHotReloadReport}
  from '../src/actor-hot-reload-matrix.mjs';
const SHA='a'.repeat(40),TREE='b'.repeat(40),IMAGE='c'.repeat(64);
function syntheticExecuted(transition,actor_kind){
  return {transition,actor_kind,status:'executed',
    source_commit:SHA,source_tree:TREE,compiled_image_sha256:IMAGE,
    ci:{head_sha:SHA,run_id:1,job_id:2,steps_executed:10},
    observed:{actor_id_before:'actor-1',actor_id_after:'actor-1',
      allocation_domain_before:'domain-1',allocation_domain_after:'domain-1',
      heap_id_before:'heap-1',heap_id_after:'heap-1',
      mailbox_id_before:'mailbox-1',mailbox_id_after:'mailbox-1',
      generation_before:3,generation_after:4,
      outputs:[42,43,45],on_start_runs:1,
      old_code_pin_blocked_commit:true,old_code_retired_after_last_pin:true,
      rejected_upgrade_kept_previous_epoch:true,duplicate_delivery_count:0,
      guest_compiled:true,guest_executed:true,real_image_switch:true}};
}
function allSynthetic(){
  const r=pendingReport();
  r.cases=r.cases.map(c=>syntheticExecuted(c.transition,c.actor_kind));return r;
}
const denies=(name,edit)=>test(name,()=>{
  const r=allSynthetic();edit(r);
  assert.throws(()=>evaluateHotReloadReport(r),/evidence rejected/);
});
test('all sixteen backend/mode plus SHARED/PRIVATE paths are necessary',()=>{
  assert.equal(MATRIX.length,8);
  assert.deepEqual(ACTOR_KINDS,['shared','private']);
  assert.equal(new Set(MATRIX).size,8);
  assert.equal(pendingReport().cases.length,16);
  const result=evaluateHotReloadReport(pendingReport());
  assert.equal(result.structurally_passing_cases,0);
  assert.equal(result.required_cases,16);
  assert.equal(result.blocked_cases.length,16);
  assert.equal(result.production_hot_reload_certified,false);
});
test('synthetic observations never authenticate actual compiler execution',()=>{
  const r=evaluateHotReloadReport(allSynthetic());
  assert.equal(r.structurally_complete,true);
  assert.equal(r.authenticated_execution,false);
  assert.equal(r.production_hot_reload_certified,false);
});
denies('duplicate path',r=>r.cases[7].transition=r.cases[0].transition);
denies('missing path',r=>r.cases.pop());
denies('zero-step CI',r=>r.cases[0].ci.steps_executed=0);
denies('different source HEAD',r=>r.cases[0].ci.head_sha='d'.repeat(40));
denies('invalid compiled image digest',r=>r.cases[0].compiled_image_sha256='bad');
denies('actor identity changed',r=>r.cases[0].observed.actor_id_after='other');
denies('actor heap changed',r=>r.cases[0].observed.heap_id_after='other');
denies('private heap changed',r=>r.cases[8].observed.heap_id_after='other');
denies('private code-only upgrade changed allocation domain',
  r=>r.cases[8].observed.allocation_domain_after='other');
denies('shared code-only upgrade changed allocation domain',
  r=>r.cases[0].observed.allocation_domain_after='other');
denies('missing private case despite eight SHARED cases',
  r=>r.cases.splice(8,1));
denies('duplicated shared pair disguised as private',
  r=>r.cases[8].actor_kind='shared');
denies('actor mailbox changed',r=>r.cases[0].observed.mailbox_id_after='other');
denies('epoch rewind',r=>r.cases[0].observed.generation_after=3);
denies('state lost',r=>r.cases[0].observed.outputs=[42,999,1001]);
denies('new on_start reruns',r=>r.cases[0].observed.on_start_runs=2);
denies('premature retirement',r=>r.cases[0].observed.old_code_retired_after_last_pin=false);
denies('in-flight turn allowed to cross versions',r=>r.cases[0].observed.old_code_pin_blocked_commit=false);
denies('aborted upgrade changed authoritative epoch',r=>r.cases[0].observed.rejected_upgrade_kept_previous_epoch=false);
denies('duplicate delivery',r=>r.cases[0].observed.duplicate_delivery_count=1);
denies('guest did not execute',r=>r.cases[0].observed.guest_executed=false);
denies('no compiled code switch',r=>r.cases[0].observed.real_image_switch=false);
denies('blocked fixture contains fake execution record',r=>r.cases[0].status='blocked');
denies('extra unsupported proof field',r=>r.cases[0].certified=true);
denies('untrusted actor requires independent sandbox contract',
  r=>r.cases[0].actor_kind='untrusted');
