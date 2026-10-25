import test from "node:test";
import assert from "node:assert/strict";
import {ActorLockModel, FencedResourceModel} from "../models/actor-lock-lifecycle-v1.mjs";

function setup() {
  const m=new ActorLockModel();
  const a=m.spawn("actor",1), b=m.spawn("other",1);
  m.task(a,"t1");m.task(a,"t2");m.task(b,"t1");
  return {m,a,b};
}
test("different Tasks in one actor have independent lock identities",()=>{
  const {m,a,b}=setup();
  const p=m.acquire(a,"t1","key");
  const waiter=m.acquire(a,"t2","key");
  const remote=m.acquire(b,"t1","key");
  assert.equal(waiter.status,"queued");
  m.quiesceTask(a,"t1");
  assert.equal(p.status,"released");
  assert.equal(waiter.status,"held");
  assert.equal(remote.status,"queued");
  m.assertConsistent();
});
test("STOP fences admission but retains a held permit until physical quiescence",()=>{
  const {m,a,b}=setup();
  const p=m.acquire(a,"t1","key");
  const next=m.acquire(b,"t1","key");
  m.stopActor(a);
  assert.equal(p.status,"held");
  assert.equal(next.status,"queued");
  assert.throws(()=>m.acquire(a,"t2","another"),/fenced/);
  m.quiesceTask(a,"t2");
  assert.equal(next.status,"queued");
  m.quiesceTask(a,"t1");
  assert.equal(p.status,"released");
  assert.equal(next.status,"held");
  assert.equal(m.actor(a).phase,"retired");
  assert.equal(m.release(p),false);
  m.assertConsistent();
});
test("actor-scoped transfer is explicit and outlives the granting Task, not its actor",()=>{
  const {m,a,b}=setup();
  assert.throws(()=>m.acquire(a,"t1","x","write","actor"),/explicit authority/);
  const p=m.acquire(a,"t1","x","write","actor",true);
  const other=m.acquire(b,"t1","x");
  m.quiesceTask(a,"t1");
  assert.equal(p.status,"held");
  m.stopActor(a);
  assert.equal(other.status,"queued");
  m.quiesceTask(a,"t2");
  assert.equal(other.status,"held");
  m.assertConsistent();
});
test("cancel queued request before handoff never grants it",()=>{
  const {m,a,b}=setup();
  m.acquire(a,"t1","x");
  const pending=m.acquire(b,"t1","x");
  m.cancelTask(b,"t1");
  m.quiesceTask(a,"t1");
  assert.equal(pending.status,"cancelled");
  assert.equal(m.lock("x").holders.length,0);
  m.assertConsistent();
});
test("handoff before cancellation retains permit until loser quiesces",()=>{
  const {m,a,b}=setup();
  m.acquire(a,"t1","x");
  const pending=m.acquire(b,"t1","x");
  m.quiesceTask(a,"t1");
  assert.equal(pending.status,"held");
  m.cancelTask(b,"t1");
  assert.equal(pending.status,"held");
  m.quiesceTask(b,"t1");
  assert.equal(pending.status,"released");
  m.assertConsistent();
});
test("reader batching never overlaps writer; queued writer blocks reader barging",()=>{
  const {m,a,b}=setup();
  const r1=m.acquire(a,"t1","rw","read");
  const r2=m.acquire(a,"t2","rw","read");
  const w=m.acquire(b,"t1","rw","write");
  m.task(a,"t3");
  const r3=m.acquire(a,"t3","rw","read");
  assert.equal(r1.status,"held");assert.equal(r2.status,"held");
  assert.equal(r3.status,"queued");
  m.quiesceTask(a,"t1");m.quiesceTask(a,"t2");
  assert.equal(w.status,"held");assert.equal(r3.status,"queued");
  m.quiesceTask(b,"t1");
  assert.equal(r3.status,"held");
  m.assertConsistent();
});
test("dirty writer death poisons and demands explicit recovery",()=>{
  const {m,a,b}=setup();
  m.acquire(a,"t1","state");
  const next=m.acquire(b,"t1","state");
  m.stopActor(a);
  m.quiesceTask(a,"t2");
  m.quiesceTask(a,"t1",true);
  assert.equal(next.status,"queued");
  assert.equal(m.lock("state").poisoned,true);
  m.recover("state");
  assert.equal(next.status,"held");
  m.assertConsistent();
});
test("incarnation changes cannot release an old owner's permit",()=>{
  const m=new ActorLockModel();
  const old=m.spawn("same",3);m.task(old,"t");
  const p=m.acquire(old,"t","x");
  m.stopActor(old);m.quiesceTask(old,"t");
  const newer=m.spawn("same",4);m.task(newer,"t");
  const fresh=m.acquire(newer,"t","x");
  assert.equal(fresh.status,"held");
  assert.equal(m.release(p),false);
  assert.equal(fresh.status,"held");
  m.assertConsistent();
});
test("fencing token rejects late writes from expired remote owner",()=>{
  const resource=new FencedResourceModel();
  assert.equal(resource.write(41,"old"),true);
  assert.equal(resource.write(42,"new"),true);
  assert.equal(resource.write(41,"stale"),false);
  assert.equal(resource.value,"new");
  assert.equal(resource.write(0,"invalid"),false);
});
