import test from 'node:test';
import assert from 'node:assert/strict';
import {ExecutionContextQuantumModel,hasYieldFreeCycle} from '../src/execution-context-quantum-model.mjs';
test('empty infinite loop cooperates after bounded backedges, no clock per iteration',()=>{
 let time=0;const t=new ExecutionContextQuantumModel({clock:()=>time,every:64,reductions:512});
 for(let i=0;i<511;i++)assert.equal(t.backedge('loop-backedge'),'RUN');
 assert.equal(t.backedge('loop-backedge'),'HANDOFF');
 assert.equal(t.clockReads,9); // 1 dispatch start + 512 / 64 probes
 assert.equal(t.totalBackedges,512);
 assert.equal(t.pendingPC,'loop-backedge');assert.equal(t.unwindStack.length,0);
});
test('deadline reached with less than 512 reductions triggers on next batch',()=>{
 let time=0;const t=new ExecutionContextQuantumModel({clock:()=>time,every:64});
 for(let i=0;i<63;i++)assert.equal(t.backedge('next'),'RUN');
 time=2_010_000;assert.equal(t.backedge('next'),'HANDOFF');assert.equal(t.clockReads,2);
});
test('no timer read every iteration and deadline uses new dispatch start',()=>{
 let time=0;const t=new ExecutionContextQuantumModel({clock:()=>time,every:64,reductions:64});
 for(let i=0;i<64;i++)t.backedge('committed');
 t.carrierExited();time=30_000_000_000;assert.equal(t.resume(),'committed');
 assert.equal(t.reductionsRemaining,64);
 time+=1;for(let i=0;i<63;i++)assert.equal(t.backedge('again'),'RUN');
 assert.equal(t.clockReads,3); // 1 constructor + 1 earlier slow path + 1 on resume
 assert.equal(t.backedge('again'),'HANDOFF');
 assert.equal(t.clockReads,4);
});
test('physical exit gates resume and preserves task identity, cleanup obligations',()=>{
 let now=0;const t=new ExecutionContextQuantumModel({clock:()=>now,every:2,reductions:2});
 t.registerDefer('outer');t.registerDefer('inner');
 t.backedge('pc1');assert.equal(t.backedge('pc2'),'HANDOFF');
 assert.throws(()=>t.resume(),/physical exit/);
 assert.deepEqual(t.unwindStack,['outer','inner']);t.carrierExited();
 now=100;assert.equal(t.resume(),'pc2');assert.equal(t.executionEpoch,1);
 assert.deepEqual(t.unwindStack,['outer','inner']);
 assert.equal(t.leaseHeld,true);
});
test('cancellation while unwinding waits for carrier exit then drains LIFO once',()=>{
 const t=new ExecutionContextQuantumModel({clock:()=>0,every:2,reductions:2});
 t.registerDefer('outer');t.registerDefer('inner');
 t.backedge('loop');t.backedge('loop');t.cancel();
 assert.equal(t.completedCleanup.length,0);
 assert.throws(()=>t.drainCancelledCleanup(),/own non-running lane/);
 t.carrierExited();t.drainCancelledCleanup();t.cancel();
 assert.deepEqual(t.completedCleanup,['inner','outer']);
 assert.equal(t.leaseHeld,false);assert.equal(t.phase,'CANCELLED');
});
test('logical fuel must not reset even when soft quantum resets',()=>{
 let clock=0;const t=new ExecutionContextQuantumModel({clock:()=>clock,every:2,reductions:2,fuel:4});
 for(let i=0;i<2;i++)t.backedge('same');
 t.carrierExited();t.resume();
 for(let i=0;i<2;i++)t.backedge('same');
 t.carrierExited();t.resume();
 assert.equal(t.fuel,0);
 assert.throws(()=>t.backedge('same'),/fuel exhausted/);
});
test('no peer => keep running with new timer slow-path checks',()=>{
 const t=new ExecutionContextQuantumModel({clock:()=>0,every:2,reductions:2});
 assert.equal(t.backedge('loop',{peerRunnable:false}),'RUN');
 assert.equal(t.backedge('loop',{peerRunnable:false}),'RUN');
 assert.equal(t.phase,'RUNNING');
});
test('unsafe yield deferred; compile-time CFG must reject endless unsafe cycle',()=>{
 const t=new ExecutionContextQuantumModel({clock:()=>0,every:2,reductions:2});
 t.backedge('unsafe',{provenSafePoint:false});
 assert.equal(t.backedge('unsafe',{provenSafePoint:false}),'DEFER');
 assert.equal(t.phase,'RUNNING');
 assert.equal(hasYieldFreeCycle({nodes:[{id:'start'},{id:'critical-loop'}],edges:[['start','critical-loop'],['critical-loop','critical-loop']],entry:'start'}),true);
});
test('safepoint at loop backedge cuts all unbounded CFG cycles',()=>{
 const graph={nodes:[{id:'entry'},{id:'body'},{id:'backedge',safePoint:true}],
 edges:[['entry','body'],['body','backedge'],['backedge','body']],entry:'entry'};
 assert.equal(hasYieldFreeCycle(graph),false);
});
test('SCC with one safe loop and one unsafe loop still fails proof',()=>{
 const graph={nodes:[{id:'body'},{id:'probe',safePoint:true},{id:'other'}],
 edges:[['body','probe'],['probe','body'],['body','other'],['other','body']],entry:'body'};
 assert.equal(hasYieldFreeCycle(graph),true);
});
test('unreachable infinite loop is ignored, but reachable recursion is caught',()=>{
 assert.equal(hasYieldFreeCycle({nodes:[{id:'entry'},{id:'unused'}],edges:[['unused','unused']],entry:'entry'}),false);
 assert.equal(hasYieldFreeCycle({nodes:[{id:'entry'},{id:'foo'},{id:'bar'}],edges:[['entry','foo'],['foo','bar'],['bar','foo']],entry:'entry'}),true);
});
