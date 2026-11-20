import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKENDS,validateBoundedQueueBackendStatus
} from '../src/bounded-queue-v1.mjs';

const pending=()=>({
  schema:'oreslang.bounded_queue_backend_status.v1',contract_id:'bounded-queue-v1',
  source_contract:{
    repository:'ores-truffle-oreslang/rx-oreslang-channels',
    pull_request:1,head_commit:'a'.repeat(40),execution_status:'NOT_EXECUTED'
  },
  records:BACKENDS.map(backend=>({
    backend,source_lowering:'unsupported',runtime_substrate:'unsupported',
    guest_execution:'NOT_EXECUTED',reference:{},reason:'source and guest not executed'
  })),
  parity_certified:false,release_ready:false
});

test('all five pending backend receipts remain explicitly unexecuted',()=>{
  const result=validateBoundedQueueBackendStatus(pending());
  assert.equal(result.ok,true);
  assert.equal(result.backendCount,5);
  assert.equal(result.executedBackendCount,0);
  assert.equal(result.parityCertified,false);
  assert.equal(result.releaseReady,false);
  assert.deepEqual(result.blocked,BACKENDS);
});

test('a pending receipt cannot silently assert source, guest, parity or release success',()=>{
  for(const mutate of [
    s=>{s.source_contract.execution_status='PASSED';},
    s=>{s.records[0].guest_execution='PASSED';},
    s=>{s.parity_certified=true;},
    s=>{s.release_ready=true;},
    s=>{s.records[0].source_lowering='implemented';},
    s=>{s.records[0].runtime_substrate='implemented';}
  ]){
    const record=pending();mutate(record);
    assert.throws(()=>validateBoundedQueueBackendStatus(record),
      /INVALID_BOUNDED_QUEUE_V1/);
  }
});

test('duplicate or foreign backend identities cannot forge the five-backend count',()=>{
  const duplicate=pending();
  duplicate.records[1].backend=duplicate.records[0].backend;
  assert.throws(()=>validateBoundedQueueBackendStatus(duplicate),/duplicate backend/);
  const foreign=pending();foreign.records[4].backend='oreslang-source.thirdparty';
  assert.throws(()=>validateBoundedQueueBackendStatus(foreign),/foreign or duplicate backend/);
});

test('accessor-backed status fields never execute arbitrary caller callbacks',()=>{
  let calls=0;
  const status=pending();
  Object.defineProperty(status.records[2],'guest_execution',{enumerable:true,get(){
    calls++;throw Error('guest execution getter ran');
  }});
  assert.throws(()=>validateBoundedQueueBackendStatus(status),
    /only enumerable own data fields/);
  assert.equal(calls,0);
  const nested=pending();
  Object.defineProperty(nested.source_contract,'head_commit',{enumerable:true,get(){
    calls++;throw Error('source commit getter ran');
  }});
  assert.throws(()=>validateBoundedQueueBackendStatus(nested),
    /only enumerable own data fields/);
  assert.equal(calls,0);
});
