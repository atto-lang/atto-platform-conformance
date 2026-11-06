import test from "node:test";
import assert from "node:assert/strict";
import {ActorLockModel} from "../models/actor-lock-lifecycle-v1.mjs";

// Abstract model checks only: no Oreslang guest/parallel execution is claimed.
function two_actors() {
  const m=new ActorLockModel();
  const a=m.spawn("A", 1), b=m.spawn("B", 1);
  m.task(a, "turn"); m.task(b, "turn");
  return {m,a,b};
}

test("fenced queued Task is unlinked from reverse index at grant handoff", () => {
  const {m,a,b}=two_actors();
  const old=m.acquire(a,"turn","state","write");
  const waiting=m.acquire(b,"turn","state","write");
  assert.equal(waiting.status,"queued");
  // Inject the scheduler's Task fence before its queue-cancellation callback.
  // The incumbent's release can now reach the fenced ticket first.
  m.actor(b).tasks.set("turn","stopping");
  assert.equal(m.release(old),true);
  assert.equal(waiting.status,"cancelled");
  assert.equal(m.actor(b).permits.has(waiting),false);
  assert.equal(m.lock("state").queue.length,0);
  assert.equal(m.lock("state").holders.length,0);
  m.assertConsistent();
  m.stopActor(a); m.quiesceTask(a,"turn");
  m.stopActor(b); m.quiesceTask(b,"turn");
  assert.equal(m.actor(b).phase,"retired");
  m.assertConsistent();
});

test("reverse index detects settled ticket resurrected after release", () => {
  const {m,a}=two_actors();
  const p=m.acquire(a,"turn","s");
  m.release(p);
  m.actor(a).permits.add(p);
  assert.throws(()=>m.assertConsistent(),/settled permit/);
});

test("reverse index detects orphan queued entry", () => {
  const {m,a,b}=two_actors();
  m.acquire(a,"turn","s");
  const p=m.acquire(b,"turn","s");
  m.lock("s").queue.splice(m.lock("s").queue.indexOf(p),1);
  assert.throws(()=>m.assertConsistent(),/orphan queued/);
});

test("reverse index detects orphan held entry", () => {
  const {m,a}=two_actors();
  const p=m.acquire(a,"turn","s");
  m.lock("s").holders.splice(m.lock("s").holders.indexOf(p),1);
  assert.throws(()=>m.assertConsistent(),/orphan held/);
});

test("retired actor is forbidden from retaining a permit", () => {
  const {m,a}=two_actors();
  m.acquire(a,"turn","s");
  m.actor(a).phase="retired"; // fault-inject inconsistent teardown
  assert.throws(()=>m.assertConsistent(),/retired actor retains/);
});

test("fenced Task cannot retain an outstanding queued permit", () => {
  const {m,a,b}=two_actors();
  m.acquire(a,"turn","s");
  m.acquire(b,"turn","s");
  m.actor(b).tasks.set("turn","stopping"); // fault injection, before settlement
  assert.throws(()=>m.assertConsistent(),/fenced task retains queued/);
});

test("queued cancellation has one winner and is idempotent", () => {
  const {m,a,b}=two_actors();
  const held=m.acquire(a,"turn","s");
  const p=m.acquire(b,"turn","s");
  assert.equal(m.cancelQueued(p),true);
  assert.equal(m.cancelQueued(p),false);
  assert.equal(p.status,"cancelled");
  assert.equal(m.actor(b).permits.has(p),false);
  m.release(held);
  assert.equal(m.lock("s").holders.length,0);
  m.assertConsistent();
});

test("actor-incarnation lifecycle is consistent in all 720 six-event orders", () => {
  const events=["a_acquire","b_acquire","a_stop","a_quiesce","b_stop","b_quiesce"];
  let explored=0,contested=0;
  function run(seq) {
    const {m,a,b}=two_actors();
    const owner={a,b};
    for (const event of seq) {
      const key=owner[event[0]];
      if (event.endsWith("_acquire")) {
        const actor=m.actor(key);
        if (actor.phase==="live" && actor.tasks.get("turn")==="running")
          m.acquire(key,"turn","state","write");
      } else if (event.endsWith("_stop")) m.stopActor(key);
      else m.quiesceTask(key,"turn");
      m.assertConsistent();
    }
    const lock=m.lock("state");
    if (lock.holders.length>0 || lock.queue.length>0)
      throw Error("leaked lock after both actors stopped");
    assert.equal(m.actor(a).phase,"retired");
    assert.equal(m.actor(b).phase,"retired");
    assert.equal(m.actor(a).permits.size,0);
    assert.equal(m.actor(b).permits.size,0);
    m.spawn("A",2);m.spawn("B",2);
    assert.throws(()=>m.spawn("A",1),/stale or replayed/);
    explored++;
  }
  function permute(prefix,left) {
    if(left.length===0) {run(prefix);return;}
    for(let i=0;i<left.length;i++)
      permute(prefix.concat(left[i]),left.slice(0,i).concat(left.slice(i+1)));
  }
  permute([],events);
  assert.equal(explored,720);
});

test("writer poison is not cleared by cancelling its queued successor", () => {
  const {m,a,b}=two_actors();
  const held=m.acquire(a,"turn","sealed-state","write");
  const waiting=m.acquire(b,"turn","sealed-state","read");
  m.release(held,true);
  assert.equal(m.lock("sealed-state").poisoned,true);
  assert.equal(waiting.status,"queued");
  assert.equal(m.cancelQueued(waiting),true);
  assert.equal(m.lock("sealed-state").poisoned,true);
  m.assertConsistent();
});
