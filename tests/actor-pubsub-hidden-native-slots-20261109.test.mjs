import test from "node:test";
import assert from "node:assert/strict";
import {PubSubReference,share} from "../models/actor-pubsub-portable-v1.mjs";

// Source-free Node oracle tests only. Native/runtime guest Sendable gates must
// independently reject internal-slot state and user-defined private fields.
function masked(value) {
  Object.setPrototypeOf(value,Object.prototype);
  return value;
}

test("share rejects prototype-masked mutable builtins before partial freeze",()=>{
  const ordinary={id:"still mutable"};
  for (const [name,make] of [
    ["Map",()=>new Map([["x",1]])],
    ["Set",()=>new Set(["x"])],
    ["Date",()=>new Date(0)],
    ["ArrayBuffer",()=>new ArrayBuffer(4)],
    ["DataView",()=>new DataView(new ArrayBuffer(4))],
    ["Promise",()=>Promise.resolve(42)],
    ["WeakMap",()=>new WeakMap()],
    ["RegExp",()=>/hello/g],
    ["Error",()=>new Error("private state")],
    ["boxed Number",()=>new Number(42)]
  ]) {
    const exotic=masked(make());
    const payload={ordinary,exotic};
    assert.equal(Object.getPrototypeOf(exotic),Object.prototype,name);
    assert.throws(()=>share(payload),/non-Sendable/,name);
    assert.equal(Object.isFrozen(payload),false,name);
    assert.equal(Object.isFrozen(ordinary),false,name);
    assert.equal(Object.isFrozen(exotic),false,name);
  }
  ordinary.id="changed";
  assert.equal(ordinary.id,"changed");
});

test("frozen masked internal-slot objects are not acceptable shared payloads",()=>{
  const bus=new PubSubReference();
  const topic=bus.topic("hidden.slots","Event").topic;
  for (const [name,make] of [
    ["Map",()=>new Map()],
    ["Set",()=>new Set()],
    ["Date",()=>new Date(0)],
    ["ArrayBuffer",()=>new ArrayBuffer(4)],
    ["DataView",()=>new DataView(new ArrayBuffer(4))],
    ["Promise",()=>Promise.resolve(42)],
    ["RegExp",()=>/hello/],
    ["boxed Number",()=>new Number(42)]
  ]) {
    const exotic=masked(make());
    Object.freeze(exotic);
    assert.equal(Object.isFrozen(exotic),true,name);
    assert.equal(bus.isShared(exotic),false,name);
    assert.equal(bus.tryPublish(topic,exotic).error,"NotShared",name);
  }
  const frozenMap=masked(new Map());
  Object.freeze(frozenMap);
  Map.prototype.set.call(frozenMap,"after-freeze",42);
  assert.equal(Map.prototype.get.call(frozenMap,"after-freeze"),42,
    "the hidden state stays mutable despite freeze and plain prototype");
});

test("rejected hidden-state payload does not consume sequence or recipient credit",()=>{
  const bus=new PubSubReference();
  const actor=bus.actor("subscriber").actor;
  const topic=bus.topic("hidden.sequence","Event").topic;
  const sub=bus.subscribe(topic,"actor",actor,1).subscription;
  const smuggled=masked(new Date(0));
  Object.freeze(smuggled);
  assert.equal(bus.tryPublish(topic,smuggled).error,"NotShared");
  const good=bus.tryPublish(topic,share({value:7}));
  assert.equal(good.ok,true);
  assert.equal(good.receipt.sequence,"1");
  assert.equal(good.receipt.recipients,1);
  const started=bus.start(sub,actor);
  assert.equal(started.ok,true);
  assert.equal(started.delivery.payload.value,7);
  assert.equal(bus.start(sub,actor).error,"Empty");
  assert.equal(bus.finish(sub,actor).ok,true);
});
