import {test} from "node:test";
import assert from "node:assert/strict";
import {PubSubReference, share} from "../models/actor-pubsub-portable-v1.mjs";

// SOURCE-ONLY reference tests: native guest backends have NOT executed these.
function chain(depth, frozen=false) {
  let node=frozen ? Object.freeze({value:"leaf"}) : {value:"leaf"};
  for (let i=0;i<depth;i++) {
    node=frozen ? Object.freeze({child:node}) : {child:node};
  }
  return node;
}

test("shared payload at the depth boundary is admitted without recursion overflow",()=>{
  const bus=new PubSubReference();
  const topic=bus.topic("payload.bounds","Payload").topic;
  const payload=share(chain(128));
  assert.equal(bus.isShared(payload),true);
  assert.deepEqual(bus.tryPublish(topic,payload).receipt,
    {sequence:"1",recipients:0});
});

test("excessively deep shared payloads reject before freezing or consuming a sequence",()=>{
  const bus=new PubSubReference();
  const topic=bus.topic("payload.depth","Payload").topic;
  const safe={value:"caller-owned"};
  const packet={safe,unsafe:chain(129)};
  assert.throws(()=>share(packet),/shared payload depth quota exceeded/);
  assert.equal(Object.isFrozen(safe),false);
  assert.equal(Object.isFrozen(packet),false);
  safe.value="still-writable";
  assert.equal(safe.value,"still-writable");
  const alreadyFrozen=chain(129,true);
  assert.equal(bus.isShared(alreadyFrozen),false);
  assert.equal(bus.tryPublish(topic,alreadyFrozen).error,"NotShared");
  assert.deepEqual(bus.tryPublish(topic,share({id:"accepted"})).receipt,
    {sequence:"1",recipients:0});
});

test("oversized shared object graphs are rejected before any caller-owned freeze",()=>{
  const bus=new PubSubReference();
  const topic=bus.topic("payload.nodes","Payload").topic;
  const children=Array.from({length:4096},(_,i)=>({id:i}));
  const payload=Object.fromEntries(children.map((child,i)=>["n"+i,child]));
  assert.throws(()=>share(payload),/shared payload graph quota exceeded/);
  assert.equal(Object.isFrozen(payload),false);
  assert.equal(Object.isFrozen(children[0]),false);
  assert.equal(Object.isFrozen(children.at(-1)),false);
  for (const child of children) Object.freeze(child);
  Object.freeze(payload);
  assert.equal(bus.isShared(payload),false);
  assert.equal(bus.tryPublish(topic,payload).error,"NotShared");
  assert.deepEqual(bus.tryPublish(topic,share({ok:true})).receipt,
    {sequence:"1",recipients:0});
});

test("wide shallow payload exceeds edge budget even with few object nodes",()=>{
  const bus=new PubSubReference();
  const topic=bus.topic("payload.edges","Payload").topic;
  const payload=Object.fromEntries(
    Array.from({length:16385},(_,i)=>["field"+i,i]));
  assert.throws(()=>share(payload),/shared payload graph quota exceeded/);
  assert.equal(Object.isFrozen(payload),false);
  Object.freeze(payload);
  assert.equal(bus.isShared(payload),false);
  assert.equal(bus.tryPublish(topic,payload).error,"NotShared");
});

test("bounded DAG aliases retain identity, are not mistaken for cycles, and publish",()=>{
  const bus=new PubSubReference();
  const topic=bus.topic("payload.alias","Payload").topic;
  const sharedLeaf={id:"alias"};
  const payload=share({left:sharedLeaf,right:sharedLeaf,array:[sharedLeaf]});
  assert.equal(payload.left,payload.right);
  assert.equal(payload.left,payload.array[0]);
  assert.equal(bus.isShared(payload),true);
  assert.deepEqual(bus.tryPublish(topic,payload).receipt,
    {sequence:"1",recipients:0});
  assert.throws(()=>{sharedLeaf.id="mutable";},TypeError);
});
