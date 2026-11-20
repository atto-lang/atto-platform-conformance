import test from "node:test";
import assert from "node:assert/strict";
import {TransportLifetimeOracle} from "../src/batch05-transport-lifetime-oracle.mjs";

test("close retains socket capability ownership until all physical leases drain",()=>{
 const g=new TransportLifetimeOracle(12,2);
 const a=g.acquire(12),b=g.acquire(12);
 assert.ok(a&&b);assert.equal(g.acquire(12),null);
 g.close();assert.equal(g.acquire(12),null);
 assert.equal(g.state().retired,false);
 g.release(a);assert.equal(g.state().retired,false);
 g.release(b);assert.equal(g.state().retired,true);
 assert.equal(g.invariant(),true);
});
test("old generation cannot acquire rights in new incarnation",()=>{
 const old=new TransportLifetimeOracle(101),fresh=new TransportLifetimeOracle(102);
 const p=old.acquire(101);
 assert.equal(fresh.acquire(101),null);
 assert.ok(fresh.acquire(102));
 old.close();old.release(p);
 assert.equal(old.state().retired,true);
});
test("foreign and duplicate transport lease releases rejected",()=>{
 const a=new TransportLifetimeOracle(20),b=new TransportLifetimeOracle(20);
 const p=a.acquire(20);
 assert.throws(()=>b.release(p),/foreign/);
 a.release(p);assert.throws(()=>a.release(p),/stale/);
});
test("live lease survives close intent; retired socket cannot reopen",()=>{
 const g=new TransportLifetimeOracle(23),p=g.acquire(23);
 g.close();g.verify(p);g.release(p);
 assert.equal(g.acquire(23),null);
 assert.throws(()=>g.verify(p),/retired/);
});
test("six acquire close release orderings conserve ownership",()=>{
 for(const actions of [
  ["acquire","close","release"],["close","acquire","release"],
  ["acquire","release","close"],["close","release","acquire"],
  ["release","acquire","close"],["release","close","acquire"]
 ]){
  const g=new TransportLifetimeOracle(55,1);let p=null;
  for(const op of actions){
   if(op==="acquire")p=g.acquire(55);
   if(op==="close")g.close();
   if(op==="release"&&p)g.release(p);
   assert.equal(g.invariant(),true);
  }
  if(p&&!g.state().retired&&g.state().active===1)g.release(p);
  g.close();assert.equal(g.state().retired,true);
 }
});
test("100000 synthetic sessions never recycle closing generation",()=>{
 for(let i=1;i<=100000;i++){
  const g=new TransportLifetimeOracle(i,1);
  const p=g.acquire(i);g.close();
  assert.equal(g.acquire(i),null);
  g.release(p);assert.equal(g.state().retired,true);
 }
});
