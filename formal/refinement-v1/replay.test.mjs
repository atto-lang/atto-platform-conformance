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
 {op:'publish_admit',sub:'s',gen:1,publisher:'p0',sequence:1},
 {op:'publish_pending',sub:'s',gen:1,publisher:'p1',sequence:1},
 {op:'ack',sub:'s',gen:1,publisher:'p0',sequence:1},
 {op:'cancel_pending',sub:'s',gen:1,publisher:'p1',sequence:1},
 {op:'deliver',sub:'s',gen:1,publisher:'p0',sequence:1},
 {op:'leave',sub:'s',gen:1},
 {op:'join',sub:'s',gen:2},
 {op:'publish_admit',sub:'s',gen:2,publisher:'p0',sequence:1},
 {op:'ack',sub:'s',gen:2,publisher:'p0',sequence:1},
 {op:'deliver',sub:'s',gen:2,publisher:'p0',sequence:1},
 {op:'leave',sub:'s',gen:2},
 {op:'close_group'}
]);
function denied(input,what) {assert.throws(()=>replayDesignTrace(input),/FORMAL_REFINEMENT_REJECTED:/,what);}
function mutate(input,i,f) {const x=structuredClone(input);f(x.events[i]);return x;}
for(const [name,make] of [['critical generations',critical],['panic CONTROL',panic],['RELIABLE pubsub',pubsub]]) {
 test('accepts bounded '+name+' trace shape without claiming runtime proof',()=>{
  const result=replayDesignTrace(make());
  assert.equal(result.classification,'DESIGN_TRACE_SHAPE_ONLY');
  assert.equal(result.traceShapeValid,true);
  assert.equal(result.compiledGuestAuthenticated,false);
  assert.equal(result.runtimeAuthenticated,false);
  assert.equal(result.fiveBackendParity,false);
  assert.equal(result.mergerReady,false);
 });
}
test('rejects exclusive writer overlap',()=>{const x=critical();x.events[1].mode='write';denied(x);});
test('rejects suspend under held permit',()=>{const x=critical();x.events[2].op='suspend';x.events[2].task='one';denied(x);});
test('rejects skipped actor generation',()=>{const x=critical();x.events[7].permitGen=3;denied(x);});
test('rejects data delivery after panic',()=>{const x=panic();x.events.push({op:'deliver_data',actor:'a',gen:1});denied(x);});
test('rejects missing supervisor notice',()=>{const x=panic();x.events.pop();denied(x);});
test('rejects early acknowledgement under capacity',()=>{const x=pubsub();x.events[3].publisher='p1';denied(x);});
test('rejects delivery of cancelled pending publisher',()=>{const x=pubsub();x.events[5].publisher='p1';denied(x);});
test('rejects stale generation delivery after leave/rejoin',()=>{const x=pubsub();x.events[10].gen=1;denied(x);});
test('rejects duplicate acknowledgement',()=>{const x=pubsub();x.events.splice(4,0,{...x.events[3]});denied(x);});
test('rejects publication after group close',()=>{const x=pubsub();x.events.push({op:'publish_admit',sub:'s',gen:2,publisher:'p0',sequence:2});denied(x);});
test('rejects missing pending cancellation on leave',()=>{const x=pubsub();x.events.splice(4,1);denied(x);});
test('rejects unrecognized op and extra event keys',()=>{const x=pubsub();x.events[0].extraneous='accepted';denied(x);});
test('rejects duplicate actor restart',()=>{const x=critical();x.events.push({op:'restart',actor:'a',gen:2});denied(x);});
test('rejects actor identity switch',()=>{const x=panic();x.events[1].actor='other';denied(x);});
test('rejects unbounded trace',()=>{const x=pubsub();x.events.push(...Array(129).fill({op:'close_group'}));denied(x);});
test('rejects publisher-edge out-of-order admission',()=>{const x=pubsub();x.events[8].sequence=0;denied(x);});
test('rejects repeated admitted sequence after delivery',()=>{
 const x=pubsub();x.events.splice(6,0,{op:'publish_admit',sub:'s',gen:1,publisher:'p0',sequence:1});denied(x);
});
test('rejects pending admission on full queue',()=>{
 const x=pubsub();x.events[2].op='publish_admit';denied(x);
});
