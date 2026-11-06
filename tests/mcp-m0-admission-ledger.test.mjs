import test from 'node:test';
import assert from 'node:assert/strict';
import {M0AdmissionLedger} from '../bin/mcp-m0-admission-ledger.mjs';

const wall=1793664000000;
const boot='boot-1';
const key=Buffer.alloc(32,17);
const baseCredential={principal_id:'p1',boot_id:boot,runtime_id:'r1',tenant_id:'t1',generation:1,
  expires_at_ms:wall+100000,scopes:['inspect:catalog','inspect:summary','inspect:metrics','inspect:upgrade_status']};
const msg=(id='a',nonce='a'.repeat(32),method='resources/read',uri='atto-dev://runtime/r1/tenant/t1/process/summary') => ({
 jsonrpc:'2.0',id,method,params:{...(method==='resources/read'?{uri}:{}),_meta:{
  'io.modelcontextprotocol/protocolVersion':'2026-07-28',
  'io.modelcontextprotocol/clientCapabilities':{sampling:{}},
  'io.modelcontextprotocol/clientInfo':{name:'untrusted AI',version:'1'},
  'io.atto.dev/security':{schema_version:'atto.mcp.dev-control.m0.v1',nonce,
     issued_at_ms:wall,runtime_id:'r1',tenant_id:'t1',expected_generation:1}
 }}});
const fixture=(options={})=>{
 const records=[];
 const ledger=new M0AdmissionLedger({enabled:true,audit:r=>{records.push(r);return true;},auditKey:key,...options});
 const args={peerAuthenticated:true,credential:baseCredential,hostBootId:boot,wallNowMs:wall,
             monotonicNowMs:1000,hostRuntimeGeneration:1,frameBytes:512,jsonDepth:5};
 return {records,ledger,args,admit:(request=msg(),opts={})=>ledger.begin({...args,request,...opts})};
};

test('default disabled and missing audit sink/key fail closed',()=>{
 const o=new M0AdmissionLedger();
 assert.equal(o.begin({}).reason,'AUDIT_FAILURE');
 assert.equal(new M0AdmissionLedger({enabled:true}).begin({}).reason,'AUDIT_FAILURE');
 const f=fixture({enabled:false});assert.equal(f.admit().reason,'DISABLED');
});
test('read-only request accepted with opaque one-time ticket',()=>{
 const f=fixture(),r=f.admit();assert.equal(r.ok,true);
 assert.equal(Object.isFrozen(r.ticket),true);assert.equal(f.ledger.live(r.ticket,1499,1,wall,boot,true),true);
 assert.equal(f.ledger.live(r.ticket,1501,1,wall,boot,true),false);assert.equal(f.ledger.finish(r.ticket),true);
 assert.equal(f.ledger.finish(r.ticket),false);assert.equal(f.ledger.stats().active,0);
});
test('replay retained after finish',()=>{
 const f=fixture(),r=f.admit();f.ledger.finish(r.ticket);
 assert.equal(f.admit().reason,'REPLAY');
});
test('simultaneous repeated nonce and different id fail replay before allocation',()=>{
 const f=fixture();assert.equal(f.admit().ok,true);
 assert.equal(f.admit(msg('new-id')).reason,'REPLAY');assert.equal(f.ledger.stats().active,1);
});
test('concurrent duplicate id rejected even with new nonce',()=>{
 const f=fixture();const r=f.admit();assert.equal(f.admit(msg('a','b'.repeat(32))).reason,'DUPLICATE_ID');
 assert.equal(f.ledger.finish(r.ticket),true);
 assert.equal(f.admit(msg('a','b'.repeat(32))).ok,true);
});
test('stale ticket cannot free later request reusing the same ID',()=>{
 const f=fixture();const first=f.admit();f.ledger.finish(first.ticket);
 const second=f.admit(msg('a','b'.repeat(32)));
 assert.equal(f.ledger.finish(first.ticket),false);assert.equal(f.ledger.stats().active,1);
 assert.equal(f.ledger.finish(second.ticket),true);
});
test('failed audit never grants authority or consumes nonce',()=>{
 let failing=true;const f=fixture({audit:()=>!failing});
 assert.equal(f.admit().reason,'AUDIT_FAILURE');assert.equal(f.ledger.stats().active,0);
 failing=false;assert.equal(f.admit().ok,true);
});
test('promise-returning audit sink does not authorize',()=>{
 const f=fixture({audit:async()=>true});assert.equal(f.admit().reason,'AUDIT_FAILURE');
 assert.equal(f.ledger.stats().active,0);
});
test('audit record is bounded and contains only keyed hashes of identity',()=>{
 const f=fixture();const r=f.admit();assert.equal(r.ok,true);
 const record=f.records[0];assert.equal(record.schema,'atto.mcp.audit.v1');
 assert.equal(record.decision,'allow');assert.equal(record.reason,'OK');
 assert.match(record.principal_hash,/^[0-9a-f]{64}$/);assert.notEqual(record.principal_hash,'p1');
 assert.ok(!JSON.stringify(record).includes('untrusted AI'));
 assert.ok(!JSON.stringify(record).includes('atto-dev://'));assert.ok(Buffer.byteLength(JSON.stringify(record))<=2048);
});
test('scope escalation is denied including upgrade status',()=>{
 const f=fixture();const c={...baseCredential,scopes:['inspect:summary']};
 assert.equal(f.admit(msg('a','a'.repeat(32),'resources/list'),{credential:c}).reason,'SCOPE');
 assert.equal(f.admit(msg('a','a'.repeat(32),'resources/read','atto-dev://runtime/r1/tenant/t1/upgrade/status'),{credential:c}).reason,'SCOPE');
});
test('tenant and runtime crossing denied independently',()=>{
 const f=fixture();
 assert.equal(f.admit(msg('a','a'.repeat(32),'resources/read','atto-dev://runtime/r1/tenant/t2/process/summary')).reason,'TENANT');
 assert.equal(f.admit(msg('a','a'.repeat(32),'resources/read','atto-dev://runtime/r2/tenant/t1/process/summary')).reason,'RUNTIME');
 const r=msg();r.params._meta['io.atto.dev/security'].tenant_id='t2';assert.equal(f.admit(r).reason,'TENANT');
});
test('stale host boot and generation denied',()=>{
 const f=fixture();assert.equal(f.admit(msg(),{hostBootId:'boot-x'}).reason,'GENERATION');
 const r=msg();r.params._meta['io.atto.dev/security'].expected_generation=2;
 assert.equal(f.admit(r).reason,'GENERATION');
 assert.equal(f.admit(msg(),{hostRuntimeGeneration:2}).reason,'GENERATION');
});
test('ticket becomes non-live immediately on runtime generation change',()=>{
 const f=fixture(),result=f.admit();assert.equal(result.ok,true);
 assert.equal(f.ledger.live(result.ticket,1050,1,wall,boot,true),true);
 assert.equal(f.ledger.live(result.ticket,1050,2,wall,boot,true),false);
 assert.equal(f.ledger.finish(result.ticket),true);
});
test('an accepted request is invalid as soon as its host credential expires',()=>{
 const f=fixture(), result=f.admit();
 assert.equal(result.ok,true);
 assert.equal(f.ledger.live(result.ticket,1050,1,wall+99999,boot,true),true);
 assert.equal(f.ledger.live(result.ticket,1050,1,wall+100000,boot,true),false);
 f.ledger.finish(result.ticket);
});
test('credential identifiers cannot be coerced from objects or arrays',()=>{
 const f=fixture();for(const bad of [{toString(){return 'p1'}},['p1'],1]){
  assert.equal(f.admit(msg(),{credential:{...baseCredential,principal_id:bad}}).reason,'UNAUTHENTICATED');
 }
});
test('idle principal state reclaimed only after full replay and rate windows expire',()=>{
 const f=fixture();for(let i=0;i<64;i++){
  const r=f.admit(msg(),{credential:{...baseCredential,principal_id:'p'+i}});
  assert.equal(r.ok,true);f.ledger.finish(r.ticket);
 }
 assert.equal(f.ledger.stats().principals,64);
 const res=f.admit(msg(),{credential:{...baseCredential,principal_id:'p65'},monotonicNowMs:61000});
 assert.equal(res.ok,true);
 assert.equal(f.ledger.stats().principals,1);
});
test('AI client info never grants authority',()=>{
 const f=fixture();const r=msg();r.params._meta['io.modelcontextprotocol/clientInfo']={name:'root',version:'999'};
 assert.equal(f.admit(r,{credential:{...baseCredential,scopes:[]}}).reason,'SCOPE');
});
test('all mutation and guest invoke methods explicitly unsupported',()=>{
 const f=fixture();for(const method of ['tools/call','upgrade/prepare','upgrade/commit','upgrade/rollback','guest/eval','guest/invoke','memory/write'])
   assert.equal(f.admit(msg('a','a'.repeat(32),method)).reason,'UNSUPPORTED');
});
test('URI dot traversal, percent encoding, unknown routes reject',()=>{
 const f=fixture();for(const uri of ['atto-dev://runtime/../tenant/t1/process/summary',
   'atto-dev://runtime/r1/tenant/../process/summary','atto-dev://runtime/r1/tenant/t1/actors/state',
   'atto-dev://runtime/r1/tenant/%2e%2e/process/summary'])
   assert.equal(f.admit(msg('a','a'.repeat(32),'resources/read',uri)).reason,'MALFORMED');
});
test('clock skew and expired host credential rejected',()=>{
 const f=fixture();const m=msg();m.params._meta['io.atto.dev/security'].issued_at_ms=wall-30001;
 assert.equal(f.admit(m).reason,'MALFORMED');
 assert.equal(f.admit(msg(),{credential:{...baseCredential,expires_at_ms:wall}}).reason,'UNAUTHENTICATED');
});
test('frame depth and byte budgets denied before admission',()=>{
 const f=fixture();assert.equal(f.admit(msg(),{frameBytes:32769}).reason,'OVERFLOW');
 assert.equal(f.admit(msg(),{jsonDepth:13}).reason,'OVERFLOW');
 assert.equal(f.ledger.stats().active,0);
});
test('per-principal concurrent limit and cancellation cleanup',()=>{
 const f=fixture();const a=f.admit(),b=f.admit(msg('b','b'.repeat(32)));
 assert.equal(a.ok,true);assert.equal(b.ok,true);
 assert.equal(f.admit(msg('c','c'.repeat(32))).reason,'QUOTA');
 assert.equal(f.ledger.finish(a.ticket),true);
 assert.equal(f.admit(msg('c','c'.repeat(32))).ok,true);
});
test('eight per second rolling quota, no bypass on finish',()=>{
 const f=fixture();for(let i=0;i<8;i++){
   const r=f.admit(msg(String(i),i.toString(16).padStart(32,'0')));
   assert.equal(r.ok,true);f.ledger.finish(r.ticket);
 }
 assert.equal(f.admit(msg('8','8'.repeat(32))).reason,'QUOTA');
 assert.equal(f.admit(msg('8','8'.repeat(32)),{monotonicNowMs:2000}).ok,true);
});
test('minute window uses actual rolling timestamps',()=>{
 const f=fixture();for(let i=0;i<60;i++){
   const m=msg(String(i),i.toString(16).padStart(32,'0'));
   const r=f.admit(m,{monotonicNowMs:1000+Math.floor(i/8)*1000});
   assert.equal(r.ok,true);f.ledger.finish(r.ticket);
 }
 assert.equal(f.admit(msg('61','f'.repeat(32)),{monotonicNowMs:9000}).reason,'QUOTA');
 assert.equal(f.admit(msg('61','f'.repeat(32)),{monotonicNowMs:61000}).ok,true);
});
test('replay cache and minute quota constrain nonce reservations',()=>{
 const f=fixture();for(let i=0;i<60;i++){
  const m=msg(String(i),i.toString(16).padStart(32,'0'));
  const r=f.admit(m,{monotonicNowMs:1000+Math.floor(i/8)*1000});
  assert.equal(r.ok,true);f.ledger.finish(r.ticket);
 }
 assert.equal(f.admit(msg('60','e'.repeat(32)),{monotonicNowMs:9000}).reason,'QUOTA');
 // A new request after the rolling minute expires is allowed; cache and rate
 // cleanup are monotonic and no unexpired entry is discarded to admit a replay.
 assert.equal(f.admit(msg('60','e'.repeat(32)),{monotonicNowMs:61000}).ok,true);
});
test('principal-state count is capped without evicting active tenants',()=>{
 const f=fixture();for(let i=0;i<64;i++){
  const credential={...baseCredential,principal_id:'p'+i};
  const r=f.admit(msg(),{credential});assert.equal(r.ok,true);f.ledger.finish(r.ticket);
 }
 assert.equal(f.ledger.stats().principals,64);
 assert.equal(f.admit(msg(),{credential:{...baseCredential,principal_id:'p-overflow'}}).reason,'QUOTA');
});
test('trusted principals have independent local request ID namespaces',()=>{
 const f=fixture();const a=f.admit();const credential={...baseCredential,principal_id:'p2'};
 const second=f.admit(msg(),{credential});assert.equal(second.ok,true);
 assert.equal(f.ledger.stats().active,2);f.ledger.finish(a.ticket);f.ledger.finish(second.ticket);
});
test('malformed client capabilities, unrecognized request keys are rejected',()=>{
 const f=fixture();const m=msg();m.params._meta['io.modelcontextprotocol/clientCapabilities']='root';
 assert.equal(f.admit(m).reason,'MALFORMED');
 const n=msg();n.principal={role:'admin'};assert.equal(f.admit(n).reason,'MALFORMED');
});
test('non-monotonic host tick cannot roll rate budget backwards',()=>{
 const f=fixture();const a=f.admit();f.ledger.finish(a.ticket);
 assert.equal(f.admit(msg('b','b'.repeat(32)),{monotonicNowMs:999}).reason,'MALFORMED');
});
test('long or malformed JSON-RPC ID never admitted',()=>{
 const f=fixture();for(const id of [null,{},'x'.repeat(65),-1,1.25])
   assert.equal(f.admit(msg(id)).reason,'MALFORMED');
});

// Rate admission applies to failed authenticated calls too, not just successes.
test('invalid authenticated method flood consumes per-second quota',()=>{
 const f=fixture();
 for(let i=0;i<8;i++)
   assert.equal(f.admit(msg(String(i),i.toString(16).padStart(32,'0'),'guest/invoke')).reason,'UNSUPPORTED');
 assert.equal(f.admit(msg('last','f'.repeat(32))).reason,'QUOTA');
 assert.equal(f.ledger.stats().active,0);
 assert.equal(f.admit(msg('later','f'.repeat(32)),{monotonicNowMs:2000}).ok,true);
});
test('cross-tenant denied requests still consume rate budget',()=>{
 const f=fixture();
 for(let i=0;i<8;i++)
   assert.equal(f.admit(msg(String(i),i.toString(16).padStart(32,'0'),'resources/read',
     'atto-dev://runtime/r1/tenant/foreign/process/summary')).reason,'TENANT');
 assert.equal(f.admit(msg('last','f'.repeat(32))).reason,'QUOTA');
});

test('LLVM/JS parity: live ticket requires original boot and verified peer',()=>{
 const f=fixture(), accepted=f.admit();
 assert.equal(accepted.ok,true);
 const ticket=accepted.ticket;
 assert.equal(f.ledger.live(ticket,1050,1,wall,boot,true),true);
 assert.equal(f.ledger.live(ticket,1050,1,wall,'new-boot',true),false);
 assert.equal(f.ledger.live(ticket,1050,1,wall,boot,false),false);
 assert.equal(f.ledger.live(ticket,1050,1,wall,boot),false);
 assert.equal(f.ledger.live(ticket,1050,1,wall),false);
 assert.equal(f.ledger.live(ticket,1050,1,wall,boot,true),true);
 f.ledger.finish(ticket);
 assert.equal(f.ledger.live(ticket,1050,1,wall,boot,true),false);
});
