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
