import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {M0AdmissionLedger} from '../bin/mcp-m0-admission-ledger.mjs';

// Public deterministic vector, not a secret credential or backend attestation.
// A byte-identical result requires the real Node crypto implementation.
const KEY=Buffer.alloc(32,17);
const PRINCIPAL_SHA256='d64b514c312e63d7a0fdef1947bdb7e4b5dc0a940df09798f9040a7604e0aa5e';
const UNKNOWN_SHA256='18e459e151cd321dc0d450670104ed612b40f27157cf8bcda36a02e2c6c40c87';
const WALL=1793664000000;
function request() {
  return {
    jsonrpc:'2.0',id:'req',method:'resources/read',
    params:{uri:'atto-dev://runtime/r1/tenant/t1/process/summary',
      _meta:{
        'io.modelcontextprotocol/protocolVersion':'2026-07-28',
        'io.modelcontextprotocol/clientCapabilities':{sampling:{}},
        'io.atto.dev/security':{
          schema_version:'atto.mcp.dev-control.m0.v1',
          nonce:'a'.repeat(32),issued_at_ms:WALL,
          runtime_id:'r1',tenant_id:'t1',expected_generation:1
        }
      }
    }
  };
}
function beginArgs() {
  return {
    peerAuthenticated:true,hostBootId:'boot-1',
    hostRuntimeGeneration:1,wallNowMs:WALL,monotonicNowMs:1000,
    frameBytes:512,jsonDepth:5,
    credential:{
      principal_id:'p1',boot_id:'boot-1',runtime_id:'r1',tenant_id:'t1',
      generation:1,expires_at_ms:WALL+100000,
      scopes:['inspect:summary']
    },
    request:request()
  };
}
test('Node HMAC-SHA256 public identity vector is pinned',()=>{
  assert.equal(createHmac('sha256',KEY).update('p1').digest('hex'),PRINCIPAL_SHA256);
  assert.equal(createHmac('sha256',KEY).update('unknown').digest('hex'),UNKNOWN_SHA256);
});
test('ledger HMAC hashes are stable after caller mutates its original key buffer',()=>{
  const audit=[];
  const mutable=Buffer.from(KEY);
  const ledger=new M0AdmissionLedger({
    enabled:true,auditKey:mutable,
    audit(record){audit.push(record);return true;}
  });
  mutable.fill(0);
  const admitted=ledger.begin(beginArgs());
  assert.equal(admitted.ok,true);
  assert.equal(audit.length,1);
  assert.equal(audit[0].decision,'allow');
  assert.equal(audit[0].principal_hash,PRINCIPAL_SHA256);
  assert.equal(ledger.finish(admitted.ticket),true);
  assert.equal(ledger.stats().active,0);
});
test('malformed deny audit uses the pinned unknown identity hash',()=>{
  const audit=[];
  const ledger=new M0AdmissionLedger({
    enabled:true,auditKey:KEY,
    audit(record){audit.push(record);return true;}
  });
  assert.equal(ledger.begin(null).reason,'MALFORMED');
  assert.equal(audit[0].decision,'deny');
  assert.equal(audit[0].principal_hash,UNKNOWN_SHA256);
});
test('short audit key fails closed without allocating tickets',()=>{
  const ledger=new M0AdmissionLedger({
    enabled:true,auditKey:Buffer.alloc(31,17),audit:()=>true
  });
  const outcome=ledger.begin(beginArgs());
  assert.equal(outcome.ok,false);
  assert.equal(outcome.reason,'AUDIT_FAILURE');
  assert.equal(ledger.stats().active,0);
});
