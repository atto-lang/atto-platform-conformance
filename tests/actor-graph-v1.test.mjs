import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runLongRunningGraph, ActorGroupOracle} from "../src/actor-graph-oracle-v1.mjs";

const manifest=JSON.parse(readFileSync(
  new URL("../contracts/actor-graph-v1/manifest.json",import.meta.url),"utf8"));

test("actor graph v1 never self-certifies host model as compiled guests",()=>{
  assert.equal(manifest.contract,"atto.actor-graph.long-running/1");
  assert.equal(manifest.status,"HOST_ORACLE_ONLY_NOT_GUEST_EXECUTION");
  assert.equal(manifest.evidence.model,"HOST_ONLY_NOT_CERTIFYING");
  assert.equal(manifest.evidence.parity,"NOT_CERTIFIED");
  assert.deepEqual(Object.keys(manifest.evidence.backendGuestExecution),
    ["java-graalvm","llvm-native","net-native-aot","wasm","forge"]);
  assert.ok(Object.values(manifest.evidence.backendGuestExecution).every(x=>x==="NOT_EXECUTED"));
  assert.ok(manifest.nonEvidence.includes("host-only-reference-oracle"));
  assert.ok(manifest.evidence.promotionRequirements.includes("actual-compiled-guest-binary-execution"));
  assert.ok(manifest.evidence.promotionRequirements.includes("stepful-workflow-run-job-and-runner"));
});

test("graph contract preserves strict I/O, mailbox, pubsub and CONTROL separation",()=>{
  const s=manifest.semanticBoundary;
  assert.match(s.actorInputOutput,/not-process-stdio/);
  assert.match(s.mailbox,/not-stdout/);
  assert.match(s.groupBus,/not-lifecycle-owner/);
  assert.match(s.supervisor,/not-pipeline-data/);
  assert.match(s.streamEof,/does-not-imply-actor-stop/);
  assert.equal(new Set(manifest.workloads.map(x=>x.id)).size,7);
  for(const id of ["bounded-dag-map-reduce","feedback-convergence",
    "group-multi-membership-pubsub","supervisor-restart-storm",
    "actor-io-vs-mailbox","multi-tenant-isolation"]){
    assert.ok(manifest.workloads.some(x=>x.id===id));
  }
});

test("10k deterministic bounded host workload restarts once without lost work",()=>{
  const x=runLongRunningGraph(manifest.hostOracle);
  assert.equal(x.count,10000);
  assert.equal(x.processed,10000);
  assert.equal(x.checksum,"333383345000");
  assert.equal(x.restarts,1);
  assert.equal(x.staleRejected,1);
  assert.ok(x.peakInbox<=4&&x.peakOutbox<=4);
  assert.ok(x.backpressure>0);
  assert.ok(x.latestOverwrites>0);
  assert.ok(x.ticks<10000*48);
});

test("host graph has bounded progress across small queue sizes and fault positions",()=>{
  for(const capacity of [1,2,3,8]){
    for(const failAt of [1,7,73]){
      const x=runLongRunningGraph({count:257,capacity,failAt});
      assert.equal(x.processed,257);
      assert.equal(x.restarts,1);
      assert.equal(x.staleRejected,1);
      assert.ok(x.peakInbox<=capacity);
      assert.ok(x.peakOutbox<=capacity);
      assert.equal(x.checksum, ((257n*258n*515n)/6n+257n).toString());
    }
  }
});

test("host graph refuses unbounded, zero and malformed admissions",()=>{
  for(const config of [{count:0},{count:100001},{count:NaN},{count:1.5},
    {capacity:0},{capacity:1025},{failAt:0},{failAt:10001},{failAt:1.25}]){
    assert.throws(()=>runLongRunningGraph(config),RangeError);
  }
});

test("RELIABLE group publication rejects atomically when any subscriber is full",()=>{
  const g=new ActorGroupOracle(1);
  g.openGroup("search");g.join("search","producer",1);
  g.join("search","fast",1);g.join("search","slow",1);
  g.addTopic("search","result","RELIABLE");
  g.subscribe("search","result","fast",1);
  g.subscribe("search","result","slow",1);
  assert.equal(g.publish("search","result","producer",1,"r1"),true);
  assert.equal(g.read("search","result","fast",1),"r1");
  assert.equal(g.publish("search","result","producer",1,"r2"),false);
  assert.equal(g.read("search","result","fast",1),null);
  assert.equal(g.read("search","result","slow",1),"r1");
  assert.equal(g.publish("search","result","producer",1,"r2"),true);
  assert.equal(g.read("search","result","fast",1),"r2");
  assert.equal(g.read("search","result","slow",1),"r2");
});

test("LATEST coalesces, groups remain independent and generation changes are fenced",()=>{
  const g=new ActorGroupOracle(1);
  g.openGroup("alpha");g.openGroup("beta");
  for(const name of ["alpha","beta"]){
    g.join(name,"producer",1);g.join(name,"monitor",1);
    g.addTopic(name,"progress","LATEST");
    g.subscribe(name,"progress","monitor",1);
  }
  assert.equal(g.publish("alpha","progress","producer",1,10),true);
  assert.equal(g.publish("alpha","progress","producer",1,20),true);
  assert.equal(g.read("alpha","progress","monitor",1),20);
  assert.equal(g.read("beta","progress","monitor",1),null);
  g.leave("alpha","monitor",1);
  assert.throws(()=>g.read("alpha","progress","monitor",1),/nonmember/);
  assert.equal(g.publish("beta","progress","producer",1,7),true);
  assert.equal(g.read("beta","progress","monitor",1),7);
  assert.throws(()=>g.join("alpha","producer",2),/incarnation/);
  g.close("alpha");
  assert.throws(()=>g.publish("alpha","progress","producer",1,1),/closed/);
  assert.equal(g.publish("beta","progress","producer",1,8),true);
  assert.equal(g.read("beta","progress","monitor",1),8);
});

test("unknown groups, forged memberships and expired subscriptions fail closed",()=>{
  const g=new ActorGroupOracle(1);
  g.openGroup("group");g.join("group","sender",1);
  g.addTopic("group","updates","RELIABLE");
  assert.throws(()=>g.subscribe("group","updates","unknown",1),/nonmember/);
  assert.throws(()=>g.publish("group","updates","sender",2,"wrong"),/nonmember/);
  assert.throws(()=>g.read("group","updates","sender",1),/subscriber/);
  assert.throws(()=>g.addTopic("group","updates","LATEST"),/invalid topic/);
  assert.throws(()=>g.openGroup("group"),/invalid group/);
  assert.throws(()=>new ActorGroupOracle(0),RangeError);
});
