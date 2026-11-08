import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {admitSafePoint,budgetDecision,mayEnterActorWhileParked,HandoffModel,AsyncGeneratorModel} from '../src/safepoint-policy.mjs';
const matrix=JSON.parse(await readFile(new URL('../fixtures/safepoints/admission-cases.json',import.meta.url),'utf8'));
test('schema/version; real backend evidence is pending',()=>{
 assert.equal(matrix.schemaVersion,1);assert.equal(matrix.contract,'oreslang-safe-suspension-v1');
 assert.deepEqual(matrix.backendEvidence,{java:'pending',llvm:'pending',wasm:'pending',browser:'pending'});
 assert.equal(new Set(matrix.cases.map(c=>c.id)).size,matrix.cases.length);
});
for(const c of matrix.cases)test('model: '+c.id,()=>{
 const {id,expect,reason,...context}=c;
 const r=admitSafePoint(context);assert.equal(r.decision,expect,id);
 if(reason)assert.equal(r.reason,reason,id);
});
test('time OR reductions trigger only at a proven poll with runnable peer',()=>{
 const s={hasHeapContinuation:true};
 assert.equal(budgetDecision({...s,reductions:511,elapsedNs:1_999_999}).decision,'CONTINUE');
 assert.equal(budgetDecision({...s,reductions:512,elapsedNs:1}).decision,'HANDOFF');
 assert.equal(budgetDecision({...s,reductions:1,elapsedNs:2_000_000}).decision,'HANDOFF');
 // Time sampling may wait until the next probe, but a 512-reduction
 // dispatch is already overdue and must be observed at this backedge.
 assert.equal(budgetDecision({...s,reductions:511,elapsedNs:9_000_000,probeDue:false}).decision,'CONTINUE');
 assert.equal(budgetDecision({...s,reductions:512,elapsedNs:1,probeDue:false}).decision,'HANDOFF');
 assert.equal(budgetDecision({...s,reductions:999,elapsedNs:9_000_000,probeDue:false}).decision,'HANDOFF');
 assert.equal(budgetDecision({...s,reductions:999,elapsedNs:9_000_000,peerRunnable:false}).decision,'CONTINUE');
 assert.equal(budgetDecision({...s,reductions:999,elapsedNs:9_000_000,liveBorrow:true}).decision,'DEFER');
});
test('physical handoff is not actor re-entrancy; serial actors always exclude',()=>{
 assert.equal(mayEnterActorWhileParked({reason:'cooperate',reentryPolicy:true}),false);
 assert.equal(mayEnterActorWhileParked({reason:'await',reentryPolicy:true}),true);
 assert.equal(mayEnterActorWhileParked({reason:'await',serialActor:true,reentryPolicy:true}),false);
 assert.equal(mayEnterActorWhileParked({reason:'await',reentryPolicy:true,exclusiveStateLoan:true}),false);
 assert.equal(mayEnterActorWhileParked({reason:'await',reentryPolicy:true,criticalTicket:true}),false);
});
test('carrier-exit-before-publish and exactly-once effects',()=>{
 const t=new HandoffModel();t.commitEffect();t.requestCooperate();
 assert.throws(()=>t.resume(),/overlapping/);t.carrierExited();t.resume();t.commitEffect();t.complete();
 assert.equal(t.completions,1);assert.equal(t.sideEffects,2);assert.equal(t.epochs,1);
 assert.throws(()=>t.resume(),/overlapping/);
});
test('2000 stackless modeled handoffs do not replay committed work',()=>{
 const t=new HandoffModel();
 for(let i=0;i<2000;i++){t.commitEffect();t.requestCooperate();t.carrierExited();t.resume();}
 t.complete();assert.equal(t.epochs,2000);assert.equal(t.sideEffects,2000);
});
test('cancellation finalizes after physical exit, only once',()=>{
 const t=new HandoffModel();t.requestCooperate();t.cancel();t.cancel();
 assert.equal(t.finalizers,0);assert.throws(()=>t.resume(),/overlapping/);
 t.carrierExited();assert.equal(t.finalizers,1);assert.equal(t.carrierActive,false);
});
test('async generator serial pull, demand-driven yield and single close',()=>{
 const g=new AsyncGeneratorModel();g.next();assert.throws(()=>g.next(),/concurrent/);
 g.emit();g.next();g.emit();g.close();g.close();
 assert.equal(g.emissions,2);assert.equal(g.disposals,1);assert.throws(()=>g.next(),/closed/);
});
test('generator close mid-pull waits for physical producer exit',()=>{
 const g=new AsyncGeneratorModel();g.next();g.close();assert.equal(g.disposals,0);
 assert.throws(()=>g.emit(),/without pull/);g.producerExited();g.close();
 assert.equal(g.disposals,1);assert.equal(g.pendingPull,false);
});
