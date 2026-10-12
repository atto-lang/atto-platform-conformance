import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonicalSignedStopReceipt, createSignedStopReceiptVerifier
} from '../bin/verify-signed-stop-receipt.mjs';
import { verifySupervisorTrace } from '../bin/verify-supervisor-trace.mjs';

const sourceSha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const {privateKey, publicKey} = generateKeyPairSync('ed25519');
const trustedPublicKeyPem=publicKey.export({type:'spki',format:'pem'});
const base={
  backend:'llvm', sourceSha, supervisor:'root-supervisor', child:'child-1',
  actor:'physical-actor-9', generation:1, turn:1,
  stopPermitId:'stop-permit-123', evidenceId:'receipt-host-123',
  operationId:'host-operation-123', status:'applied'
};
const signed = (changes={}) => {
  const payload={...base,...changes};
  return {...payload,signature:sign(null,canonicalSignedStopReceipt(payload),privateKey)
    .toString('base64')};
};
const proof = {
  backend:'llvm',sourceSha,supervisor:base.supervisor,child:base.child,
  actor:base.actor,generation:base.generation,turn:base.turn,
  stopPermitId:base.stopPermitId,evidenceId:base.evidenceId,receipt:'Uncertain'
};
const makeVerifier = (receipts=[signed()],changes={}) =>
  createSignedStopReceiptVerifier({
    trustedPublicKeyPem,receipts,expectedSourceSha:sourceSha,
    expectedBackend:'llvm',...changes
  });

test('valid host-signed receipt binds the exact STOP nonce and physical incarnation',()=>{
  const verify=makeVerifier();
  assert.equal(verify(proof),true);
  for (const [field,wrong] of Object.entries({
    sourceSha:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    backend:'java',supervisor:'other',child:'child-2',
    actor:'recycled-actor',generation:2,turn:2,
    stopPermitId:'foreign-ticket',evidenceId:'other-receipt'
  })) assert.equal(verify({...proof,[field]:wrong}),false,field);
  assert.equal(verify(null),false);
});

test('tampering, wrong trust anchor, and duplicate effects fail closed',()=>{
  const good=signed();
  assert.throws(()=>makeVerifier([{...good,actor:'different'}]),/tampered/);
  assert.throws(()=>makeVerifier([{...good,signature:'bad!'}]),/signature encoding/);
  assert.throws(()=>makeVerifier([good,good]),/duplicate host STOP receipt/);
  assert.throws(()=>makeVerifier([good,signed({evidenceId:'another'})]),
    /duplicate host STOP receipt/);
  assert.throws(()=>makeVerifier([signed({sourceSha:
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'})]),/foreign source/);
  assert.throws(()=>makeVerifier([good],{expectedSourceSha:'bad'}),/checkout SHA/);
  const foreignKey=generateKeyPairSync('ed25519').publicKey.export({
    type:'spki',format:'pem'
  });
  assert.throws(()=>makeVerifier([good],{trustedPublicKeyPem:foreignKey}),/tampered/);
  assert.throws(()=>canonicalSignedStopReceipt({...base,status:'uncertain'}),/incomplete/);
});

test('a STOP uncertain after supervisor shutdown needs the signed external proof',()=>{
  const root={child:base.child,supervisor:base.supervisor,
    actor:base.actor,generation:1};
  const event=(seq,op,rest={})=>({seq,op,...root,...rest});
  const events=[
    event(1,'register'), event(2,'cleanup'), event(3,'finalize'),
    event(4,'control.acquire',{turn:1}),
    event(5,'stop.reserve',{turn:1,stopPermitId:base.stopPermitId}),
    event(6,'stop.invoke',{turn:1,stopPermitId:base.stopPermitId}),
    event(7,'stop.uncertain',{turn:1,stopPermitId:base.stopPermitId}),
    event(8,'supervisor.close'),
    event(9,'stop.proof',{turn:1,stopPermitId:base.stopPermitId,
      evidenceId:base.evidenceId}),
    event(10,'stop.ack',{turn:1,stopPermitId:base.stopPermitId}),
    {seq:11,op:'trace.end',status:'completed',recordedEvents:10}
  ];
  const doc={schemaVersion:2,backend:'llvm',sourceSha,events};
  assert.throws(()=>verifySupervisorTrace(doc,{expectedSourceSha:sourceSha,
    expectedBackend:'llvm'}),/trusted independent host proof verifier required/);
  assert.equal(verifySupervisorTrace(doc,{expectedSourceSha:sourceSha,
    expectedBackend:'llvm',verifyProof:makeVerifier()}).acknowledgments,1);
  assert.throws(()=>verifySupervisorTrace({...doc,sourceSha:
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'},{
    expectedSourceSha:sourceSha,verifyProof:makeVerifier()
  }),/source SHA does not match/);
  const forged={...doc,events:events.map(e=>e.op==='stop.proof'
    ? {...e,evidenceId:'forged'}:e)};
  assert.throws(()=>verifySupervisorTrace(forged,{
    expectedSourceSha:sourceSha,verifyProof:makeVerifier()
  }),/independent host proof rejected/);
});
