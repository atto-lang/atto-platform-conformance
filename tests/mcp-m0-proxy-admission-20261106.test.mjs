import test from 'node:test';
import assert from 'node:assert/strict';
import { types as nodeTypes } from 'node:util';
import { M0AdmissionLedger } from '../bin/mcp-m0-admission-ledger.mjs';

const WALL=1793664000000;
function fixture() {
  const audit=[];
  const ledger=new M0AdmissionLedger({enabled:true,auditKey:Buffer.alloc(32,7),audit:r=>{audit.push(r);return true}});
  const credential={principal_id:'p1',boot_id:'boot-1',runtime_id:'r1',tenant_id:'t1',generation:1,expires_at_ms:WALL+100000,scopes:['inspect:summary']};
  const request={jsonrpc:'2.0',id:'id',method:'resources/read',params:{uri:'atto-dev://runtime/r1/tenant/t1/process/summary',_meta:{
    'io.modelcontextprotocol/protocolVersion':'2026-07-28',
    'io.modelcontextprotocol/clientCapabilities':{},
    'io.atto.dev/security':{schema_version:'atto.mcp.dev-control.m0.v1',nonce:'a'.repeat(32),issued_at_ms:WALL,runtime_id:'r1',tenant_id:'t1',expected_generation:1}
  }}};
  return {audit,ledger,credential,request,args:{peerAuthenticated:true,credential,request,hostBootId:'boot-1',hostRuntimeGeneration:1,wallNowMs:WALL,monotonicNowMs:1000,frameBytes:512,jsonDepth:5}};
}
function transparentProxy(target,calls) {
  return new Proxy(target,{
    getPrototypeOf(t){calls.count++;return Reflect.getPrototypeOf(t)},
    ownKeys(t){calls.count++;return Reflect.ownKeys(t)},
    getOwnPropertyDescriptor(t,k){calls.count++;return Reflect.getOwnPropertyDescriptor(t,k)},
    get(t,k,r){calls.count++;return Reflect.get(t,k,r)}
  });
}
function rejected(f,options) {
  const result=f.ledger.begin(options);
  assert.equal(result.ok,false);
  assert.equal(result.reason,'MALFORMED');
  assert.equal(f.ledger.stats().active,0);
  assert.ok(!f.audit.some(r=>r.decision==='allow'));
}
test('native Node recognizes transparent proxies but does not invoke their traps during credential admission',()=>{
  const f=fixture(),calls={count:0};
  const proxy=transparentProxy(f.credential,calls);
  assert.equal(nodeTypes.isProxy(proxy),true);
  rejected(f,{...f.args,credential:proxy});
  assert.equal(calls.count,0);
});
test('top-level transparent proxy is rejected before ownKeys or getPrototypeOf traps',()=>{
  const f=fixture(),calls={count:0};
  rejected(f,transparentProxy(f.args,calls));
  assert.equal(calls.count,0);
});
test('nested request proxy cannot alter parsed id or generate a positive audit record',()=>{
  const f=fixture(),calls={count:0};
  rejected(f,{...f.args,request:transparentProxy(f.request,calls)});
  assert.equal(calls.count,0);
});
test('revoked proxy is rejected with stable MALFORMED without calling traps',()=>{
  const f=fixture(),calls={count:0};
  const {proxy,revoke}=Proxy.revocable(f.credential,{get(){calls.count++;throw Error('sensitive')} });
  revoke();rejected(f,{...f.args,credential:proxy});
  assert.equal(calls.count,0);
});
test('unwrapped valid credential still succeeds with real HMAC and exactly-once settlement',()=>{
  const f=fixture();
  const a=f.ledger.begin(f.args);
  assert.equal(a.ok,true);
  assert.equal(f.audit[0].decision,'allow');
  assert.equal(f.ledger.stats().active,1);
  assert.equal(f.ledger.finish(a.ticket),true);
  assert.equal(f.ledger.finish(a.ticket),false);
  assert.equal(f.ledger.stats().active,0);
});
