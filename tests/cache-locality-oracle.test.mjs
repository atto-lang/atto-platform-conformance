import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCpuLane,selectGpuQueue,mayShareCacheLine,LOCALITY_LIMITS} from '../src/cache-locality-oracle.mjs';
const reject=(code,fn)=>assert.throws(fn,e=>e?.code===code);
const cpu=(lane,cpu,queued=0,numa=0,llc='n0/llc0',bound=false)=>
  ({lane,cpu,queued,numa,llc,bound});
const req=(kind='actor',extra={})=>({kind,key:'stable-actor',mode:'soft',...extra});
const pick=(carriers,request=req(),allowedCpus=[0,1,2,3])=>
  selectCpuLane({allowedCpus,carriers,request});

test('exact CPU outranks qualified LLC, known NUMA, remote fallback',()=>{
 const c=[cpu(0,0,0,1,'n1/llc0'),cpu(1,1,0,0,'n0/llc9'),
   cpu(2,2,0,0,'n0/llc0'),cpu(3,3,0,1,'n1/llc9')];
 assert.equal(pick(c,req('actor',{preferredCpu:3,preferredLlc:'n0/llc0',preferredNuma:0})).lane,3);
 assert.equal(pick(c,req('task',{preferredLlc:'n0/llc0',preferredNuma:1})).lane,2);
 assert.equal(pick(c,req('thread',{preferredNuma:0})).locality,'numa');
 assert.equal(pick(c).locality,'fallback');
});
test('bare LLC id rejected; identical numeric names on other nodes remain distinct',()=>{
 assert.equal(pick([cpu(0,0,0,0,'node0/llc1'),cpu(1,1,0,1,'node1/llc1')],
   req('task',{preferredLlc:'node1/llc1'})).lane,1);
 reject('INVALID_CARRIERS',()=>pick([cpu(0,0,0,0,'1')]));
 reject('INVALID_REQUEST',()=>pick([cpu(0,0)],req('task',{preferredLlc:'1'})));
});
test('reject malformed pseudo-qualified LLC identities before ranking',()=>{
 for(const bad of ['/', '/llc0', 'node0/', 'node0//llc0',
                   'node 0/llc0', 'node0/llc 0', 'node0/llc0/',
                   'node0\n/llc0', 'node0/llc0\t']) {
   reject('INVALID_REQUEST',()=>pick([cpu(0,0)],req('task',{preferredLlc:bad})));
   reject('INVALID_CARRIERS',()=>pick([cpu(0,0,0,0,bad)]));
 }
 // A genuinely domain-qualified label remains an eligible soft preference.
 assert.equal(pick([cpu(0,0,0,0,'pkg0/L3:5'),cpu(1,1,0,0,'pkg1/L3:5')],
                   req('task',{preferredLlc:'pkg1/L3:5'}),[0,1]).lane,1);
});

test('effective allowed cpuset gates every candidate, including zero-depth lanes',()=>{
 assert.equal(pick([cpu(0,0,999),cpu(1,1,10),cpu(2,2,0)],req(),[1]).lane,1);
 reject('NO_ALLOWED_CARRIER',()=>pick([cpu(0,2)],req(),[0]));
 reject('INVALID_CPU_MASK',()=>pick([cpu(0,0)],req(),[0,0]));
});
test('hard CPU pin cannot be forged by logical lane or silently relaxed',()=>{
 const hard=req('thread',{mode:'hard',preferredCpu:2});
 reject('CPU_BINDING_UNAVAILABLE',()=>pick([cpu(0,2)],hard));
 reject('CPU_BINDING_UNAVAILABLE',()=>pick([cpu(0,2,0,0,'n0/llc0',true)],hard,[0]));
 assert.equal(pick([cpu(0,1,0,0,'n0/llc0',true),
   cpu(1,2,0,0,'n0/llc0',true)],hard).lane,1);
 reject('CPU_BINDING_UNAVAILABLE',()=>pick([cpu(0,0)],req('task',{mode:'hard'})));
 reject('CPU_BINDING_UNAVAILABLE',()=>pick([cpu(0,0)],req('task',{mode:'hard',preferredCpu:null})));
});
test('soft overload spills; hard binding remains; previous lane wins equal depth ties',()=>{
 const c=[cpu(0,0,100,0,'n0/llc0',true),cpu(1,1,0,1,'n1/llc0',true)];
 assert.equal(pick(c,req('actor',{preferredCpu:0})).lane,1);
 assert.equal(pick(c,req('thread',{mode:'hard',preferredCpu:0})).lane,0);
 assert.equal(pick([cpu(0,0,4),cpu(1,1,0)],req('task',{preferredCpu:0})).lane,0);
 assert.equal(pick([cpu(5,0,1),cpu(6,1,1)],
   req('actor',{previousLane:5}),[0,1]).lane,5);
});
test('bounded rotating scan remains stable across 256 keys',()=>{
 const c=Array.from({length:256},(_,i)=>cpu(i,i));
 const allowed=c.map(x=>x.cpu);
 const seen=new Set();
 for(let n=0;n<256;n++){
   const chosen=pick(c,req('task',{key:'task-'+n}),allowed);
   assert.equal(chosen.probes,LOCALITY_LIMITS.MAX_PROBES);
   seen.add(chosen.lane);
 }
 assert.ok(seen.size>16);
 assert.deepEqual(pick(c,req('actor',{key:'repeat'}),allowed),
   pick(c,req('actor',{key:'repeat'}),allowed));
});
test('malformed carrier snapshots rejected before dispatch',()=>{
 reject('INVALID_CARRIERS',()=>pick([cpu(0,0),cpu(0,1)]));
 reject('INVALID_CARRIERS',()=>pick([cpu(0,0,-1)]));
 reject('INVALID_REQUEST',()=>pick([cpu(0,0)],req('task',{preferredNuma:-1})));
});

const queue=(id,tenant='A',device='gpu0',generation=2,inflight=0)=>
 ({id,tenant,device,generation,inflight,capacityBytes:1024,usedBytes:24,active:true});
test('GPU selection authenticates requested tenant/device/epoch/budget, no CPU fallback',()=>{
 const queues=[queue('a','A','gpu0',2,2),queue('b','A','gpu0',2,1),
   queue('c','B'),queue('d','A','gpu1'),queue('e','A','gpu0',1)];
 const args={tenant:'A',device:'gpu0',generation:2,bytes:32,queues,key:'job'};
 assert.equal(selectGpuQueue(args).queueId,'b');
 assert.equal(selectGpuQueue(args).providerRevalidationRequired,true);
 reject('GPU_QUEUE_UNAVAILABLE',()=>selectGpuQueue({...args,tenant:'C'}));
 reject('GPU_QUEUE_UNAVAILABLE',()=>selectGpuQueue({...args,device:'gpu2'}));
 reject('GPU_QUEUE_UNAVAILABLE',()=>selectGpuQueue({...args,generation:3}));
 reject('GPU_QUEUE_UNAVAILABLE',()=>selectGpuQueue({...args,bytes:2048}));
 reject('GPU_QUEUE_UNAVAILABLE',()=>selectGpuQueue({...args,
   queues:queues.map(x=>({...x,active:false}))}));
});
test('GPU resource overflow and duplicate queue identities reject',()=>{
 const q={...queue('a'),capacityBytes:Number.MAX_SAFE_INTEGER,
   usedBytes:Number.MAX_SAFE_INTEGER-1};
 const args={tenant:'A',device:'gpu0',generation:2,bytes:2,queues:[q],key:'job'};
 reject('GPU_QUEUE_UNAVAILABLE',()=>selectGpuQueue(args));
 reject('INVALID_GPU_QUEUE',()=>selectGpuQueue({...args,queues:[q,q]}));
 reject('INVALID_GPU_QUEUE',()=>selectGpuQueue({...args,queues:[{...q,usedBytes:Number.MAX_SAFE_INTEGER+1}]}));
 reject('INVALID_GPU_REQUEST',()=>selectGpuQueue({...args,bytes:-1}));
});
test('cache-line proof needs physical base alignment, including between allocations',()=>{
 const a={allocation:'actorA',start:0,length:8,baseRemainder:0};
 assert.equal(mayShareCacheLine(a,{...a,start:56,length:8}),true);
 assert.equal(mayShareCacheLine(a,{...a,start:64,length:8}),false);
 assert.equal(mayShareCacheLine(a,{allocation:'actorB',start:1,length:8}),true);
 // Independently aligned bases cannot establish physical non-overlap;
 // different labels could describe the same allocation.
 assert.equal(mayShareCacheLine(a,{allocation:'actorB',start:1,length:8,baseRemainder:0}),true);
 assert.equal(mayShareCacheLine(a,{allocation:'actorB',start:128,length:8,baseRemainder:0}),true);
 assert.equal(mayShareCacheLine(a,{...a,length:0}),false);
 assert.equal(mayShareCacheLine({...a,start:63,length:2},
   {...a,start:64,length:1}),true);
 // Without a base proof, an apparent logical line boundary can be false.
 assert.equal(mayShareCacheLine({allocation:'actorA',start:56,length:8},
   {allocation:'actorA',start:64,length:8}),true);
 assert.equal(mayShareCacheLine({...a,start:56,length:8,baseRemainder:16},
   {...a,start:64,length:8,baseRemainder:16}),true);
 reject('INVALID_CACHE_LINE',()=>mayShareCacheLine(a,a,63));
 reject('INVALID_BYTE_RANGE',()=>mayShareCacheLine(a,{...a,baseRemainder:64}));
 reject('INVALID_BYTE_RANGE',()=>mayShareCacheLine(a,{...a,baseRemainder:16}));
 reject('INVALID_BYTE_RANGE',()=>mayShareCacheLine(a,
   {...a,start:Number.MAX_SAFE_INTEGER,length:2}));
});


test('reject invalid CPU topology and integer overflow boundaries',()=>{
 const base=[cpu(0,0)];
 reject('INVALID_CPU_MASK',()=>pick(base,req(),[Number.MAX_SAFE_INTEGER+1]));
 reject('INVALID_CPU_MASK',()=>pick(base,req(),[]));
 reject('INVALID_CARRIERS',()=>pick([cpu(0,Number.MAX_SAFE_INTEGER+1)]));
 reject('INVALID_CARRIERS',()=>pick([cpu(0,0,Number.MAX_SAFE_INTEGER+1)]));
 reject('INVALID_CARRIERS',()=>pick([cpu(0,0,0,-1)]));
 reject('INVALID_REQUEST',()=>pick(base,req('task',{preferredCpu:Infinity})));
 reject('INVALID_REQUEST',()=>pick(base,req('task',{previousLane:1.5})));
});
test('reject GPU queue arithmetic overflow and invalid epoch before selection',()=>{
 const args={tenant:'A',device:'gpu0',generation:2,bytes:1,
   queues:[queue('a')],key:'job'};
 reject('INVALID_GPU_REQUEST',()=>selectGpuQueue({...args,bytes:Number.MAX_SAFE_INTEGER+1}));
 reject('INVALID_GPU_REQUEST',()=>selectGpuQueue({...args,generation:-1}));
 reject('INVALID_GPU_QUEUE',()=>selectGpuQueue({...args,
   queues:[{...queue('a'),capacityBytes:-1}]}));
 reject('INVALID_GPU_QUEUE',()=>selectGpuQueue({...args,
   queues:[{...queue('a'),inflight:Infinity}]}));
 reject('INVALID_GPU_QUEUE',()=>selectGpuQueue({...args,
   queues:[{...queue('a'),usedBytes:1025}]}));
});
