import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBoundedQueueBackendStatus,BACKENDS} from '../src/bounded-queue-v1.mjs';

const pending=()=>({
 schema:'oreslang.bounded_queue_backend_status.v1',
 contract_id:'bounded-queue-v1',
 source_contract:{repository:'ores-truffle-oreslang/rx-oreslang-channels',pull_request:1,head_commit:'a'.repeat(40),execution_status:'NOT_EXECUTED'},
 records:BACKENDS.map(backend=>({backend,source_lowering:'unsupported',runtime_substrate:'unsupported',guest_execution:'NOT_EXECUTED',reference:{},reason:'pending independent execution'})),
 parity_certified:false,release_ready:false
});

test('pending five-backend manifest remains explicitly noncertifying',()=>{
 const result=validateBoundedQueueBackendStatus(pending());
 assert.deepEqual(result.blocked,BACKENDS);
 assert.equal(result.executedBackendCount,0);
 assert.equal(result.parityCertified,false);
 assert.equal(result.releaseReady,false);
});

test('claimed guest execution, parity or release status is rejected without receipts',()=>{
 for(const patch of [
  s=>s.records[0].guest_execution='EXECUTED',
  s=>s.parity_certified=true,
  s=>s.release_ready=true,
  s=>s.source_contract.execution_status='EXECUTED',
  s=>s.records[1].backend=s.records[0].backend
 ]){
  const status=pending();patch(status);
  assert.throws(()=>validateBoundedQueueBackendStatus(status),/INVALID_BOUNDED_QUEUE_V1/);
 }
});

test('backend record accessors fail without invoking caller-owned code',()=>{
 for(const key of ['backend','guest_execution','reference','reason']){
  const status=pending();let hits=0;
  Object.defineProperty(status.records[0],key,{enumerable:true,get(){hits++;throw Error('hostile accessor ran');}});
  assert.throws(()=>validateBoundedQueueBackendStatus(status),/only enumerable own data fields/);
  assert.equal(hits,0,key);
 }
});