import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { M0AdmissionLedger } from '../bin/mcp-m0-admission-ledger.mjs';
import { admitM0WireFrame } from '../bin/mcp-m0-boundary-reference.mjs';

// Source-free, synchronous host reference. This does not authenticate a real
// transport peer, issue credentials, persist audit records or run .atto guests.
const WALL=1793664000000;
const URI='atto-dev://runtime/r1/tenant/t1/process/summary';
const KEY=Buffer.alloc(32,17);
const credential=Object.freeze({
  principal_id:'p1',boot_id:'boot-1',runtime_id:'r1',tenant_id:'t1',
  generation:1,expires_at_ms:WALL+100000,scopes:['inspect:summary']
});
const host=Object.freeze({
  peerAuthenticated:true,credential,hostBootId:'boot-1',
  hostRuntimeGeneration:1,wallNowMs:WALL,monotonicNowMs:1000
});
const packet=(id='req', nonce='a'.repeat(32), method='resources/read', uri=URI)=>({
  jsonrpc:'2.0',id,method,
  params:{...(method==='resources/read'?{uri}:{}),_meta:{
    'io.modelcontextprotocol/protocolVersion':'2026-07-28',
    'io.modelcontextprotocol/clientCapabilities':{},
    'io.atto.dev/security':{
      schema_version:'atto.mcp.dev-control.m0.v1',nonce,
      issued_at_ms:WALL,runtime_id:'r1',tenant_id:'t1',expected_generation:1
    }
  }}
});
const wire=(value)=>Buffer.from(JSON.stringify(value),'utf8');
function fixture() {
  const audit=[];
  const ledger=new M0AdmissionLedger({
    enabled:true,auditKey:KEY,
    audit(record){audit.push(record);return true;}
  });
  return {ledger,audit};
}
function noGrant(f,response) {
  assert.equal(response.ok,false);
  assert.equal(f.ledger.stats().active,0);
  assert.equal(f.audit.some(record=>record.decision==='allow'),false);
}
test('real wire frame admits read-only request and emits pinned HMAC',()=>{
  const f=fixture(),result=admitM0WireFrame(f.ledger,wire(packet()),host);
  assert.equal(result.ok,true);
  assert.equal(f.ledger.stats().active,1);
  assert.equal(f.audit.length,1);
  assert.equal(f.audit[0].reason,'OK');
  assert.equal(f.audit[0].principal_hash,createHmac('sha256',KEY).update('p1').digest('hex'));
  assert.equal(f.ledger.live(result.ticket,1001,1,WALL,'boot-1',true),true);
  assert.equal(f.ledger.finish(result.ticket),true);
  assert.equal(f.ledger.finish(result.ticket),false);
  assert.equal(f.ledger.stats().active,0);
});
test('the same parsed nonce cannot be replayed after settlement',()=>{
  const f=fixture(),raw=wire(packet());
  const first=admitM0WireFrame(f.ledger,raw,host);
  assert.equal(first.ok,true);
  assert.equal(f.ledger.finish(first.ticket),true);
  const replay=admitM0WireFrame(f.ledger,raw,host);
  assert.equal(replay.reason,'REPLAY');
  assert.equal(f.audit.at(-1).reason,'REPLAY');
  assert.equal(f.ledger.stats().active,0);
});
test('duplicated escaped and literal JSON keys are rejected before admission',()=>{
  const f=fixture();
  const raw=Buffer.from('{"jsonrpc":"2.0","jsonr\\u0070c":"2.0","id":"x"}');
  const outcome=admitM0WireFrame(f.ledger,raw,host);
  assert.equal(outcome.stage,'frame');
  assert.equal(outcome.reason,'MALFORMED');
  noGrant(f,outcome);
  assert.equal(f.audit.length,0);
});
test('invalid UTF-8 is denied before admission without raw decoder errors',()=>{
  const f=fixture(),outcome=admitM0WireFrame(f.ledger,Buffer.from([0x7b,0x22,0xc3,0x28,0x22,0x7d]),host);
  assert.equal(outcome.stage,'frame');
  assert.equal(outcome.reason,'MALFORMED');
  noGrant(f,outcome);
});
test('unsafe integer and nonzero-underflow are stopped by framing',()=>{
  const f=fixture();
  for(const literal of ['9007199254740993','1e-9999','-1e-9999']){
    const raw=Buffer.from('{"jsonrpc":"2.0","id":'+literal+',"method":"resources/read"}');
    const response=admitM0WireFrame(f.ledger,raw,host);
    assert.equal(response.stage,'frame');
    assert.equal(response.reason,'MALFORMED');
    noGrant(f,response);
  }
});
test('oversized frame is rejected on intrinsic bytes before JSON parse',()=>{
  const f=fixture(),oversized=Buffer.from(JSON.stringify(packet())+' '.repeat(32769));
  const result=admitM0WireFrame(f.ledger,oversized,host);
  assert.equal(result.stage,'frame');
  assert.equal(result.reason,'OVERFLOW');
  noGrant(f,result);
});
test('framing uses intrinsic view length instead of caller getter',()=>{
  const f=fixture(),bytes=wire(packet());
  let getterCalls=0;
  Object.defineProperty(bytes,'byteLength',{get(){getterCalls++;return 1;}});
  const result=admitM0WireFrame(f.ledger,bytes,host);
  assert.equal(result.ok,true);
  assert.equal(f.audit[0].request_bytes,Buffer.byteLength(JSON.stringify(packet())));
  assert.equal(getterCalls,0);
  assert.equal(f.ledger.finish(result.ticket),true);
});
test('trusted host cannot inject or override measured frameBytes/jsonDepth',()=>{
  const f=fixture();
  const poisoned={...host,frameBytes:1,jsonDepth:1};
  const result=admitM0WireFrame(f.ledger,wire(packet()),poisoned);
  assert.equal(result.stage,'host');
  assert.equal(result.reason,'MALFORMED');
  noGrant(f,result);
});
test('host getters and proxies are denied without invoking arbitrary code',()=>{
  const f=fixture();
  let trapCount=0;
  const proxy=new Proxy({...host},{getPrototypeOf(target){trapCount++;return Reflect.getPrototypeOf(target)}});
  let outcome=admitM0WireFrame(f.ledger,wire(packet()),proxy);
  assert.equal(outcome.stage,'host');
  noGrant(f,outcome);
  assert.equal(trapCount,0);
  const getter={...host};
  Object.defineProperty(getter,'peerAuthenticated',{get(){trapCount++;throw Error('sensitive') }});
  outcome=admitM0WireFrame(f.ledger,wire(packet()),getter);
  assert.equal(outcome.stage,'host');
  noGrant(f,outcome);
  assert.equal(trapCount,0);
});
test('cross-tenant and unsupported write requests generate audited denials',()=>{
  const f=fixture();
  let result=admitM0WireFrame(f.ledger,wire(packet('a','a'.repeat(32),'resources/read',
    'atto-dev://runtime/r1/tenant/t2/process/summary')),host);
  assert.equal(result.reason,'TENANT');noGrant(f,result);
  result=admitM0WireFrame(f.ledger,wire(packet('b','b'.repeat(32),'tools/call')),host);
  assert.equal(result.reason,'UNSUPPORTED');noGrant(f,result);
  assert.deepEqual(f.audit.map(record=>record.reason),['TENANT','UNSUPPORTED']);
});
test('credential identity and generation come exclusively from trusted host context',()=>{
  const f=fixture();
  const forged=packet();
  forged.credential={principal_id:'root',tenant_id:'admin',generation:999};
  const result=admitM0WireFrame(f.ledger,wire(forged),host);
  assert.equal(result.reason,'MALFORMED');
  noGrant(f,result);
  const staleHost={...host,hostRuntimeGeneration:2};
  const mismatch=admitM0WireFrame(f.ledger,wire(packet()),staleHost);
  assert.equal(mismatch.reason,'GENERATION');
  noGrant(f,mismatch);
});
test('deep JSON is rejected at frame boundary before an audit callback',()=>{
  const f=fixture();let nested=packet();
  for(let i=0;i<13;i++)nested={wrapper:nested};
  const result=admitM0WireFrame(f.ledger,wire(nested),host);
  assert.equal(result.stage,'frame');
  assert.equal(result.reason,'OVERFLOW');
  noGrant(f,result);
  assert.equal(f.audit.length,0);
});
