import test from "node:test";
import assert from "node:assert/strict";
import {FfiQuiescenceReference,ChannelBoundaryReference,channelPayloadIsDataOnly,
  checkLinkedSignatures} from "../src/batch-03-ffi-channel-reference.mjs";

const scalar={kind:"scalar",name:"int"};
const ffi=()=>new FfiQuiescenceReference();

test("cancel and timeout do not release a physical FFI lease",()=>{
  const m=ffi(),ticket=m.start({actor:"actor",generation:1,library:"lib",executor:"thread"});
  m.cancel(ticket);m.timeout(ticket);m.stop();
  assert.equal(m.canUnload(),false);
  assert.equal(m.canReclaimActor("actor",1),false);
  assert.throws(()=>m.dispose(ticket));
  m.physicallyReturned(ticket,{executor:"thread"});
  assert.equal(m.dispose(ticket).publishResult,false);
  assert.equal(m.canUnload(),true);
});

test("FFI callbacks rejected; returning wrong executor cannot release pinned call",()=>{
  const m=ffi(),ticket=m.start({actor:"a",generation:1,library:"lib",
    executor:"fixed",threadAffine:true});
  assert.throws(()=>m.nativeCallback(ticket));
  assert.throws(()=>m.physicallyReturned(ticket,{executor:"other"}));
  assert.equal(m.canUnload(),false);
  m.physicallyReturned(ticket,{executor:"fixed"});
  assert.equal(m.dispose(ticket).retiredAfterPhysicalReturn,true);
});

test("FFI double-return and double-dispose are rejected",()=>{
  const m=ffi(),t=m.start({actor:"a",generation:1,library:"lib",executor:"e"});
  m.physicallyReturned(t,{executor:"e"});
  assert.throws(()=>m.physicallyReturned(t,{executor:"e"}));
  m.dispose(t);
  assert.throws(()=>m.dispose(t));
});

test("stopping prevents new FFI downcalls but not physical completion",()=>{
  const m=ffi(),t=m.start({actor:"a",generation:1,library:"lib",executor:"e"});
  m.stop();
  assert.throws(()=>m.start({actor:"b",generation:2,library:"lib",executor:"e"}));
  m.physicallyReturned(t,{executor:"e"});
  m.dispose(t);assert.equal(m.inspect().quiescent,true);
});

test("FFI capacity bounds concurrent native calls",()=>{
  const m=new FfiQuiescenceReference(1);
  const p={actor:"a",generation:1,library:"lib",executor:"e"};
  const t=m.start(p);
  assert.throws(()=>m.start(p));
  m.physicallyReturned(t,{executor:"e"});m.dispose(t);
  assert.ok(m.start(p));
});

test("Channel<Option<int>> is data-only, nested Channel or callbacks are not",()=>{
  assert.equal(channelPayloadIsDataOnly({kind:"option",value:scalar}),true);
  assert.equal(channelPayloadIsDataOnly({kind:"tuple",elements:[scalar,scalar]}),true);
  assert.equal(channelPayloadIsDataOnly({kind:"callback",value:scalar}),false);
  assert.equal(channelPayloadIsDataOnly({kind:"channel",value:scalar}),false);
  assert.equal(channelPayloadIsDataOnly({kind:"cell",value:scalar}),false);
});

test("Channel ownership moves into Task only and original owner loses access",()=>{
  const m=new ChannelBoundaryReference(),h=m.mint("caller",{kind:"option",value:scalar});
  m.transfer(h,{from:"caller",to:"taskA",boundary:"task",owned:true});
  assert.throws(()=>m.operation(h,"caller"));
  assert.equal(m.operation(h,"taskA").nonConsumingOperation,true);
  assert.equal(m.operation(h,"taskA").nonConsumingOperation,true);
  m.close(h,"taskA");assert.throws(()=>m.operation(h,"taskA"));
});

test("actor or unowned async channel handoff cannot manufacture permissions",()=>{
  const m=new ChannelBoundaryReference(),h=m.mint("caller",scalar);
  assert.throws(()=>m.transfer(h,{from:"caller",to:"a",boundary:"actor",owned:true}));
  assert.throws(()=>m.transfer(h,{from:"caller",to:"b",boundary:"task",owned:false}));
  assert.throws(()=>m.operation({channel:1},"caller"));
});

test("imported signatures must resolve and match exact callable symbol",()=>{
  const exports={math:{compute:"Future_int",limit:"int"}};
  assert.equal(checkLinkedSignatures({exports,imports:[
    {module:"math",symbol:"compute",signature:"Future_int"}]}).actualLinkedGuestExecution,false);
  assert.throws(()=>checkLinkedSignatures({exports,imports:[
    {module:"math",symbol:"compute",signature:"Unknown"}]}));
  assert.throws(()=>checkLinkedSignatures({exports,imports:[
    {module:"math",symbol:"compute",signature:"int"}]}));
  assert.throws(()=>checkLinkedSignatures({exports,imports:[
    {module:"math",symbol:"missing",signature:"Future_int"}]}));
});
