import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateLease,serializeLease,parseLeaseComment,evaluateLeaseLedger
} from '../src/merge-coordination-v1.mjs';

const now='2026-11-08T15:00:00.000Z',SHA='a'.repeat(40);
const fresh=()=>({
  claimId:'claim-scope-2026',expiresAt:'2026-11-08T15:40:00.000Z',
  head:SHA,issuedAt:'2026-11-08T14:55:00.000Z',
  number:123,owner:'the1mills',paths:['src/core.mjs'],
  repo:'org/repo',scope:'files',status:'active'
});
const comment=lease=>({body:serializeLease(lease),author:lease.owner,createdAt:lease.issuedAt});
const ledger=records=>evaluateLeaseLedger(records,{now,repo:'org/repo',number:123,head:SHA});

test('lease validation returns an inert immutable snapshot, not mutable caller authority',()=>{
  const source=fresh();
  const immutable=validateLease(source,{now});
  assert.deepEqual(immutable,source);
  assert.notEqual(immutable,source);
  assert.notEqual(immutable.paths,source.paths);
  assert.ok(Object.isFrozen(immutable));
  assert.ok(Object.isFrozen(immutable.paths));
  source.paths[0]='src/other.mjs';
  source.status='released';
  assert.equal(immutable.status,'active');
  assert.deepEqual(immutable.paths,['src/core.mjs']);
});

test('hostile claim accessors and Proxy traps are denied before any execution',()=>{
  let calls=0;
  const bad=fresh();
  Object.defineProperty(bad,'paths',{enumerable:true,get(){calls++;throw Error('getter called');}});
  assert.throws(()=>validateLease(bad,{now}),/INVALID_LEASE_SHAPE/);
  assert.throws(()=>serializeLease(bad),/INVALID_LEASE_SHAPE/);
  const proxy=new Proxy(fresh(),{get(){calls++;throw Error('proxy get');},
    ownKeys(){calls++;throw Error('proxy ownKeys');}});
  assert.throws(()=>validateLease(proxy,{now}),/INVALID_LEASE_SHAPE/);
  assert.equal(calls,0);
});

test('array holes, inherited arrays, symbol metadata and index getters are forbidden',()=>{
  const sparse=fresh();sparse.paths=Array(2);sparse.paths[0]='src/core.mjs';
  const inherited=fresh();inherited.paths=Object.assign(Object.create([]),['src/core.mjs']);
  const indexed=fresh();
  Object.defineProperty(indexed.paths,'0',{enumerable:true,get(){throw Error('index getter');}});
  const symbol=fresh();symbol.paths[Symbol('secret')]=true;
  const proxied=fresh();let calls=0;
  proxied.paths=new Proxy(['src/core.mjs'],{get(){calls++;throw Error('proxy array');}});
  for(const input of [sparse,inherited,indexed,symbol,proxied])
    assert.throws(()=>validateLease(input,{now}),/INVALID_LEASE_SCOPE/);
  assert.equal(calls,0);
});

test('forged comment getters are blocked and cannot turn into an active lease',()=>{
  let calls=0;
  const good=comment(fresh());
  const changed={...good};
  Object.defineProperty(changed,'body',{enumerable:true,get(){calls++;throw Error('owned data only');}});
  assert.throws(()=>parseLeaseComment(changed,{now}),/INVALID_LEASE_COMMENT/);
  const result=ledger([changed]);
  assert.ok(result.blockers.includes('INVALID_LEASE_RECORD'));
  assert.equal(result.active.length,0);
  assert.equal(calls,0);
});

test('valid canonical comment remains parsable and read-only, without lock authority',()=>{
  const source=fresh(),verified=parseLeaseComment(comment(source),{now});
  assert.deepEqual(verified,source);
  assert.ok(Object.isFrozen(verified));
  const result=ledger([comment(source)]);
  assert.deepEqual(result.blockers,[]);
  assert.equal(result.active.length,1);
  assert.equal(result.exclusiveLockAcquired,false);
  assert.equal(result.mergeAuthorized,false);
});
