import test from 'node:test';
import assert from 'node:assert/strict';
import {M0AdmissionLedger} from '../bin/mcp-m0-admission-ledger.mjs';

// Source-free reference-policy admission checks. No network peer, bearer
// credential issuing, runtime guest execution or actual concurrency proof.
function fixture() {
  const audit=[];
  const ledger=new M0AdmissionLedger({
    enabled:true,
    auditKey:Buffer.alloc(32,7),
    audit(record) { audit.push(record); return true; },
  });
  return {ledger,audit};
}
function denied(f, input, expected='MALFORMED') {
  const result=f.ledger.begin(input);
  assert.equal(result.ok,false);
  assert.equal(result.reason,expected);
  assert.equal(f.ledger.stats().active,0);
  assert.equal(f.audit.some(r=>r.decision==='allow'),false);
  return result;
}

test('null options produce stable audited denial, not TypeError',()=>{
  const f=fixture();denied(f,null);
  assert.equal(f.audit[0].reason,'MALFORMED');
});
test('primitive or array options are not silently treated as defaults',()=>{
  const f=fixture();
  for(const value of [7,'untrusted',false,[]])denied(f,value);
});
test('revoked options proxy fails closed with no raw exception',()=>{
  const f=fixture(),q=Proxy.revocable({},{});
  q.revoke();denied(f,q.proxy);
});
test('top-level option accessor is never invoked',()=>{
  const f=fixture();let reads=0;
  const obj=Object.defineProperty({},'peerAuthenticated',{
    enumerable:true,get(){reads++;throw Error('secret detail');}
  });
  denied(f,obj);assert.equal(reads,0);
});
test('credential principal accessor cannot influence an audit record',()=>{
  const f=fixture();let reads=0;
  const credential=Object.defineProperty({},'principal_id',{
    enumerable:true,get(){reads++;return 'root';}
  });
  denied(f,{peerAuthenticated:true,credential});assert.equal(reads,0);
});
test('request id accessor cannot create allow-audit without reservation',()=>{
  const f=fixture();let reads=0;
  const request=Object.defineProperty({},'id',{
    enumerable:true,get(){reads++;if(reads>4)throw Error('post-audit exception');return 'req';}
  });
  denied(f,{peerAuthenticated:true,request});
  assert.equal(reads,0);
  assert.equal(f.audit.some(r=>r.reason==='OK'),false);
});
test('cyclic option graph is denied without recursion overflow',()=>{
  const f=fixture(),obj={};obj.self=obj;denied(f,obj);
});
test('deep option graph is denied before credential inspection',()=>{
  const f=fixture();let obj={};
  for(let i=0;i<20;i++)obj={nested:obj};
  denied(f,obj);
});
test('array greater than 2048 slots is rejected before traversal',()=>{
  const f=fixture();denied(f,{credential:{scopes:Array(2049).fill('inspect:summary')}});
});
test('sparse credential scopes cannot evade admission budget',()=>{
  const f=fixture();denied(f,{credential:{scopes:new Array(2)}});
});
test('exotic object with custom prototype is rejected',()=>{
  const f=fixture();denied(f,{credential:new Date()});
});
test('a plain null-prototype options object remains a stable denial',()=>{
  const f=fixture(),obj=Object.create(null);
  denied(f,obj,'UNAUTHENTICATED');
});
test('non-string credential with own toString is denied without calling it',()=>{
  const f=fixture();let calls=0;
  const bad={toString(){calls++;return 'root';}};
  denied(f,{peerAuthenticated:true,credential:{principal_id:bad}},'UNAUTHENTICATED');
  assert.equal(calls,0);
});


const reentry_wall = 1793664000000;
const reentry_credential = {
  principal_id:'p1',boot_id:'boot-1',runtime_id:'r1',tenant_id:'t1',
  generation:1,expires_at_ms:reentry_wall+100000,
  scopes:['inspect:catalog','inspect:summary','inspect:metrics','inspect:upgrade_status'],
};
function make_reentry_args(id='a',nonce='a'.repeat(32)) {
  return {
    peerAuthenticated:true,credential:reentry_credential,
    hostBootId:'boot-1',hostRuntimeGeneration:1,wallNowMs:reentry_wall,
    monotonicNowMs:1000,frameBytes:512,jsonDepth:5,
    request:{
      jsonrpc:'2.0',id,method:'resources/read',
      params:{uri:'atto-dev://runtime/r1/tenant/t1/process/summary',
        _meta:{
          'io.modelcontextprotocol/protocolVersion':'2026-07-28',
          'io.modelcontextprotocol/clientCapabilities':{sampling:{}},
          'io.atto.dev/security':{
            schema_version:'atto.mcp.dev-control.m0.v1',nonce,
            issued_at_ms:reentry_wall,runtime_id:'r1',tenant_id:'t1',
            expected_generation:1
          }
        }
      }
    }
  };
}
function audit_reentry_case(inner_args, expected) {
  let ledger, nested, once=false;
  const observed=[];
  const outer_args=make_reentry_args();
  ledger=new M0AdmissionLedger({
    enabled:true,auditKey:Buffer.alloc(32,7),
    audit(record) {
      if (record.decision==='allow') {
        observed.push(ledger.stats().active);
        if (!once) { once=true; nested=ledger.begin(inner_args); }
      }
      return true;
    }
  });
  const outer=ledger.begin(outer_args);
  assert.equal(outer.ok,true);
  assert.equal(nested.reason,expected);
  assert.equal(nested.ok,false);
  assert.deepEqual(observed,[1]);
  assert.equal(ledger.stats().active,1);
  assert.equal(ledger.finish(outer.ticket),true);
  assert.equal(ledger.stats().active,0);
}
test('audit reentry with same nonce and id cannot duplicate a ticket',()=>{
  audit_reentry_case(make_reentry_args(),'REPLAY');
});
test('audit reentry with different nonce but same id is fenced',()=>{
  audit_reentry_case(make_reentry_args('a','b'.repeat(32)),'DUPLICATE_ID');
});
test('audit reentry with same nonce but different id is fenced',()=>{
  audit_reentry_case(make_reentry_args('b','a'.repeat(32)),'REPLAY');
});
test('audit reentry with independent nonce and id preserves both tickets',()=>{
  let ledger, nested, once=false, observations=[];
  ledger=new M0AdmissionLedger({
    enabled:true,auditKey:Buffer.alloc(32,7),
    audit(record) {
      if (record.decision==='allow') {
        observations.push(ledger.stats().active);
        if(!once) {once=true;nested=ledger.begin(make_reentry_args('b','b'.repeat(32)));}
      }
      return true;
    }
  });
  const outer=ledger.begin(make_reentry_args());
  assert.equal(outer.ok,true);
  assert.equal(nested.ok,true);
  assert.deepEqual(observations,[1,2]);
  assert.equal(ledger.stats().active,2);
  assert.equal(ledger.finish(nested.ticket),true);
  assert.equal(ledger.finish(outer.ticket),true);
  assert.equal(ledger.stats().active,0);
});
test('audit failure rolls back outer reservation but preserves accepted child',()=>{
  let ledger, nested, once=false;
  ledger=new M0AdmissionLedger({
    enabled:true,auditKey:Buffer.alloc(32,7),
    audit(record) {
      if(record.decision==='allow' && !once) {
        once=true;
        nested=ledger.begin(make_reentry_args('b','b'.repeat(32)));
        return false;
      }
      return true;
    }
  });
  const outer=ledger.begin(make_reentry_args());
  assert.equal(outer.reason,'AUDIT_FAILURE');
  assert.equal(nested.ok,true);
  assert.equal(ledger.stats().active,1);
  assert.equal(ledger.finish(nested.ticket),true);
  assert.equal(ledger.stats().active,0);
});
test('rejected Promise audit rollback allows retrying same nonce',()=>{
  let permitted=false;
  const ledger=new M0AdmissionLedger({
    enabled:true,auditKey:Buffer.alloc(32,7),
    audit() { return permitted ? true : Promise.resolve(true); }
  });
  const first=ledger.begin(make_reentry_args());
  assert.equal(first.reason,'AUDIT_FAILURE');
  assert.equal(ledger.stats().active,0);
  permitted=true;
  const retry=ledger.begin(make_reentry_args());
  assert.equal(retry.ok,true);
  assert.equal(ledger.finish(retry.ticket),true);
  assert.equal(ledger.stats().active,0);
});
test('throwing audit sink rollback allows retry and no leaked ticket',()=>{
  let failing=true;
  const ledger=new M0AdmissionLedger({
    enabled:true,auditKey:Buffer.alloc(32,7),
    audit() {if(failing)throw Error('disk failure');return true;}
  });
  assert.equal(ledger.begin(make_reentry_args()).reason,'AUDIT_FAILURE');
  assert.equal(ledger.stats().active,0);
  failing=false;
  const allowed=ledger.begin(make_reentry_args());
  assert.equal(allowed.ok,true);
  assert.equal(ledger.finish(allowed.ticket),true);
  assert.equal(ledger.stats().active,0);
});


test('recursive denial audit is capped at eight callbacks, not stack exhaustion',()=>{
  let calls=0;
  let ledger;
  ledger=new M0AdmissionLedger({
    enabled:true,
    auditKey:Buffer.alloc(32,7),
    audit(record) {
      calls++;
      assert.equal(Object.isFrozen(record),true);
      if (calls<1000) ledger.begin(null);
      return true;
    }
  });
  assert.equal(ledger.begin(null).reason,'MALFORMED');
  assert.equal(calls,8);
  assert.equal(ledger.stats().active,0);
});
test('audit nesting budget resets after a recursive denial settles',()=>{
  let calls=0;
  let ledger;
  ledger=new M0AdmissionLedger({
    enabled:true,
    auditKey:Buffer.alloc(32,7),
    audit() { calls++; if(calls%8!==0)ledger.begin(null);return true; }
  });
  assert.equal(ledger.begin(null).reason,'MALFORMED');
  assert.equal(ledger.begin(null).reason,'MALFORMED');
  assert.equal(calls,16);
  assert.equal(ledger.stats().active,0);
});
test('audit callback cannot rewrite the denial reason or decision',()=>{
  let observed;
  const ledger=new M0AdmissionLedger({
    enabled:true,
    auditKey:Buffer.alloc(32,7),
    audit(record) {
      assert.equal(Object.isFrozen(record),true);
      try { record.reason='OK';record.decision='allow'; } catch {}
      observed=record;
      return true;
    }
  });
  assert.equal(ledger.begin(null).reason,'MALFORMED');
  assert.equal(observed.reason,'MALFORMED');
  assert.equal(observed.decision,'deny');
  assert.equal(ledger.stats().active,0);
});
test('non-finite nested JSON-like numbers are rejected before authorization',()=>{
  const ledger=new M0AdmissionLedger({
    enabled:true,auditKey:Buffer.alloc(32,7),audit:()=>true
  });
  for(const value of [NaN,Infinity,-Infinity]){
    assert.equal(ledger.begin({frameBytes:value}).reason,'MALFORMED');
    assert.equal(ledger.begin({credential:{nested:{value}}}).reason,'MALFORMED');
  }
  assert.equal(ledger.stats().active,0);
});
