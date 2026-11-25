import test from "node:test";
import assert from "node:assert/strict";
import {PubSubReference, share} from "../models/actor-pubsub-portable-v1.mjs";

function ok(value) {
  assert.equal(value.ok, true, value.error ?? "operation rejected");
  return value;
}
function setup() {
  const broker=new PubSubReference();
  const a=ok(broker.actor("watcher",1)).actor;
  const b=ok(broker.actor("member",1)).actor;
  const group=ok(broker.group("workers")).group;
  const grant=ok(broker.join(group,a)).membership;
  return {broker,a,b,group,grant};
}

test("membership revision is independent of monitoring and DATA publication",()=>{
  const {broker,a,b,group,grant}=setup();
  const m=ok(broker.monitorGroup(group,grant,4));
  assert.deepEqual(m.members,[a.key]);
  assert.equal(m.revision,"1");
  assert.equal(ok(broker.monitorGroup(group,grant,4)).revision,"1");
  const topic=ok(broker.topicInGroup(group,"log","int")).topic;
  const sub=ok(broker.subscribe(topic,"group",group,4)).subscription;
  ok(broker.tryPublish(topic,share(123),grant));
  assert.equal(broker.pollGroupMonitor(m.monitor,grant,"1").error,"Empty");
  assert.equal(broker.resyncGroupMonitor(m.monitor,grant).revision,"1");
  ok(broker.start(sub,a));ok(broker.finish(sub,a));
  ok(broker.join(group,b));
  const e=ok(broker.pollGroupMonitor(m.monitor,grant,"1")).event;
  assert.equal(e.revision,"2");
  assert.equal(Object.isFrozen(e),true);
  assert.equal(broker.pollGroupMonitor(m.monitor,grant).error,"Empty");
});

test("duplicate joins, rejected grants and rejected publication do not advance revisions",()=>{
  const {broker,a,b,group,grant}=setup();
  const m=ok(broker.monitorGroup(group,grant,5));
  assert.equal(ok(broker.join(group,a)).alreadyMember,true);
  assert.equal(broker.join(group,{}).error,"StaleTarget");
  assert.equal(broker.tryPublish({},share(1),grant).error,"UnknownTopic");
  assert.equal(broker.resyncGroupMonitor(m.monitor,grant).revision,"1");
  const other=ok(broker.join(group,b)).membership;
  assert.equal(ok(broker.pollGroupMonitor(m.monitor,grant,"1")).event.revision,"2");
  ok(broker.leave(other));
  assert.equal(ok(broker.pollGroupMonitor(m.monitor,grant,"2")).event.revision,"3");
  assert.equal(broker.resyncGroupMonitor(m.monitor,grant).revision,"3");
  assert.equal(broker.leave(other).error,"StaleMembership");
  assert.equal(broker.resyncGroupMonitor(m.monitor,grant).revision,"3");
});

test("strict cursor mismatch never dequeues; overflow resync repairs the stream",()=>{
  const {broker,b,group,grant}=setup();
  const m=ok(broker.monitorGroup(group,grant,2));
  ok(broker.join(group,b)); // rev 2
  for(const bad of ["0","2","3","-1","01","10.0",1,{}, "1".repeat(300)]){
    const r=broker.pollGroupMonitor(m.monitor,grant,bad);
    assert.equal(r.error,typeof bad==="string" && /^(0|[1-9][0-9]{0,255})$/.test(bad)
      ?"RevisionMismatch":"InvalidRevision",String(bad));
  }
  assert.equal(ok(broker.pollGroupMonitor(m.monitor,grant,"1")).event.revision,"2");
  const g=ok(broker.actor("overflow",1)).actor;
  const grantG=ok(broker.join(group,g)).membership; // rev 3, pending 1
  ok(broker.leave(grantG)); // rev 4, pending 2
  const freshG=ok(broker.join(group,g)).membership; // rev 5, overflow
  assert.equal(broker.pollGroupMonitor(m.monitor,grant,"2").error,"MonitorOverflow");
  const snap=ok(broker.resyncGroupMonitor(m.monitor,grant));
  assert.equal(snap.revision,"5");
  assert.deepEqual([...snap.members].sort(),[...group.members].sort());
  assert.equal(broker.pollGroupMonitor(m.monitor,grant,"5").error,"Empty");
  ok(broker.leave(freshG)); // rev 6
  assert.equal(ok(broker.pollGroupMonitor(m.monitor,grant,"5")).event.revision,"6");
});

test("two groups maintain independent clocks even for the same actor",()=>{
  const {broker,a,b,group,grant}=setup();
  const other=ok(broker.group("other")).group;
  const otherGrant=ok(broker.join(other,a)).membership;
  const m1=ok(broker.monitorGroup(group,grant,4));
  const m2=ok(broker.monitorGroup(other,otherGrant,4));
  assert.equal(m1.revision,"1");
  assert.equal(m2.revision,"1");
  const bGrant=ok(broker.join(group,b)).membership;
  assert.equal(ok(broker.pollGroupMonitor(m1.monitor,grant,"1")).event.revision,"2");
  assert.equal(broker.pollGroupMonitor(m2.monitor,otherGrant).error,"Empty");
  assert.equal(broker.resyncGroupMonitor(m2.monitor,otherGrant).revision,"1");
  ok(broker.leave(bGrant));
  assert.equal(ok(broker.pollGroupMonitor(m1.monitor,grant,"2")).event.revision,"3");
  assert.equal(broker.resyncGroupMonitor(m2.monitor,otherGrant).revision,"1");
});

test("leaving owner revokes strict cursor and resync authority",()=>{
  const {broker,b,group,grant}=setup();
  const m=ok(broker.monitorGroup(group,grant,2));
  ok(broker.join(group,b));
  ok(broker.leave(grant));
  assert.equal(broker.pollGroupMonitor(m.monitor,grant,"1").error,"StaleMonitor");
  assert.equal(broker.resyncGroupMonitor(m.monitor,grant).error,"StaleMonitor");
  ok(broker.close());
  assert.equal(broker.pollGroupMonitor(m.monitor,grant,"1").error,"StaleMonitor");
});
