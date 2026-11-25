import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const load=(topic,oldText,newText,assertion)=>{
 const path=new URL('../src/random-five-'+topic+'-v1.mjs',import.meta.url);
 const source=readFileSync(path,'utf8');
 assert.equal(source.split(oldText).length,2,'mutation anchor must be unique: '+topic);
 const clean=source.replaceAll('export ','');
 const mutant=source.replace(oldText,newText).replaceAll('export ','');
 const evaluate=body=>new Function(body+'\nreturn ('+assertion+')();')();
 return {clean:evaluate(clean),mutant:evaluate(mutant)};
};

test('nested implicit flatten mutant is detected',()=>{
 const x=load('nested-types','ok:equalNestedType(e,a)','ok:true',
  "()=>checkNestedAssignment('Future<int>','Future<Future<int>>').ok");
 assert.equal(x.clean,false);assert.equal(x.mutant,true);
});
test('borrow token reuse ABA mutant is detected',()=>{
 const x=load('ownership','usedTokens.has(e.token)','false',
  "()=>verifyOwnershipTrace([{op:'declare',name:'v',owner:'actorA',mutable:true,sendable:true,kind:'data'},"
 +" {op:'borrow',name:'v',mode:'read',token:'r'},{op:'release',token:'r'},"
 +" {op:'borrow',name:'v',mode:'read',token:'r'},{op:'release',token:'r'}]).ok");
 assert.equal(x.clean,false);assert.equal(x.mutant,true);
});
test('zero-GC positive guest tracing collector mutant is detected',()=>{
 const x=load('zero-gc-metrics','m.guestTracingCollections!==0','false',
  "()=>validateZeroGcMetrics({schema:'atto.zero-gc-metrics/1',backend:'llvm',"
 +" profile:'GUEST_OWNED_ARENA',sourceHead:'a'.repeat(40),compilerDigest:'b'.repeat(64),artifactDigest:'c'.repeat(64),"
 +" job:{runId:1,attempt:1,jobId:1,runnerId:1,steps:[{name:'Execute compiled guest memory profile',status:'completed',conclusion:'success'}]},"
 +" metrics:{iterations:1,hostTracingCollections:0,guestTracingCollections:7,createdActors:1,retiredActors:1,"
 +" peakActorOwnedBytes:10,finalActorOwnedBytes:0,actors:[{actorId:'a',generation:1,allocatedBytes:10,"
 +" reclaimedBytes:10,highWaterBytes:10}]}}).ok");
 assert.equal(x.clean,false);assert.equal(x.mutant,true);
});
test('pubsub early RELIABLE ACK mutant is detected',()=>{
 const x=load('pubsub-delivery',"s.policy==='RELIABLE'&&s.queue.length>=this.capacity",'false',
  "()=>{const b=new ReferenceDeliveryBroker({capacity:1});b.subscribe('s','RELIABLE');"
 +" b.publish('p',1,'one');return b.publish('p',2,'two').status;}");
 assert.equal(x.clean,'WAIT_BACKPRESSURE');assert.equal(x.mutant,'ACK');
});
test('select loser rollback suppression mutant is detected',()=>{
 const x=load('select-arbitration',"if(id!==token)this.rollbacks.push({...entry});",
  "if(false)this.rollbacks.push({...entry});",
  "()=>{const s=new ReferenceSelectArbiter(['a','b']);s.offer('a','one',1);"
 +"s.offer('b','two',2);s.commit('one');return s.snapshot().rollbackPending;}");
 assert.equal(x.clean,1);assert.equal(x.mutant,0);
});
