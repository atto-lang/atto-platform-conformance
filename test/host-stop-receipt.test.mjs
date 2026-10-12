import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostStopReceiptVerifier } from '../bin/verify-host-stop-receipt.mjs';
import { verifySupervisorTrace } from '../bin/verify-supervisor-trace.mjs';

const sourceSha='1111111111111111111111111111111111111111';
const expected={backend:'java',sourceSha,supervisor:'root',child:'child-1',
  actor:'actor-A',generation:1,turn:1,stopPermitId:'stop-ticket-1',
  evidenceId:'receipt-1',receipt:'Uncertain'};
const host={...expected,provenance:'host-lifecycle-owner',effect:'physical-stop',
  status:'applied',operationId:'stop-op-001',stopOperationId:'stop-op-001'};
const trace=()=>({schemaVersion:2,backend:'java',sourceSha,events:[
  {seq:1,op:'register',supervisor:'root',child:'child-1',actor:'actor-A',generation:1},
  {seq:2,op:'cleanup',supervisor:'root',child:'child-1',actor:'actor-A',generation:1},
  {seq:3,op:'finalize',supervisor:'root',child:'child-1',actor:'actor-A',generation:1},
  {seq:4,op:'control.acquire',supervisor:'root',child:'child-1',actor:'actor-A',generation:1,turn:1},
  {seq:5,op:'stop.reserve',supervisor:'root',child:'child-1',actor:'actor-A',generation:1,turn:1,stopPermitId:'stop-ticket-1'},
  {seq:6,op:'stop.invoke',supervisor:'root',child:'child-1',actor:'actor-A',generation:1,turn:1,stopPermitId:'stop-ticket-1'},
  {seq:7,op:'stop.uncertain',supervisor:'root',child:'child-1',actor:'actor-A',generation:1,turn:1,stopPermitId:'stop-ticket-1'},
  {seq:8,op:'supervisor.close',supervisor:'root'},
  {seq:9,op:'stop.proof',supervisor:'root',child:'child-1',actor:'actor-A',generation:1,turn:1,stopPermitId:'stop-ticket-1',evidenceId:'receipt-1'},
  {seq:10,op:'stop.ack',supervisor:'root',child:'child-1',actor:'actor-A',generation:1,turn:1,stopPermitId:'stop-ticket-1'},
  {seq:11,op:'trace.end',status:'completed',recordedEvents:10}
]});
const run=loader=>verifySupervisorTrace(trace(),{expectedSourceSha:sourceSha,
  expectedBackend:'java',verifyProof:createHostStopReceiptVerifier(loader)});

test('actual host-owned applied record reconciles original uncertain turn',()=>{
  let calls=0;
  const result=run(id=>{ calls++; assert.equal(id,'receipt-1'); return host; });
  assert.equal(result.acknowledgments,1);
  assert.equal(calls,1);
});
test('missing, wrong outcome and untrusted record never authorize STOPPED',()=>{
  for(const record of [null,undefined,{...host,status:'uncertain'},
    {...host,status:'pending'}, {...host,provenance:'guest'},
    {...host,effect:'invoked-only'}, {...host,stopOperationId:'other'},
    {...host,operationId:''}])
    assert.throws(()=>run(()=>record),/independent host proof rejected/);
  assert.throws(()=>run(()=>{throw Error('storage down')}),/independent host proof rejected/);
});
test('receipt exact-binding rejects forged and stale identities, origins and turns',()=>{
  for(const [field,value] of Object.entries({
    backend:'llvm',sourceSha:'2222222222222222222222222222222222222222',
    supervisor:'foreign',child:'other',actor:'actor-B',generation:2,
    turn:2,stopPermitId:'stale-ticket',evidenceId:'foreign-proof'
  })) {
    assert.throws(()=>run(()=>({...host,[field]:value})),
      /independent host proof rejected/,field);
  }
});
test('host callback receives only evidence locator, not untrusted full trace',()=>{
  const requests=[];
  const result=run((id)=>{requests.push(id);return host});
  assert.equal(result.completion,'completed');
  assert.deepEqual(requests,['receipt-1']);
});
test('reject loaderless trust or fabricated JSON receipt',()=>{
  assert.throws(()=>createHostStopReceiptVerifier(null),/trusted host receipt loader/);
  assert.throws(()=>run(()=>({...host,provenance:undefined})),/independent host proof rejected/);
  const verifier=createHostStopReceiptVerifier(()=>host);
  assert.equal(verifier({}),false);
});
