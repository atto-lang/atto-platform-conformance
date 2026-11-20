import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

// SOURCE-FREE CONTRACT ORACLE. It neither invokes a backend compiler nor
// certifies any guest runtime, isolation boundary, or hard real-time behavior.
const contract = JSON.parse(readFileSync(
  new URL("../contracts/actor-finalization-v1.json", import.meta.url), "utf8"));
const priority = new Map(contract.invariants.stopCauseOrder.map((v, i) => [v, i]));
class Actor {
  constructor(id) {
    this.id = id;
    this.generation = 1;
    this.accepting = true;
    this.retired = new Set();
    this.observers = 0;
    this.payload = ["original"];
  }
  key(gen = this.generation) { return `${this.id}:${gen}`; }
  restart() {
    // Reference supervisor completes prior incarnation before publishing new.
    const key = this.key();
    if (!this.retired.has(key)) { this.retired.add(key); ++this.observers; }
    ++this.generation;
    this.accepting = true;
    this.payload = ["replacement"];
  }
}
class Queue {
  constructor(capacity = 1) { this.capacity = capacity; this.tickets = []; }
  request(actor, expected = actor.generation, cause = "requested") {
    if (!priority.has(cause)) return "Invalid";
    const existing = this.tickets.find(t => t.actor === actor && t.gen === expected);
    if (existing) {
      if (priority.get(cause) > priority.get(existing.cause)) existing.cause = cause;
      return "AlreadyQueued";
    }
    if (actor.generation !== expected || expected === 0) return "Raced";
    if (actor.retired.has(actor.key(expected))) return "AlreadyFinalized";
    if (this.tickets.length >= this.capacity) return "Full";
    actor.accepting = false;
    this.tickets.push({actor,gen:expected,cause});
    return "Queued";
  }
  drain() {
    const ticket = this.tickets.shift();
    if (!ticket) return null;
    const {actor,gen,cause} = ticket;
    const key = actor.key(gen);
    if (gen !== actor.generation) return {kind:"stale",gen,cause};
    if (actor.retired.has(key)) return {kind:"duplicate",gen,cause};
    actor.retired.add(key);
    ++actor.observers;
    return {kind:"completed",gen,cause};
  }
}
test("contract is a 20-case unauthenticated guest-parity gate", () => {
  assert.equal(contract.schema, "oreslang.actor-finalization.v1");
  assert.equal(contract.status, "candidate-unattested");
  assert.deepEqual(contract.backendTargets, ["java","llvm","wasm","cranelift","net"]);
  assert.deepEqual(contract.additionalExperimentalBackendTargets, ["forge"]);
  assert.equal(contract.scenarios.length, 20);
  assert.equal(new Set(contract.scenarios.map(c=>c.id)).size, 20);
  assert.deepEqual(contract.scenarios.map(c=>c.id),
    Array.from({length:20},(_,i)=>"AF"+String(i+1).padStart(2,"0")));
  for (const scenario of contract.scenarios) {
    assert.match(scenario.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(scenario.requires.length > 0);
  }
  for (const state of Object.values(contract.backendEvidence)) {
    assert.equal(state.status,"unverified");
    assert.equal(state.hostModelCountsAsPass,false);
    assert.equal(state.unsupportedSyntaxCountsAsPass,false);
  }
  assert.equal(contract.promotion.runnerIdNonzero,true);
  assert.equal(contract.promotion.executedStepsNonempty,true);
  assert.equal(contract.promotion.nativeGuestExecution,true);
  assert.equal(contract.promotion.noPrivateSourceTransferWithoutSecurityClearance,true);
});
test("stale restart snapshots never close or erase replacement",()=>{
  const actor=new Actor(7),queue=new Queue();
  const old=actor.generation;
  actor.restart();
  assert.equal(queue.request(actor,old),"Raced");
  assert.equal(actor.accepting,true);
  assert.deepEqual(actor.payload,["replacement"]);
  assert.equal(queue.tickets.length,0);
  assert.equal(queue.request(actor,actor.generation),"Queued");
  assert.equal(actor.accepting,false);
  assert.deepEqual(queue.drain(),{kind:"completed",gen:2,cause:"requested"});
});
test("bounded admission refuses without fencing, and capacity recovers",()=>{
  const q=new Queue(), a=new Actor(1),b=new Actor(2);
  assert.equal(q.request(a),"Queued");
  assert.equal(q.request(b),"Full");
  assert.equal(b.accepting,true);
  assert.equal(q.request(a,1,"panicked"),"AlreadyQueued");
  assert.deepEqual(q.drain(),{kind:"completed",gen:1,cause:"panicked"});
  assert.equal(q.request(a),"AlreadyFinalized");
  assert.equal(q.request(b),"Queued");
  assert.deepEqual(q.drain(),{kind:"completed",gen:1,cause:"requested"});
});
test("separate supervisor queues emit a single retirement winner",()=>{
  for(let round=0;round<128;round++){
    const actor=new Actor(round+100);
    const queues=Array.from({length:4},()=>new Queue());
    for(const q of queues) assert.equal(q.request(actor),"Queued");
    const order=[0,1,2,3];
    for(let i=3;i>0;i--){const j=(round*17+i*19)%(i+1); [order[i],order[j]]=[order[j],order[i]];}
    const outcomes=order.map(i=>queues[i].drain().kind);
    assert.equal(outcomes.filter(v=>v==="completed").length,1);
    assert.equal(outcomes.filter(v=>v==="duplicate").length,3);
    assert.equal(actor.observers,1);
    for(const q of queues) assert.equal(q.tickets.length,0);
  }
});
test("old ticket is stale after a successful supervised restart",()=>{
  const actor=new Actor(25), q=new Queue();
  assert.equal(q.request(actor),"Queued");
  actor.restart();
  assert.equal(q.drain().kind,"stale");
  assert.equal(actor.generation,2);
  assert.equal(actor.accepting,true);
  assert.deepEqual(actor.payload,["replacement"]);
});
test("stop-cause escalation is monotonic and malformed causes inert",()=>{
  for(const first of priority.keys()){
    const actor=new Actor(first), q=new Queue();
    assert.equal(q.request(actor,1,first),"Queued");
    let expected=first;
    for(const cause of [...priority.keys()].reverse()){
      assert.equal(q.request(actor,1,cause),"AlreadyQueued");
      if(priority.get(cause)>priority.get(expected))expected=cause;
    }
    assert.equal(q.request(actor,1,"host-forged"),"Invalid");
    assert.equal(q.drain().cause,expected);
    assert.equal(q.request(actor,1,"panicked"),"AlreadyFinalized");
  }
});
test("seeded finite reference schedules retain closure invariants",()=>{
  const operations=["request","restart","drain","panic","drain"];
  for(let seed=0;seed<256;seed++){
    const a=new Actor(seed+500),q=new Queue(2);
    let state=seed+1;
    const schedule=operations.slice();
    for(let i=schedule.length-1;i>0;i--){
      state=(Math.imul(state,1664525)+1013904223)>>>0;
      const j=state%(i+1);
      [schedule[i],schedule[j]]=[schedule[j],schedule[i]];
    }
    for(const op of schedule){
      if(op==="restart")a.restart();
      else if(op==="drain")q.drain();
      else q.request(a,a.generation,op==="panic"?"panicked":"requested");
      assert.ok(a.observers>=0 && a.observers<=a.generation);
      assert.ok(q.tickets.length<=q.capacity);
      assert.deepEqual(a.payload,[a.generation>1?"replacement":"original"]);
    }
    while(q.drain()){}
    assert.ok(q.tickets.length===0);
  }
});
