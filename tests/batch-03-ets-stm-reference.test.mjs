import test from "node:test";
import assert from "node:assert/strict";
import {EtsSetReference, StmReference} from "../src/batch-03-ets-stm-reference.mjs";

const owner = {domain:"tenant",actor:"owner",generation:1};
const reader = {domain:"tenant",actor:"reader",generation:1};

test("ETS single-key operations preserve set and CAS semantics",()=>{
  const table=new EtsSetReference({owner,maxEntries:2});
  const handle=table.issue(owner);
  assert.equal(table.insertNew(handle,owner,"key",1),true);
  assert.equal(table.insertNew(handle,owner,"key",2),false);
  assert.equal(table.compareExchange(handle,owner,"key",2,3),false);
  assert.equal(table.compareExchange(handle,owner,"key",1,3),true);
  assert.equal(table.lookup(handle,owner,"key").value,3);
  assert.equal(table.take(handle,owner,"key").value,3);
});

test("ETS read permission does not grant write permission",()=>{
  const table=new EtsSetReference({owner,access:"protected"});
  const first=table.issue(owner);
  const second=table.delegate(first,owner,reader);
  table.insert(first,owner,"key",7);
  assert.equal(table.lookup(second,reader,"key").value,7);
  assert.throws(()=>table.insert(second,reader,"key",8));
});

test("ETS revokes all stale capabilities when owner leaves",()=>{
  const table=new EtsSetReference({owner,access:"public"});
  const cap=table.issue(owner);
  const guest=table.delegate(cap,owner,reader);
  table.ownerExit(owner);
  assert.throws(()=>table.lookup(cap,owner,"key"));
  assert.throws(()=>table.lookup(guest,reader,"key"));
});

test("STM two-cell commit validates every read before any write",()=>{
  const stm=new StmReference();
  const left=stm.create(10),right=stm.create(20);
  const oldLeft=stm.snapshot(left),oldRight=stm.snapshot(right);
  const out=stm.commit({reads:[
    {ref:left,version:oldLeft.version},{ref:right,version:oldRight.version}
  ],writes:[{ref:left,value:8},{ref:right,value:22}]});
  assert.equal(out.committed,true);
  assert.equal(stm.snapshot(left).value+stm.snapshot(right).value,30);
  const conflict=stm.commit({reads:[
    {ref:left,version:oldLeft.version},{ref:right,version:oldRight.version}
  ],writes:[{ref:right,value:999}]});
  assert.equal(conflict.committed,false);
  assert.equal(stm.snapshot(right).value,22);
});

test("STM rejects effects and foreign TRef capabilities",()=>{
  const stm=new StmReference(),ref=stm.create(1);
  assert.throws(()=>stm.snapshot({tref:1}));
  assert.throws(()=>stm.commit({reads:[{ref,version:1}],
    writes:[],effects:["await"]}));
});

test("ETS and STM models never certify guest runtime integration",()=>{
  const ets=new EtsSetReference({owner});
  assert.equal(ets.inspect().guestApiVerified,false);
  assert.equal(new StmReference().inspect().guestStmVerified,false);
});

test("versioned ETS compareExchange rejects stale per-key generation",()=>{
 const table=new EtsSetReference({owner,maxEntries:2});
 const cap=table.issue(owner);
 table.insert(cap,owner,"item",1);
 const prior=table.lookup(cap,owner,"item");
 table.take(cap,owner,"item");
 table.insert(cap,owner,"item",1);
 assert.equal(table.compareExchangeVersioned(cap,owner,"item",1,prior.version,7),false);
 const current=table.lookup(cap,owner,"item");
 assert.ok(current.version>prior.version);
 assert.equal(table.compareExchangeVersioned(cap,owner,"item",1,current.version,9),true);
});
