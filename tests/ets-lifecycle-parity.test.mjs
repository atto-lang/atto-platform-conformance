import test from 'node:test';
import assert from 'node:assert/strict';
import {EtsSetReference} from '../src/batch-03-ets-stm-reference.mjs';
const owner={domain:'tenant',actor:'owner',generation:1};
const reader={domain:'tenant',actor:'reader',generation:1};
const heir={domain:'tenant',actor:'heir',generation:2};

test('ETS private/protected/public read-write permissions are distinct',()=>{
 for(const access of ['private','protected','public']){
  const t=new EtsSetReference({owner,access});const cap=t.issue(owner);
  t.insert(cap,owner,'key',0);
  if(access==='private'){
   assert.throws(()=>t.delegate(cap,owner,reader));
  }else{
   const guest=t.delegate(cap,owner,reader);
   assert.equal(t.lookup(guest,reader,'key').present,true);
   assert.equal(t.lookup(guest,reader,'key').value,0);
   if(access==='public')t.insert(guest,reader,'key',4);
   else assert.throws(()=>t.insert(guest,reader,'key',4));
  }
 }
});

test('ETS owner death with heir preserves data but revokes all prior capabilities',()=>{
 const t=new EtsSetReference({owner,heir,access:'public'});
 const old=t.issue(owner),guest=t.delegate(old,owner,reader);
 t.insert(old,owner,'data',99);
 const successor=t.ownerExit(owner);
 assert.throws(()=>t.lookup(old,owner,'data'));
 assert.throws(()=>t.lookup(guest,reader,'data'));
 assert.equal(t.lookup(successor,heir,'data').value,99);
 assert.equal(t.inspect().closed,false);
 assert.equal(t.ownerExit(heir),null);
 assert.equal(t.inspect().closed,true);
 assert.throws(()=>t.lookup(successor,heir,'data'));
});

test('ETS no-heir death destroys data and invalidates handle',()=>{
 const t=new EtsSetReference({owner});const cap=t.issue(owner);
 t.insert(cap,owner,'data',1);t.ownerExit(owner);
 assert.deepEqual({entries:t.inspect().entries,closed:t.inspect().closed},{entries:0,closed:true});
 assert.throws(()=>t.lookup(cap,owner,'data'));
});

test('ETS ABA-safe version CAS rejects delete-and-reinsert same value',()=>{
 const t=new EtsSetReference({owner});const cap=t.issue(owner);
 t.insert(cap,owner,'key',7);
 const snapshot=t.lookup(cap,owner,'key');
 t.take(cap,owner,'key');t.insert(cap,owner,'key',7);
 assert.equal(t.compareExchangeVersioned(cap,owner,'key',7,snapshot.version,9),false);
 const next=t.lookup(cap,owner,'key');
 assert.ok(next.version>snapshot.version);
 assert.equal(t.compareExchangeVersioned(cap,owner,'key',7,next.version,9),true);
 assert.equal(t.lookup(cap,owner,'key').value,9);
});

test('ETS quota failure does not mutate earlier entries',()=>{
 const t=new EtsSetReference({owner,maxEntries:1}),cap=t.issue(owner);
 t.insert(cap,owner,'key',11);
 assert.throws(()=>t.insert(cap,owner,'other',22),/BATCH03_DENIED/);
 assert.deepEqual({value:t.lookup(cap,owner,'key').value,entries:t.inspect().entries},
  {value:11,entries:1});
 t.take(cap,owner,'key');t.insert(cap,owner,'other',22);
 assert.equal(t.lookup(cap,owner,'other').value,22);
});

test('ETS cross-domain heir and delegated readers are rejected',()=>{
 const foreign={domain:'foreign',actor:'heir',generation:1};
 assert.throws(()=>new EtsSetReference({owner,heir:foreign}));
 const t=new EtsSetReference({owner,access:'public'}),cap=t.issue(owner);
 assert.throws(()=>t.delegate(cap,owner,foreign));
});
