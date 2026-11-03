import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PubSubReference, share} from "../models/actor-pubsub-portable-v1.mjs";

const manifest = JSON.parse(await readFile(
  new URL("../contracts/v1/actor-pubsub/portable-v1.json", import.meta.url), "utf8"));

function runCase(actions) {
  const bus = new PubSubReference();
  const actors=new Map(), groups=new Map(), topics=new Map();
  const subs=new Map(), memberships=new Map(), trace=[];
  const ok=(label,result)=>trace.push(label+":"+(result.ok?"ok":result.error));

  for (const action of actions) {
    const [op,...args]=action;
    switch (op) {
      case "actor": {
        const [alias,generation,id=alias]=args;
        const result=bus.actor(id,generation);
        assert.equal(result.ok,true,JSON.stringify(action));
        actors.set(alias,result.actor);
        break;
      }
      case "group": {
        const result=bus.group(args[0]);
        assert.equal(result.ok,true);
        groups.set(args[0],result.group);
        break;
      }
      case "topic": {
        const result=bus.topic(args[1],args[2]);
        if (!result.ok) trace.push("topic:"+result.error);
        else topics.set(args[0],result.topic);
        break;
      }
      case "topic_scoped": {
        const [alias,groupAlias,name,type]=args;
        const result=bus.topicInGroup(groups.get(groupAlias),name,type);
        if (!result.ok) trace.push("topic:"+result.error);
        else topics.set(alias,result.topic);
        break;
      }
      case "join": {
        const result=bus.join(groups.get(args[1]),actors.get(args[2]));
        ok("join",result);
        if (result.ok && result.membership) memberships.set(args[0],result.membership);
        break;
      }
      case "leave": ok("leave",bus.leave(memberships.get(args[0])));break;
      case "subscribe": {
        const [alias,topic,kind,target,capacity]=args;
        const value=kind==="actor"?actors.get(target):groups.get(target);
        const result=bus.subscribe(topics.get(topic),kind,value,capacity);
        ok("subscribe",result);
        if (result.ok) subs.set(alias,result.subscription);
        break;
      }
      case "publish":
      case "publish_mutable":
      case "publish_as": {
        const [alias,second,third]=args;
        const payloadId=op==="publish_as" ? third : second;
        const payload=op==="publish_mutable" ? {id:payloadId} : share({id:payloadId});
        const result=bus.tryPublish(topics.get(alias),payload,
          op==="publish_as" ? memberships.get(second) : null);
        trace.push(result.ok
          ? `publish:${result.receipt.sequence}:${result.receipt.recipients}`
          : "publish:"+result.error);
        break;
      }
      case "begin": {
        const result=bus.start(subs.get(args[0]),actors.get(args[1]));
        trace.push(result.ok
          ? `begin:${result.delivery.sequence}:${result.delivery.payload.id}`
          : "begin:"+result.error);
        break;
      }
      case "finish": ok("finish",bus.finish(subs.get(args[0]),actors.get(args[1])));break;
      case "unsubscribe": {
        const result=bus.unsubscribe(subs.get(args[0]));
        trace.push(result.ok ? "unsubscribe:"+result.done : "unsubscribe:"+result.error);
        break;
      }
      case "done": trace.push("done:"+bus.done(subs.get(args[0])));break;
      case "stop": ok("stop",bus.stopActor(actors.get(args[0])));break;
      case "close_group": ok("close_group",bus.closeGroup(groups.get(args[0])));break;
      case "close": ok("close",bus.close());break;
      default: throw new Error("unknown portable vector action: "+op);
    }
  }
  return trace;
}

test("portable v1 manifest has unique and complete five-backend vectors",()=>{
  assert.equal(manifest.schema,"oreslang.actor_pubsub.portable.v1");
  assert.equal(manifest.status,"PROPOSED_NOT_EXECUTED");
  assert.deepEqual(manifest.backends,["java","llvm","wasm","cranelift","net"]);
  assert.equal(manifest.cases.length,26);
  assert.deepEqual(manifest.cases.map(v=>v.id),
    Array.from({length:26},(_,i)=>"PS"+String(i+1).padStart(3,"0")));
  for (const c of manifest.cases) {
    assert.ok(c.name && c.actions.length && Array.isArray(c.expected));
    assert.deepEqual(runCase(c.actions),c.expected,c.id+": "+c.name);
  }
});

for (const c of manifest.cases) {
  test(`${c.id}: ${c.name}`,()=>{
    assert.deepEqual(runCase(c.actions),c.expected);
  });
}

test("shared payload must be deep-frozen across nested reachable values",()=>{
  const bus=new PubSubReference();
  const topic=bus.topic("test","Message").topic;
  assert.equal(bus.tryPublish(topic,Object.freeze({nested:{v:1}})).error,"NotShared");
  const value=share({nested:{v:1}});
  assert.equal(bus.tryPublish(topic,value).ok,true);
  assert.ok(Object.isFrozen(value.nested));
  assert.throws(()=>{value.nested.v=9},TypeError);
  assert.throws(()=>share((()=>{const x={};x.self=x;return x})()),/cyclic/);
});

test("cross-broker topic identity rejects even equal name/type handles",()=>{
  const left=new PubSubReference(),right=new PubSubReference();
  const topic=left.topic("events","Event").topic;
  right.topic("events","Event");
  assert.equal(right.tryPublish(topic,share({id:"x"})).error,"UnknownTopic");
  assert.equal(right.subscribe(topic,"actor",right.actor("a").actor).error,"UnknownTopic");
});

test("closed subscriptions reclaim active quota but remain fenced",()=>{
  const bus=new PubSubReference({maxSubscriptions:1});
  const actor=bus.actor("a").actor,topic=bus.topic("events","Event").topic;
  const first=bus.subscribe(topic,"actor",actor,1).subscription;
  const other=bus.actor("other").actor;
  assert.equal(bus.subscribe(topic,"actor",actor,1).subscription,first,
    "repeat subscribe reuses the same live edge");
  assert.equal(bus.subscribe(topic,"actor",other,1).error,"ResourceExhausted");
  bus.unsubscribe(first);
  assert.equal(bus.subscribe(topic,"actor",actor,1).ok,true);
  assert.equal(bus.start(first,actor).error,"Closed");
});

test("actor death with an in-flight callback keeps quiescence barrier pending",()=>{
  const bus=new PubSubReference();
  const actor=bus.actor("a").actor,topic=bus.topic("events","Event").topic;
  const sub=bus.subscribe(topic,"actor",actor,1).subscription;
  assert.equal(bus.tryPublish(topic,share({id:"x"})).ok,true);
  assert.equal(bus.start(sub,actor).ok,true);
  assert.equal(bus.stopActor(actor).ok,true);
  assert.equal(bus.done(sub),false);
  assert.equal(bus.finish(sub,actor).ok,true);
  assert.equal(bus.done(sub),true);
});

test("zero and negative broker quotas are rejected",()=>{
  assert.throws(()=>new PubSubReference({maxTopics:0}),RangeError);
  assert.throws(()=>new PubSubReference({maxSubscriptions:-1}),RangeError);
});

test("frozen exotic collections and getters are not Sendable immutable payloads",()=>{
  const bus=new PubSubReference();
  const topic=bus.topic("secure.events","Event").topic;
  const map=Object.freeze(new Map([["a",1]]));
  assert.equal(bus.tryPublish(topic,map).error,"NotShared");
  assert.throws(()=>share(new Set([1])),/non-Sendable/);
  const accessor=Object.freeze({get value(){return 7}});
  assert.equal(bus.tryPublish(topic,accessor).error,"NotShared");
  assert.throws(()=>share({get value(){return 7}}),/non-Sendable/);
});


test("acyclic shared aliases are immutable data, not false cycles",()=>{
  const bus=new PubSubReference();
  const topic=bus.topic("dag.events","Event").topic;
  const leaf={id:"same"};
  const packet=share({first:leaf,second:leaf,nested:[leaf]});
  assert.equal(packet.first,packet.second,"snapshot must preserve aliases");
  assert.equal(packet.first,packet.nested[0]);
  assert.ok(Object.isFrozen(leaf));
  assert.ok(Object.isFrozen(packet.nested));
  assert.equal(bus.isShared(packet),true);
  assert.equal(bus.tryPublish(topic,packet).ok,true);
});

test("already-frozen acyclic DAGs pass without invoking share",()=>{
  const bus=new PubSubReference();
  const topic=bus.topic("dag.events","Event").topic;
  const child=Object.freeze({id:"shared"});
  const packet=Object.freeze({a:child,b:child});
  assert.equal(bus.tryPublish(topic,packet).ok,true);
  const unfrozen={id:"mutable"};
  assert.equal(bus.tryPublish(topic,Object.freeze({a:unfrozen,b:unfrozen})).error,
    "NotShared");
});

test("share helper rejects nested functions and symbols before publication",()=>{
  const callback=()=>42;
  assert.throws(()=>share({nested:[{run:callback}]}),/non-Sendable/);
  assert.throws(()=>share([Symbol("capability")]),/non-Sendable/);
  const cycle={};cycle.self=cycle;
  assert.throws(()=>share(cycle),/cyclic/);
  Object.freeze(cycle);
  const bus=new PubSubReference();
  const topic=bus.topic("cycles.events","Event").topic;
  assert.equal(bus.tryPublish(topic,cycle).error,"NotShared");
});

test("duplicate join is idempotent and cannot mint an additional leave grant",()=>{
  const bus=new PubSubReference();
  const actor=bus.actor("a").actor,group=bus.group("g").group;
  const first=bus.join(group,actor);
  assert.equal(first.ok,true);
  assert.equal(bus.join(group,actor).ok,true);
  const again=bus.join(group,actor);
  assert.equal(again.alreadyMember,true);
  assert.equal(again.membership,undefined);
  assert.equal(group.members.size,1);
  assert.equal(bus.leave(first.membership).ok,true);
  assert.equal(bus.leave(first.membership).error,"StaleMembership");
  assert.equal(group.members.size,0);
  assert.equal(bus.join(group,actor).ok,true,"new grant only after explicit rejoin");
});

test("duplicate subscription preserves a single delivery and quota",()=>{
  const bus=new PubSubReference({maxSubscriptions:1});
  const a=bus.actor("a").actor,topic=bus.topic("events","E").topic;
  const first=bus.subscribe(topic,"actor",a,2);
  assert.equal(first.ok,true);
  const again=bus.subscribe(topic,"actor",a,2);
  assert.equal(again.subscription,first.subscription);
  assert.equal(again.alreadySubscribed,true);
  assert.equal(bus.subscriptionCount,1);
  assert.equal(bus.subscribe(topic,"actor",a,3).error,"SubscriptionConflict");
  assert.equal(bus.tryPublish(topic,share({id:"once"})).receipt.recipients,1);
  assert.equal(bus.start(first.subscription,a).delivery.payload.id,"once");
  assert.equal(bus.start(again.subscription,a).error,"Empty");
  assert.equal(bus.unsubscribe(first.subscription).ok,true);
  const renewed=bus.subscribe(topic,"actor",a,3);
  assert.equal(renewed.ok,true);
  assert.notEqual(renewed.subscription,first.subscription);
});

test("actor incarnation keys cannot alias through delimiters or type coercion",()=>{
  const bus=new PubSubReference();
  const first=bus.actor("tenant#1",2);
  const second=bus.actor("tenant",1);
  const third=bus.actor("tenant#1",1);
  assert.equal(first.ok,true);
  assert.equal(second.ok,true);
  assert.equal(third.ok,true);
  assert.notEqual(first.actor.key,second.actor.key);
  assert.notEqual(first.actor.key,third.actor.key);
  assert.equal(bus.actor("tenant#1",2).error,"AlreadyExists");
  assert.equal(bus.actor("tenant", "1").error,"InvalidActorIdentity");
  assert.equal(bus.actor("tenant",0).error,"InvalidActorIdentity");
  assert.equal(bus.actor("tenant",-1).error,"InvalidActorIdentity");
  assert.equal(bus.actor("tenant",Number.MAX_SAFE_INTEGER+1).error,
    "InvalidActorIdentity");
  assert.equal(bus.actor("",1).error,"InvalidActorIdentity");
  assert.equal(bus.actor({},1).error,"InvalidActorIdentity");
  assert.equal(bus.actor("x".repeat(257),1).error,"InvalidActorIdentity");
});

test("colliding-prefix actor incarnations cannot inherit group membership",()=>{
  const bus=new PubSubReference();
  const first=bus.actor("a#1",2).actor;
  const second=bus.actor("a",12).actor;
  const group=bus.group("room").group;
  const membership=bus.join(group,first);
  assert.equal(membership.ok,true);
  assert.equal(group.members.has(first.key),true);
  assert.equal(group.members.has(second.key),false);
  assert.equal(bus.stopActor(first).ok,true);
  assert.equal(group.members.has(first.key),false);
  assert.equal(bus.join(group,second).ok,true);
  assert.equal(bus.leave(membership.membership).error,"StaleMembership");
  assert.equal(group.members.has(second.key),true);
});


test("forged membership views do not authorize scoped publication",()=>{
  const bus=new PubSubReference();
  const group=bus.group("g").group;
  const actor=bus.actor("a").actor;
  const topic=bus.topicInGroup(group,"events","Event").topic;
  // The exposed Set is an observability view, not a grant registry.
  group.members.add(actor.key);
  assert.equal(bus.tryPublish(topic,share({id:"x"}),
    Object.freeze({id:1,group,actor})).error,"UnauthorizedPublisher");
  assert.equal(bus.subscribe(topic,"actor",actor,1).error,"UnauthorizedSubscriber");
  assert.equal(group.members.has(actor.key),false,
    "mutating an introspection snapshot cannot mutate membership");
  const grant=bus.join(group,actor).membership;
  assert.ok(grant);
  assert.equal(bus.tryPublish(topic,share({id:"allowed"}),grant).ok,true);
  assert.ok(Object.isFrozen(grant));
  assert.ok(Object.isFrozen(topic));
  assert.ok(Object.isFrozen(actor));
  assert.ok(Object.isFrozen(group));
  const subscription=bus.subscribe(topic,"actor",actor,1).subscription;
  assert.ok(Object.isFrozen(subscription));
  assert.throws(()=>{subscription.closed=false;},TypeError);
  assert.throws(()=>{grant.group=bus.group("other").group;},TypeError);
  assert.throws(()=>{actor.alive=false;},TypeError);
  assert.throws(()=>{group.closed=true;},TypeError);
});

test("cross-broker grants cannot authorize the same-named scoped topic",()=>{
  const source=new PubSubReference(),destination=new PubSubReference();
  const g1=source.group("g").group,g2=destination.group("g").group;
  const a1=source.actor("a").actor,a2=destination.actor("a").actor;
  const grant=source.join(g1,a1).membership;
  const topic=destination.topicInGroup(g2,"events","Event").topic;
  assert.equal(destination.tryPublish(topic,share({id:"x"}),grant).error,
    "UnauthorizedPublisher");
  const correct=destination.join(g2,a2).membership;
  assert.equal(destination.tryPublish(topic,share({id:"ok"}),correct).ok,true);
  assert.equal(source.tryPublish(topic,share({id:"no"}),grant).error,
    "UnknownTopic");
});

test("terminated actor grant cannot publish after next incarnation joins",()=>{
  const bus=new PubSubReference();
  const group=bus.group("g").group;
  const old=bus.actor("a",1).actor;
  const topic=bus.topicInGroup(group,"events","Event").topic;
  const stale=bus.join(group,old).membership;
  assert.equal(bus.stopActor(old).ok,true);
  assert.equal(bus.tryPublish(topic,share({id:"stale"}),stale).error,
    "UnauthorizedPublisher");
  const next=bus.actor("a",2).actor;
  const current=bus.join(group,next).membership;
  assert.equal(bus.tryPublish(topic,share({id:"new"}),current).ok,true);
  assert.equal(bus.tryPublish(topic,share({id:"stale2"}),stale).error,
    "UnauthorizedPublisher");
});


test("bounded live memberships reclaim quota and never revive old grants",()=>{
  const bus=new PubSubReference({maxMemberships:1});
  const actor=bus.actor("a").actor;
  const left=bus.group("left").group,right=bus.group("right").group;
  const topic=bus.topicInGroup(left,"events","Event").topic;
  const old=bus.join(left,actor).membership;
  assert.equal(bus.membershipCount,1);
  assert.equal(bus.join(left,actor).alreadyMember,true);
  assert.equal(bus.join(right,actor).error,"ResourceExhausted");
  assert.equal(bus.leave(old).ok,true);
  assert.equal(bus.membershipCount,0);
  assert.equal(bus.tryPublish(topic,share({id:"revoked"}),old).error,
    "UnauthorizedPublisher");
  const renewed=bus.join(left,actor).membership;
  assert.equal(bus.membershipCount,1);
  assert.notEqual(renewed,old);
  assert.equal(bus.tryPublish(topic,share({id:"valid"}),renewed).ok,true);
  assert.equal(bus.tryPublish(topic,share({id:"old"}),old).error,
    "UnauthorizedPublisher");
  assert.throws(()=>{bus.maxMemberships=100;},TypeError);
  assert.throws(()=>{bus.closed=false;},TypeError);
  assert.throws(()=>new PubSubReference({maxMemberships:0}),RangeError);
});

test("retired subscriptions release quota but retain exact quiescence state",()=>{
  const bus=new PubSubReference({maxSubscriptions:1});
  const actor=bus.actor("a").actor;
  const topic=bus.topic("events","Event").topic;
  const old=bus.subscribe(topic,"actor",actor,1).subscription;
  assert.equal(bus.tryPublish(topic,share({id:"work"})).ok,true);
  assert.equal(bus.start(old,actor).ok,true);
  assert.equal(bus.unsubscribe(old).done,false);
  assert.equal(bus.subscriptionCount,0);
  assert.equal(bus.start(old,actor).error,"Closed");
  const renewed=bus.subscribe(topic,"actor",actor,1).subscription;
  assert.notEqual(renewed,old);
  assert.equal(bus.subscriptionCount,1);
  assert.equal(bus.finish(old,actor).ok,true);
  assert.equal(bus.done(old),true);
  assert.equal(bus.unsubscribe(old).done,true);
  assert.equal(bus.subscriptionCount,1,
    "old handle cannot revoke or reclaim the new registration");
});

test("untrusted Proxy payloads are rejected before traps can reenter admission",()=>{
  const bus=new PubSubReference();
  const topic=bus.topic("proxy.events","Event").topic;
  let traps=0;
  const proxy=new Proxy(Object.freeze({id:42}),{
    getPrototypeOf(){traps++;throw new Error("unexpected getPrototypeOf trap");},
    ownKeys(){traps++;throw new Error("unexpected ownKeys trap");},
    getOwnPropertyDescriptor(){traps++;throw new Error("unexpected descriptor trap");},
    isExtensible(){traps++;throw new Error("unexpected isExtensible trap");}
  });
  assert.equal(bus.tryPublish(topic,proxy).error,"NotShared");
  assert.equal(bus.tryPublish(topic,Object.freeze({nested:proxy})).error,"NotShared");
  assert.throws(()=>share({nested:proxy}),/non-Sendable/);
  assert.equal(traps,0,"no user-controlled JS trap executes during admission");
  assert.deepEqual(bus.tryPublish(topic,share({id:1})).receipt,
    {sequence:"1",recipients:0},"rejected attempts do not consume sequence");
});

test("portable contract document preserves scoped topic rules without duplication",async()=>{
  const doc=await readFile(new URL("../docs/ACTOR_PUBSUB_PORTABLE_V1.md",import.meta.url),"utf8");
  assert.equal((doc.match(/^## Zero language keywords$/gm)??[]).length,1);
  assert.equal((doc.match(/^## Scope, names, ownership, and authority$/gm)??[]).length,1);
  assert.ok(doc.includes("match `^[A-Za-z][A-Za-z0-9._/-]{0,127}$`"),
    "documented topic-name rule must agree with model");
  assert.ok(!doc.includes("{0,127}# Actor/ActorGroup"),
    "contract headings must not be spliced into the name regex");
  assert.ok(doc.includes("legacy reference mode"),
    "unauthenticated legacy oracle must not be mistaken for the guest API");
});

test("opaque topic actor group and grant handles reject hostile getters and Proxies",()=>{
  const bus=new PubSubReference();
  const group=bus.group("g").group;
  const actor=bus.actor("a").actor;
  const topic=bus.topicInGroup(group,"events","Event").topic;
  const grant=bus.join(group,actor).membership;
  const subscription=bus.subscribe(topic,"actor",actor,1).subscription;
  let traps=0,getters=0;
  const forged=new Proxy({},{
    get(){traps++;throw new Error("untrusted handle get");},
    getOwnPropertyDescriptor(){traps++;throw new Error("untrusted handle descriptor");},
    getPrototypeOf(){traps++;throw new Error("untrusted handle prototype");},
    ownKeys(){traps++;throw new Error("untrusted handle keys");}
  });
  const accessor=Object.freeze({
    get id(){getters++;throw new Error("untrusted id getter");},
    get key(){getters++;throw new Error("untrusted key getter");},
    get alive(){getters++;throw new Error("untrusted alive getter");}
  });
  const payload=share({id:42});
  assert.equal(bus.tryPublish(topic,payload,forged).error,"UnauthorizedPublisher");
  assert.equal(bus.tryPublish(topic,payload,accessor).error,"UnauthorizedPublisher");
  assert.equal(bus.tryPublish(forged,payload,grant).error,"UnknownTopic");
  assert.equal(bus.subscribe(forged,"actor",actor,1).error,"UnknownTopic");
  assert.equal(bus.subscribe(topic,"actor",forged,1).error,"StaleTarget");
  assert.equal(bus.join(forged,actor).error,"StaleTarget");
  assert.equal(bus.join(group,forged).error,"StaleTarget");
  assert.equal(bus.leave(forged).error,"StaleMembership");
  assert.equal(bus.leave(accessor).error,"StaleMembership");
  assert.equal(bus.unsubscribe(forged).error,"StaleSubscription");
  assert.equal(bus.done(forged),false);
  assert.equal(bus.finish(forged,actor).error,"StaleTarget");
  assert.equal(bus.finish(subscription,forged).error,"StaleTarget");
  assert.equal(bus.stopActor(forged).error,"StaleActor");
  assert.equal(bus.closeGroup(forged).error,"StaleGroup");
  assert.equal(traps,0,"no untrusted Proxy handler runs in authority admission");
  assert.equal(getters,0,"no forged getter runs in authority admission");
  assert.deepEqual(bus.tryPublish(topic,payload,grant).receipt,
    {sequence:"1",recipients:1},
    "rejected attempts cannot consume a sequence or block a legitimate publisher");
});
