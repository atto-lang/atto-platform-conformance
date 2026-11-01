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
      case "join": {
        const result=bus.join(groups.get(args[1]),actors.get(args[2]));
        ok("join",result);
        if (result.ok) memberships.set(args[0],result.membership);
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
      case "publish_mutable": {
        const [alias,payloadId]=args;
        const payload=op==="publish" ? share({id:payloadId}) : {id:payloadId};
        const result=bus.tryPublish(topics.get(alias),payload);
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
  assert.deepEqual(manifest.backends,["java","llvm","wasm","forge","net"]);
  assert.equal(manifest.cases.length,20);
  assert.deepEqual(manifest.cases.map(v=>v.id),
    Array.from({length:20},(_,i)=>"PS"+String(i+1).padStart(3,"0")));
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
  assert.equal(bus.subscribe(topic,"actor",actor,1).error,"ResourceExhausted");
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
