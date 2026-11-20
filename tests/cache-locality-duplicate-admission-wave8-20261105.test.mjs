import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCpuLane,selectGpuQueue,mayShareCacheLine} from '../src/cache-locality-oracle.mjs';

const lane = (id, cpu) => ({lane:id,cpu,numa:0,llc:'node0/llc0',queued:0,bound:false});
const request = {kind:'actor',key:'owner',mode:'soft'};

test('duplicate CPU masks and carrier lane identities fail before scheduling', () => {
  assert.throws(() => selectCpuLane({
    allowedCpus:[0,0],carriers:[lane(0,0)],request
  }), e => e.code === 'INVALID_CPU_MASK');
  assert.throws(() => selectCpuLane({
    allowedCpus:[0],carriers:[lane(1,0),lane(1,0)],request
  }), e => e.code === 'INVALID_CARRIERS');
});

test('large soft-affinity candidate scans stay bounded and do not claim OS binding', () => {
  const carriers = Array.from({length:96},(_,i)=>lane(i,i));
  const allowedCpus = Array.from({length:96},(_,i)=>i);
  const answer = selectCpuLane({allowedCpus,carriers,request});
  assert.equal(answer.probes,64);
  assert.equal(answer.mode,'soft');
  assert.equal(answer.observedBound,false);
});

test('stale GPU generations and colliding queue identifiers are never admitted', () => {
  const queue={id:'q',tenant:'A',device:'gpu0',generation:3,usedBytes:1,capacityBytes:8,inflight:0,active:true};
  const args={tenant:'A',device:'gpu0',generation:4,bytes:1,queues:[queue],key:'work'};
  assert.throws(() => selectGpuQueue(args), e => e.code === 'GPU_QUEUE_UNAVAILABLE');
  assert.throws(() => selectGpuQueue({...args,queues:[queue,{...queue}]}),
    e => e.code === 'INVALID_GPU_QUEUE');
});

test('physical cache non-sharing cannot be inferred from untrusted allocation labels', () => {
  const a={allocation:'a',start:0,length:8,baseRemainder:0};
  assert.equal(mayShareCacheLine(a,{...a,start:64}),false);
  assert.equal(mayShareCacheLine(a,{allocation:'b',start:64,length:8,baseRemainder:0}),true);
  assert.throws(() => mayShareCacheLine(a,{...a,baseRemainder:1}),
    e => e.code === 'INVALID_BYTE_RANGE');
});
