import test from "node:test";
import assert from "node:assert/strict";
import {PubSubReference,share} from "../models/actor-pubsub-portable-v1.mjs";

const admitted=(result,label)=>{
  assert.equal(result.ok,true,label+": "+(result.error??"unexpected failure"));
  return result;
};
const payload=(id)=>share({id});

test("policy identity is stable and invalid definitions are fail-closed",()=>{
  const bus=new PubSubReference();
  assert.equal(bus.topic("events","Event",null,"UNKNOWN").error,"InvalidPolicy");
  const latest=admitted(bus.topic("events","Event",null,"LATEST"),"topic").topic;
  assert.equal(bus.topic("events","Event",null,"RELIABLE").error,"TopicPolicyMismatch");
  assert.equal(bus.topic("events","Other",null,"LATEST").error,"TopicTypeMismatch");
  assert.equal(bus.topic("events","Event",null,"LATEST").topic,latest);
  const actor=admitted(bus.actor("a"),"actor").actor;
  assert.equal(bus.subscribe(latest,"actor",actor,2).error,"InvalidCapacity");
  const sub=admitted(bus.subscribe(latest,"actor",actor,1),"latest sub").subscription;
  assert.equal(bus.subscribe(latest,"actor",actor,1).subscription,sub);
  assert.equal(bus.subscriptionCount,1);
  assert.equal(bus.topicStats(latest).stats.policy,"LATEST");
});

test("RELIABLE fanout refuses globally without sequence or metric gaps",()=>{
  const bus=new PubSubReference();
  const a=bus.actor("a").actor,b=bus.actor("b").actor;
  const topic=bus.topic("tx","Event").topic;
  const sa=bus.subscribe(topic,"actor",a,1).subscription;
  const sb=bus.subscribe(topic,"actor",b,1).subscription;
  const first=admitted(bus.tryPublish(topic,payload(1)),"first").receipt;
  assert.deepEqual([first.recipients,first.accepted,first.dropped,first.coalesced],
    [2,2,0,0]);
  assert.equal(bus.start(sa,a).delivery.payload.id,1);
  assert.equal(bus.tryPublish(topic,payload(2)).error,"Full");
  assert.equal(bus.topicStats(topic).stats.sequence,"1");
  assert.equal(bus.start(sb,b).delivery.payload.id,1);
  assert.equal(bus.start(sb,b).error,"Empty");
  bus.finish(sa,a);bus.finish(sb,b);
  const second=admitted(bus.tryPublish(topic,payload(3)),"after drain").receipt;
  assert.equal(second.sequence,"2");
  assert.equal(bus.topicStats(topic).stats.published,"2");
  assert.equal(bus.topicStats(topic).stats.accepted,"4");
});

test("LOSSY drops saturated recipients without blocking healthy subscribers",()=>{
  const bus=new PubSubReference();
  const a=bus.actor("a").actor,b=bus.actor("b").actor;
  const topic=bus.topic("telemetry","Event",null,"LOSSY").topic;
  const sa=bus.subscribe(topic,"actor",a,1).subscription;
  const sb=bus.subscribe(topic,"actor",b,1).subscription;
  admitted(bus.tryPublish(topic,payload(1)),"first");
  const runningB=admitted(bus.start(sb,b),"begin B");
  assert.equal(runningB.delivery.payload.id,1);
  assert.equal(bus.start(sa,a).delivery.payload.id,1);
  bus.finish(sa,a);
  const second=admitted(bus.tryPublish(topic,payload(2)),"second").receipt;
  assert.deepEqual([second.recipients,second.accepted,second.dropped,second.coalesced],
    [2,1,1,0]);
  assert.equal(bus.start(sa,a).delivery.payload.id,2);
  bus.finish(sa,a);
  bus.finish(sb,b);
  assert.equal(bus.start(sb,b).error,"Empty");
  assert.deepEqual(bus.topicStats(topic).stats,{
    policy:"LOSSY",sequence:"2",published:"2",accepted:"3",
    dropped:"1",coalesced:"0"
  });
});

test("LATEST coalesces unread only and preserves in-flight delivery",()=>{
  const bus=new PubSubReference();
  const a=bus.actor("a").actor;
  const topic=bus.topic("snapshots","Event",null,"LATEST").topic;
  const sub=bus.subscribe(topic,"actor",a,1).subscription;
  assert.equal(bus.tryPublish(topic,payload("v1")).receipt.coalesced,0);
  assert.equal(bus.start(sub,a).delivery.payload.id,"v1");
  assert.equal(bus.tryPublish(topic,payload("v2")).receipt.coalesced,0);
  const latest=admitted(bus.tryPublish(topic,payload("v3")),"latest").receipt;
  assert.deepEqual([latest.recipients,latest.accepted,latest.dropped,latest.coalesced],
    [1,1,0,1]);
  assert.equal(bus.start(sub,a).error,"Busy",
    "a second handler cannot race an older in-flight latest value");
  bus.finish(sub,a);
  const next=admitted(bus.start(sub,a),"begin replacement");
  assert.equal(next.delivery.payload.id,"v3");
  bus.finish(sub,a);
  assert.equal(bus.start(sub,a).error,"Empty");
  assert.deepEqual(bus.topicStats(topic).stats,{
    policy:"LATEST",sequence:"3",published:"3",accepted:"3",
    dropped:"0",coalesced:"1"
  });
});

test("overlapping ActorGroups keep QoS and publication grants independent",()=>{
  const bus=new PubSubReference();
  const actor=bus.actor("same",1).actor;
  const left=bus.group("left").group,right=bus.group("right").group;
  const gl=bus.join(left,actor).membership,gr=bus.join(right,actor).membership;
  const leftTopic=bus.topicInGroup(left,"signals","Event","LOSSY").topic;
  const rightTopic=bus.topicInGroup(right,"signals","Event","LATEST").topic;
  const ls=bus.subscribe(leftTopic,"group",left,1).subscription;
  const rs=bus.subscribe(rightTopic,"group",right,1).subscription;
  assert.equal(bus.tryPublish(leftTopic,payload(1),gl).receipt.policy,"LOSSY");
  assert.equal(bus.tryPublish(rightTopic,payload(2),gr).receipt.policy,"LATEST");
  assert.equal(bus.leave(gl).ok,true);
  assert.equal(bus.tryPublish(leftTopic,payload(3),gl).error,"UnauthorizedPublisher");
  assert.equal(bus.start(ls,actor).error,"UnauthorizedSubscriber");
  assert.equal(bus.tryPublish(rightTopic,payload(4),gr).ok,true);
  assert.equal(bus.start(rs,actor).delivery.payload.id,4);
  bus.finish(rs,actor);
  assert.equal(bus.leave(gr).ok,true);
});

test("diagnostics are detached, quota-neutral, and never grant topic authority",()=>{
  const bus=new PubSubReference({maxTopics:1});
  const topic=bus.topic("metrics","Event",null,"LOSSY").topic;
  const first=admitted(bus.topicStats(topic),"initial metrics").stats;
  assert.equal(Object.isFrozen(first),true);
  assert.equal(bus.tryPublish(topic,payload("no subscribers")).receipt.recipients,0);
  assert.equal(first.sequence,"0","previous metrics snapshot cannot mutate");
  const second=bus.topicStats(topic).stats;
  assert.equal(second.sequence,"1");
  assert.equal(second.published,"1");
  assert.equal(bus.topic("another","Event").error,"ResourceExhausted");
  const other=new PubSubReference();
  assert.equal(other.topicStats(topic).error,"UnknownTopic");
  bus.close();
  assert.equal(bus.topicStats(topic).error,"Closed");
});
