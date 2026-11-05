import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCpuLane,selectGpuQueue,mayShareCacheLine}
 from '../src/cache-locality-oracle.mjs';

const carrier=(lane,cpu,queued,bound)=>({lane,cpu,queued,bound,numa:0,llc:'node0/llc0'});
const request={kind:'actor',key:'actor1',mode:'soft',preferredCpu:0};

test('soft CPU affinity spills under bounded backlog while hard bind requires OS proof',()=>{
 const carriers=[carrier(0,0,10,false),carrier(1,1,0,true)];
 const soft=selectCpuLane({allowedCpus:[0,1],carriers,request});
 assert.equal(soft.lane,1);
 assert.equal(soft.mode,'soft');
 assert.throws(()=>selectCpuLane({allowedCpus:[0,1],carriers,
  request:{...request,mode:'hard'}}),e=>e.code==='CPU_BINDING_UNAVAILABLE');
 const hard=selectCpuLane({allowedCpus:[0,1],
  carriers:[carrier(0,0,10,true),carrier(1,1,0,true)],
  request:{...request,mode:'hard'}});
 assert.equal(hard.cpu,0);
 assert.equal(hard.observedBound,true);
});

test('GPU queue returns only a provisional identity requiring provider revalidation',()=>{
 const queues=[
  {id:'stale',tenant:'A',device:'gpu0',generation:4,usedBytes:0,capacityBytes:100,inflight:0,active:true},
  {id:'current',tenant:'A',device:'gpu0',generation:5,usedBytes:40,capacityBytes:100,inflight:1,active:true}
 ];
 const args={tenant:'A',device:'gpu0',generation:5,bytes:60,queues,key:'work'};
 const selected=selectGpuQueue(args);
 assert.equal(selected.queueId,'current');
 assert.equal(selected.generation,5);
 assert.equal(selected.providerRevalidationRequired,true);
 assert.ok(Object.isFrozen(selected));
 assert.throws(()=>selectGpuQueue({...args,bytes:61}),e=>e.code==='GPU_QUEUE_UNAVAILABLE');
});

test('cache-line overlap decisions remain conservative without trusted physical provenance',()=>{
 const a={allocation:'a',start:0,length:8,baseRemainder:0};
 assert.equal(mayShareCacheLine(a,{...a,start:64,length:8}),false);
 assert.equal(mayShareCacheLine(a,{...a,start:63,length:8}),true);
 assert.equal(mayShareCacheLine(a,{...a,start:64,length:8,baseRemainder:null}),false);
 const unknown={allocation:'a',start:0,length:8};
 assert.equal(mayShareCacheLine(unknown,{...unknown,start:64,length:8}),true);
 assert.equal(mayShareCacheLine(a,{allocation:'different',start:1024,length:8,baseRemainder:0}),true);
 assert.throws(()=>mayShareCacheLine(a,a,48),e=>e.code==='INVALID_CACHE_LINE');
});
