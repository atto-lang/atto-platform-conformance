import test from 'node:test';
import assert from 'node:assert/strict';
import {replayDesignTrace} from './replay.mjs';
const E = (scenario,events) => ({schema:'attolang.formal.actor-trace.v1',scenario,events});
const critical=()=>E('critical-generation',[
 {op:'critical_enter',actor:'a',gen:1,task:'one',mode:'read'},
 {op:'critical_enter',actor:'a',gen:1,task:'two',mode:'read'},
 {op:'critical_exit',actor:'a',gen:1,task:'one'},
 {op:'critical_exit',actor:'a',gen:1,task:'two'},
 {op:'suspend',actor:'a',gen:1,task:'one'},
 {op:'resume',actor:'a',gen:1,task:'one'},
 {op:'retire',actor:'a',gen:1},
 {op:'restart',actor:'a',gen:1},
 {op:'stale_permit_denied',actor:'a',gen:2,permitGen:1,task:'one'}
]);
const panic=()=>E('panic-control',[
 {op:'deliver_data',actor:'a',gen:1},
 {op:'panic',actor:'a',gen:1},
 {op:'control_notice',actor:'a',gen:1}
]);
const pubsub=()=>E('reliable-pubsub',[
 {op:'join',sub:'s',gen:1},
 {op:'publish_request',sub:'s',gen:1,publisher:'p0',sequence:1},
 {op:'publish_admit',sub:'s',gen:1,publisher:'p0',sequence:1},
 {op:'publish_request',sub:'s',gen:1,publisher:'p1',sequence:1},
 {op:'publish_pending',sub:'s',gen:1,publisher:'p1',sequence:1},
 {op:'ack',sub:'s',gen:1,publisher:'p0',sequence:1},
 {op:'cancel_pending',sub:'s',gen:1,publisher:'p1',sequence:1},
 {op:'deliver',sub:'s',gen:1,publisher:'p0',sequence:1},
 {op:'leave',sub:'s',gen:1},
 {op:'join',sub:'s',gen:2},
 {op:'publish_request',sub:'s',gen:2,publisher:'p0',sequence:1},
 {op:'publish_admit',sub:'s',gen:2,publisher:'p0',sequence:1},
 {op:'ack',sub:'s',gen:2,publisher:'p0',sequence:1},
 {op:'deliver',sub:'s',gen:2,publisher:'p0',sequence:1},
 {op:'leave',sub:'s',gen:2},
 {op:'close_group'}
]);
function denied(input,reason=/FORMAL_REFINEMENT_REJECTED:/) {
  assert.throws(()=>replayDesignTrace(input),reason);
}
function dropOp(x,op,ordinal=0) {
  let count=0;
  const i=x.events.findIndex(e=>e.op===op && count++===ordinal);
  assert(i>=0,'missing '+op+' index '+ordinal);
  x.events.splice(i,1);
}
function op(x,name,ordinal=0) { const found=x.events.filter(e=>e.op===name)[ordinal];assert(found);return found; }
for (const [name,make] of [['critical generations',critical],['panic CONTROL',panic],['RELIABLE pubsub',pubsub]]) {
 test('accepts bounded '+name+' trace shape WITHOUT runtime authentication',()=>{
  const result=replayDesignTrace(make());
  assert.equal(result.classification,'DESIGN_TRACE_SHAPE_ONLY');
  assert.equal(result.traceShapeValid,true);
  assert.equal(result.compiledGuestAuthenticated,false);
  assert.equal(result.runtimeAuthenticated,false);
  assert.equal(result.fiveBackendParity,false);
  assert.equal(result.mergerReady,false);
 });
}
const tests = [
 ['exclusive writer overlap',()=>{const x=critical();op(x,'critical_enter',1).mode='write';return x;}],
 ['suspend under held permit',()=>{const x=critical();op(x,'critical_exit',0).op='suspend';return x;}],
 ['skipped actor generation',()=>{const x=critical();op(x,'stale_permit_denied').permitGen=3;return x;}],
 ['data delivery after panic',()=>{const x=panic();x.events.push({op:'deliver_data',actor:'a',gen:1});return x;}],
 ['missing supervisor notice',()=>{const x=panic();dropOp(x,'control_notice');return x;}],
 ['early acknowledgement under backpressure',()=>{const x=pubsub();op(x,'ack',0).publisher='p1';return x;}],
 ['delivery of cancelled pending publisher',()=>{const x=pubsub();op(x,'deliver',0).publisher='p1';return x;}],
 ['stale generation delivery after leave/rejoin',()=>{const x=pubsub();op(x,'deliver',1).gen=1;return x;}],
 ['duplicate acknowledgement',()=>{const x=pubsub();const i=x.events.findIndex(e=>e.op==='ack');x.events.splice(i+1,0,{...x.events[i]});return x;}],
 ['publication after group close',()=>{const x=pubsub();x.events.push({op:'publish_request',sub:'s',gen:2,publisher:'p0',sequence:2});return x;}],
 ['missing pending cancellation on leave',()=>{const x=pubsub();dropOp(x,'cancel_pending');return x;}],
 ['extra event keys',()=>{const x=pubsub();x.events[0].extraneous='accepted';return x;}],
 ['duplicate actor restart',()=>{const x=critical();x.events.push({op:'restart',actor:'a',gen:2});return x;}],
 ['actor identity switch',()=>{const x=panic();op(x,'panic').actor='other';return x;}],
 ['unbounded trace',()=>{const x=pubsub();x.events.push(...Array(129).fill({op:'close_group'}));return x;}],
 ['publisher-edge out-of-order admission',()=>{const x=pubsub();op(x,'publish_admit',1).sequence=0;return x;}],
 ['repeated admitted sequence after delivery',()=>{const x=pubsub();const i=x.events.findIndex(e=>e.op==='deliver');x.events.splice(i+1,0,{op:'publish_admit',sub:'s',gen:1,publisher:'p0',sequence:1});return x;}],
 ['pending admission on full queue',()=>{const x=pubsub();op(x,'publish_pending').op='publish_admit';return x;}],
 ['critical trace with no permit acquisition witness',()=>E('critical-generation',[
  {op:'suspend',actor:'a',gen:1,task:'one'},{op:'resume',actor:'a',gen:1,task:'one'}])],
 ['pubsub trace with join and close but no publication',()=>E('reliable-pubsub',[
  {op:'join',sub:'s',gen:1},{op:'close_group'}])],
 ['admission without a publication request',()=>{const x=pubsub();dropOp(x,'publish_request',0);return x;}],
 ['pending without a publication request',()=>{const x=pubsub();dropOp(x,'publish_request',1);return x;}],
 ['non-contiguous first publisher sequence',()=>{const x=pubsub();op(x,'publish_request',0).sequence=2;return x;}],
 ['duplicated publish request',()=>{const x=pubsub();const i=x.events.findIndex(e=>e.op==='publish_request');x.events.splice(i+1,0,{...x.events[i]});return x;}],
 ['admit after canceled pending operation',()=>{const x=pubsub();const i=x.events.findIndex(e=>e.op==='cancel_pending');x.events.splice(i+1,0,{op:'publish_admit',sub:'s',gen:1,publisher:'p1',sequence:1});return x;}],
 ['unaccounted accepted work on leave',()=>{const x=pubsub();dropOp(x,'deliver',0);return x;}],
 ['unaccounted accepted work on group close',()=>{const x=pubsub();dropOp(x,'deliver',1);dropOp(x,'leave',1);return x;}],
 ['retirement with suspended task',()=>{const x=critical();dropOp(x,'resume');return x;}],
 ['resume without suspension',()=>{const x=critical();dropOp(x,'suspend');return x;}],
 ['double suspension',()=>{const x=critical();const i=x.events.findIndex(e=>e.op==='suspend');x.events.splice(i+1,0,{...x.events[i]});return x;}],
 ['acquire critical permit while task suspended',()=>{const x=critical();const i=x.events.findIndex(e=>e.op==='suspend');x.events.splice(i+1,0,{op:'critical_enter',actor:'a',gen:1,task:'one',mode:'read'});return x;}],
 ['fabricated stale denial without previously issued permit',()=>{const x=critical();op(x,'stale_permit_denied').task='two';dropOp(x,'critical_enter',1);dropOp(x,'critical_exit',1);return x;}],
 ['too many publisher identities',()=>{const x=pubsub();const i=x.events.findIndex(e=>e.op==='leave');x.events.splice(i,0,{op:'publish_request',sub:'s',gen:1,publisher:'p2',sequence:1});return x;}],
 ['sequence above bounded model max',()=>{const x=pubsub();op(x,'publish_request',1).sequence=3;return x;}],
 ['unknown operation',()=>{const x=pubsub();op(x,'join').op='not_a_real_operation';return x;}],
 ['accessor event field',()=>{const x=critical();Object.defineProperty(x.events[0],'mode',{get:()=> 'read',enumerable:true});return x;}],
 ['extra trace envelope field',()=>{const x=critical();x.runId=5;return x;}]
];
for (const [name,build] of tests) test('rejects '+name,()=>denied(build()));

test('accepts second same-publisher publication after first completed within one generation',()=>{
 const x=pubsub();
 const i=x.events.findIndex(e=>e.op==='leave');
 x.events.splice(i,0,
  {op:'publish_request',sub:'s',gen:1,publisher:'p0',sequence:2},
  {op:'publish_admit',sub:'s',gen:1,publisher:'p0',sequence:2},
  {op:'ack',sub:'s',gen:1,publisher:'p0',sequence:2},
  {op:'deliver',sub:'s',gen:1,publisher:'p0',sequence:2});
 assert.equal(replayDesignTrace(x).traceShapeValid,true);
});
test('accepts pending request admitted only after capacity is released',()=>{
 const x=pubsub();dropOp(x,'cancel_pending');
 const i=x.events.findIndex(e=>e.op==='leave');
 x.events.splice(i,0,
  {op:'publish_admit',sub:'s',gen:1,publisher:'p1',sequence:1},
  {op:'ack',sub:'s',gen:1,publisher:'p1',sequence:1},
  {op:'deliver',sub:'s',gen:1,publisher:'p1',sequence:1});
 assert.equal(replayDesignTrace(x).traceShapeValid,true);
});
test('previous-generation permit remains revoked after a fresh permit is acquired',()=>{
 const x=critical();
 const i=x.events.findIndex(e=>e.op==='stale_permit_denied');
 x.events.splice(i,0,
  {op:'critical_enter',actor:'a',gen:2,task:'one',mode:'write'},
  {op:'critical_exit',actor:'a',gen:2,task:'one'});
 assert.equal(replayDesignTrace(x).traceShapeValid,true);
});
test('new negative controls reject for their specific contract reasons',()=>{
 const missingRequest=pubsub();dropOp(missingRequest,'publish_request',0);
 denied(missingRequest,/admission without request/);
 const missingWitness=E('reliable-pubsub',[
  {op:'join',sub:'s',gen:1},{op:'close_group'}]);
 denied(missingWitness,/vacuous scenario/);
 const interrupted=critical();dropOp(interrupted,'resume');
 denied(interrupted,/retire with outstanding critical permits or suspended tasks/);
 const extraPublisher=pubsub();const i=extraPublisher.events.findIndex(e=>e.op==='leave');
 extraPublisher.events.splice(i,0,{op:'publish_request',sub:'s',gen:1,publisher:'p2',sequence:1});
 denied(extraPublisher,/publisher bound or non-contiguous publish request/);
});

test('accepts explicitly accounted old-generation discard on subscription leave',()=>{
 const x=pubsub();dropOp(x,'deliver',0);
 const i=x.events.findIndex(e=>e.op==='leave');
 x.events.splice(i,0,{op:'discard_queued',sub:'s',gen:1,publisher:'p0',sequence:1,reason:'leave'});
 assert.equal(replayDesignTrace(x).traceShapeValid,true);
});
test('rejects an old-generation discard without its matching leave boundary',()=>{
 const x=pubsub();dropOp(x,'deliver',0);
 const i=x.events.findIndex(e=>e.op==='leave');
 x.events.splice(i,0,{op:'discard_queued',sub:'s',gen:1,publisher:'p0',sequence:1,reason:'close'});
 denied(x,/discard must immediately precede/);
});
test('rejects a second ACK after an explicitly discarded queued publication',()=>{
 const x=pubsub();dropOp(x,'deliver',0);
 const i=x.events.findIndex(e=>e.op==='leave');
 x.events.splice(i,0,{op:'discard_queued',sub:'s',gen:1,publisher:'p0',sequence:1,reason:'leave'},
  {op:'ack',sub:'s',gen:1,publisher:'p0',sequence:1});
 denied(x,/discard must immediately precede/);
});
