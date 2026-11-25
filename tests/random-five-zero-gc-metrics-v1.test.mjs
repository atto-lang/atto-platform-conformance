import test from 'node:test';
import assert from 'node:assert/strict';
import {validateZeroGcMetrics as check} from '../src/random-five-zero-gc-metrics-v1.mjs';
const receipt=()=>({schema:'atto.zero-gc-metrics/1',backend:'llvm',profile:'GUEST_OWNED_ARENA',
 sourceHead:'a'.repeat(40),compilerDigest:'b'.repeat(64),artifactDigest:'c'.repeat(64),
 job:{runId:11,attempt:1,jobId:13,runnerId:23,steps:[{name:'Execute compiled guest memory profile',status:'completed',conclusion:'success'}]},
 metrics:{iterations:500,hostTracingCollections:0,guestTracingCollections:0,createdActors:2,retiredActors:2,
 peakActorOwnedBytes:2048,finalActorOwnedBytes:0,actors:[
  {actorId:'alpha',generation:1,allocatedBytes:4096,reclaimedBytes:4096,highWaterBytes:2048},
  {actorId:'beta',generation:1,allocatedBytes:4096,reclaimedBytes:4096,highWaterBytes:1024}
 ]}});
const bad=(f,code)=>{const r=receipt();f(r);assert.equal(check(r).diagnostic,code);assert.equal(check(r).guestZeroGcCertified,false);};
test('valid measurement shape is never certification',()=>{
 const r=check(receipt());assert.equal(r.ok,true);
 assert.equal(r.classification,'UNAUTHENTICATED_METRICS_CANDIDATE');
 assert.equal(r.guestZeroGcCertified,false);assert.equal(r.processZeroGcCertified,false);
});
test('Java managed-host guest arena permits observed host GC, never process no-GC',()=>{
 const r=receipt();r.backend='java';r.profile='MANAGED_HOST_GUEST_OWNED';r.metrics.hostTracingCollections=4;
 const out=check(r);assert.equal(out.ok,true);assert.equal(out.scope,'GUEST_ONLY_HOST_GC_OBSERVED');assert.equal(out.processZeroGcCertified,false);
});
test('LLVM and Forge are separately named backends',()=>{
 for(const backend of ['llvm','forge','wasm','net','java']){
  const r=receipt();r.backend=backend;assert.equal(check(r).ok,true);
 }
});
test('reject zero-step, missing runner and forged successful workflow shape',()=>{
 bad(r=>r.job.steps=[],'NO_AUTHENTICATED_EXECUTION_SHAPE');
 bad(r=>r.job.runnerId=0,'NO_AUTHENTICATED_EXECUTION_SHAPE');
 bad(r=>r.job.steps=[{name:'Setup',status:'completed',conclusion:'success'}],'NO_AUTHENTICATED_EXECUTION_SHAPE');
 bad(r=>r.job.steps[0].conclusion='skipped','NO_AUTHENTICATED_EXECUTION_SHAPE');
});
test('reject stale/malformed source and artifact digest identity',()=>{
 bad(r=>r.sourceHead='old','IDENTITY_OR_PROFILE_INVALID');
 bad(r=>r.compilerDigest='d'.repeat(63),'IDENTITY_OR_PROFILE_INVALID');
 bad(r=>r.artifactDigest='','IDENTITY_OR_PROFILE_INVALID');
});
test('reject positive guest tracing collection counters',()=>{
 bad(r=>r.metrics.guestTracingCollections=1,'UNQUALIFIED_MEMORY_METRICS');
});
test('reject missing final actor reclaim and leaked final memory',()=>{
 bad(r=>r.metrics.retiredActors=1,'UNQUALIFIED_MEMORY_METRICS');
 bad(r=>r.metrics.finalActorOwnedBytes=5,'UNQUALIFIED_MEMORY_METRICS');
 bad(r=>r.metrics.actors[0].reclaimedBytes=0,'INVALID_ACTOR_RECLAMATION');
});
test('reject duplicate actor generation and invalid high water',()=>{
 bad(r=>r.metrics.actors[1].actorId='alpha','INVALID_ACTOR_RECLAMATION');
 bad(r=>r.metrics.actors[0].highWaterBytes=8192,'INVALID_ACTOR_RECLAMATION');
});
test('reject unknown/missing metric dimensions',()=>{
 bad(r=>r.metrics.iterations=0,'UNQUALIFIED_MEMORY_METRICS');
 bad(r=>r.metrics.actors=null,'UNQUALIFIED_MEMORY_METRICS');
 bad(r=>r.metrics.hostTracingCollections=-1,'UNQUALIFIED_MEMORY_METRICS');
});
test('no metadata-only receipt can certify zero GC',()=>{
 const x=receipt();x.job.runId=99999;x.job.runnerId=99999;
 assert.equal(check(x).guestZeroGcCertified,false);
});
