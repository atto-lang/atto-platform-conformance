import test from "node:test";
import assert from "node:assert/strict";
import {PubSubReference,share} from "../models/actor-pubsub-portable-v1.mjs";

const admitted=(result)=>{assert.equal(result.ok,true,result.error);return result;};
function groupWithActors(bus){
  const group=admitted(bus.group("pg/workers")).group;
  const a=admitted(bus.actor("a",1)).actor;
  const b=admitted(bus.actor("b",1)).actor;
  const ga=admitted(bus.join(group,a)).membership;
  return {group,a,b,ga};
}

test("monitor gets atomic initial snapshot and only real membership transitions",()=>{
  const bus=new PubSubReference();
  const {group,a,b,ga}=groupWithActors(bus);
  const watch=admitted(bus.monitorGroup(group,ga,4));
  assert.deepEqual(watch.members,[a.key]);
  assert.equal(watch.revision,"1");
  assert.equal(Object.isFrozen(watch.members),true);
  assert.equal(bus.monitorGroup(group,{},1).error,"UnauthorizedMonitor");
  const gb=admitted(bus.join(group,b)).membership;
  assert.equal(bus.join(group,b).alreadyMember,true);
  const joined=admitted(bus.pollGroupMonitor(watch.monitor,ga)).event;
  assert.deepEqual(joined,{kind:"join",group_id:group.id,actor_key:b.key,revision:"2"});
  assert.equal(Object.isFrozen(joined),true);
  assert.equal(bus.pollGroupMonitor(watch.monitor,ga).error,"Empty");
  admitted(bus.leave(gb));
  assert.deepEqual(admitted(bus.pollGroupMonitor(watch.monitor,ga)).event,{
    kind:"leave",group_id:group.id,actor_key:b.key,revision:"3"
  });
  assert.equal(bus.pollGroupMonitor(watch.monitor,gb).error,"UnauthorizedMonitor");
});

test("bounded monitor overflow requires explicit resync; DATA queues are separate",()=>{
  const bus=new PubSubReference({maxGroupMonitors:1});
  const {group,a,b,ga}=groupWithActors(bus);
  const monitor=admitted(bus.monitorGroup(group,ga,1)).monitor;
  assert.equal(bus.monitorGroup(group,ga,1).error,"ResourceExhausted");
  const topic=admitted(bus.topicInGroup(group,"events","int")).topic;
  const sub=admitted(bus.subscribe(topic,"group",group,2)).subscription;
  assert.equal(bus.tryPublish(topic,share(42),ga).receipt.recipients,1);
  assert.equal(bus.pollGroupMonitor(monitor,ga).error,"Empty",
    "publishing a DATA topic cannot forge a pg membership event");
  const gb=admitted(bus.join(group,b)).membership;
  admitted(bus.leave(gb)); // two changes overflow the one-event control queue
  assert.equal(bus.pollGroupMonitor(monitor,ga).error,"MonitorOverflow");
  assert.equal(bus.pollGroupMonitor(monitor,ga).error,"MonitorOverflow");
  const resync=admitted(bus.resyncGroupMonitor(monitor,ga));
  assert.deepEqual(resync.members,[a.key]);
  assert.equal(resync.revision,"3");
  assert.equal(bus.pollGroupMonitor(monitor,ga).error,"Empty");
  assert.equal(admitted(bus.start(sub,a)).delivery.payload,42);
  admitted(bus.finish(sub,a));
  admitted(bus.unmonitorGroup(monitor,ga));
  assert.equal(bus.groupMonitorCount,0);
  assert.equal(bus.pollGroupMonitor(monitor,ga).error,"StaleMonitor");
  assert.equal(bus.monitorGroup(group,ga,1).ok,true,
    "unmonitor must reclaim the quota");
});

test("owner leave and retirement revoke exact monitor handles, not other members",()=>{
  const bus=new PubSubReference();
  const {group,a,b,ga}=groupWithActors(bus);
  const gb=admitted(bus.join(group,b)).membership;
  const wa=admitted(bus.monitorGroup(group,ga)).monitor;
  const wb=admitted(bus.monitorGroup(group,gb)).monitor;
  assert.equal(bus.groupMonitorCount,2);
  admitted(bus.leave(ga));
  assert.equal(bus.pollGroupMonitor(wa,ga).error,"StaleMonitor");
  assert.deepEqual(admitted(bus.pollGroupMonitor(wb,gb)).event,{
    kind:"leave",group_id:group.id,actor_key:a.key,revision:"3"
  });
  assert.equal(bus.groupMonitorCount,1);
  admitted(bus.stopActor(b));
  assert.equal(bus.pollGroupMonitor(wb,gb).error,"StaleMonitor");
  assert.equal(bus.groupMonitorCount,0);
});

test("unforgeable monitors deny cross-broker, wrong-grant and post-close reads",()=>{
  const first=new PubSubReference(),second=new PubSubReference();
  const f=groupWithActors(first),s=groupWithActors(second);
  const monitor=admitted(first.monitorGroup(f.group,f.ga,2)).monitor;
  assert.equal(second.pollGroupMonitor(monitor,s.ga).error,"StaleMonitor");
  assert.equal(first.pollGroupMonitor(monitor,s.ga).error,"UnauthorizedMonitor");
  assert.equal(first.resyncGroupMonitor(monitor,s.ga).error,"UnauthorizedMonitor");
  assert.equal(first.unmonitorGroup(monitor,s.ga).error,"UnauthorizedMonitor");
  admitted(first.closeGroup(f.group));
  assert.equal(first.pollGroupMonitor(monitor,f.ga).error,"StaleMonitor");
  assert.equal(first.groupMonitorCount,0);
  assert.equal(second.monitorGroup(s.group,s.ga).ok,true);
  admitted(second.close());
  assert.equal(second.groupMonitorCount,0);
  assert.equal(second.monitorGroup(s.group,s.ga).error,"Closed");
});

test("group monitor quota and capacity values fail closed",()=>{
  for(const value of [0,-1,1.5,Infinity,NaN,"2",null]){
    assert.throws(()=>new PubSubReference({maxGroupMonitors:value}),RangeError);
  }
  const bus=new PubSubReference();
  const {group,ga}=groupWithActors(bus);
  for(const value of [0,-1,1.5,Infinity,NaN,"2",null]){
    assert.equal(bus.monitorGroup(group,ga,value).error,"InvalidCapacity");
  }
  assert.equal(bus.groupMonitorCount,0);
});

test("per-actor and queue caps prevent one member monopolizing control resources",()=>{
  const bus=new PubSubReference({
    maxGroupMonitors:4,maxGroupMonitorsPerActor:2,
    maxGroupMonitorQueueCapacity:2
  });
  const {group,a,b,ga}=groupWithActors(bus);
  assert.equal(bus.monitorGroup(group,ga,3).error,"InvalidCapacity");
  const one=admitted(bus.monitorGroup(group,ga,2)).monitor;
  const two=admitted(bus.monitorGroup(group,ga,2)).monitor;
  assert.equal(bus.monitorGroup(group,ga,2).error,"ResourceExhausted");
  const gb=admitted(bus.join(group,b)).membership;
  const other=admitted(bus.monitorGroup(group,gb,2)).monitor;
  assert.equal(bus.groupMonitorCount,3);
  admitted(bus.unmonitorGroup(one,ga));
  assert.equal(bus.groupMonitorCount,2);
  assert.equal(bus.monitorGroup(group,ga,2).ok,true);
  admitted(bus.leave(ga));
  assert.equal(bus.groupMonitorCount,1,
    "owner leave reclaims every grant-owned monitor without affecting another actor");
  assert.equal(bus.pollGroupMonitor(two,ga).error,"StaleMonitor");
  assert.deepEqual(admitted(bus.pollGroupMonitor(other,gb)).event,{
    kind:"leave",group_id:group.id,actor_key:a.key,revision:"3"
  });
  for(const key of ["maxGroupMonitorsPerActor","maxGroupMonitorQueueCapacity"]){
    for(const value of [0,-1,1.5,Infinity,NaN,"2",null]){
      assert.throws(()=>new PubSubReference({[key]:value}),RangeError);
    }
  }
});
