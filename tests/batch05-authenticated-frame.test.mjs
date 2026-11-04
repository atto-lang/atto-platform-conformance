import test from "node:test";
import assert from "node:assert/strict";
import {AuthenticatedFrameOracle,PhysicalBindingOracle,BlockingHostOperationOracle} from "../src/batch05-authenticated-frame-oracle.mjs";

test("receipt pre-authentication length cap is small and fail closed",()=>{
  assert.equal(AuthenticatedFrameOracle.boundedWireLength("RECEIPT",600),true);
  assert.equal(AuthenticatedFrameOracle.boundedWireLength("RECEIPT",4096),false);
  assert.equal(AuthenticatedFrameOracle.boundedWireLength("UNKNOWN",64),false);
});
test("data cap admits bounded payload envelope only",()=>{
  assert.equal(AuthenticatedFrameOracle.boundedWireLength("DATA",8*1024*1024+1024),true);
  assert.equal(AuthenticatedFrameOracle.boundedWireLength("DATA",8*1024*1024+1025),false);
});
test("exact authenticated DATA replay is rejected",()=>{
  const g=new AuthenticatedFrameOracle("e",7);
  g.acceptData({epoch:"e",generation:7,messageSequence:1,frameSequence:1});
  assert.throws(()=>g.acceptData({epoch:"e",generation:7,messageSequence:1,frameSequence:1}),/replay/);
});
test("frame rollback is rejected even if message sequence advances",()=>{
  const g=new AuthenticatedFrameOracle("e",7);
  g.acceptData({epoch:"e",generation:7,messageSequence:1,frameSequence:2});
  assert.throws(()=>g.acceptData({epoch:"e",generation:7,messageSequence:2,frameSequence:2}),/replay/);
});
test("message rollback is rejected even if frame sequence advances",()=>{
  const g=new AuthenticatedFrameOracle("e",7);
  g.acceptData({epoch:"e",generation:7,messageSequence:2,frameSequence:1});
  assert.throws(()=>g.acceptData({epoch:"e",generation:7,messageSequence:2,frameSequence:2}),/replay/);
});
test("old physical generation and wrong epoch are rejected before sequence advance",()=>{
  const g=new AuthenticatedFrameOracle("current",9);
  assert.throws(()=>g.acceptData({epoch:"current",generation:8,messageSequence:1,frameSequence:1}),/epoch/);
  assert.throws(()=>g.acceptData({epoch:"old",generation:9,messageSequence:1,frameSequence:1}),/epoch/);
  assert.deepEqual(g.state(),{lastMessage:0,lastFrame:0});
});
test("bad MAC cannot consume replay window",()=>{
  const g=new AuthenticatedFrameOracle("e",4);
  assert.throws(()=>g.acceptData({epoch:"e",generation:4,messageSequence:1,frameSequence:1,macValid:false}),/authentication/);
  g.acceptData({epoch:"e",generation:4,messageSequence:1,frameSequence:1});
  assert.deepEqual(g.state(),{lastMessage:1,lastFrame:1});
});
test("100000 monotonic authenticated frames preserve constant-memory replay state",()=>{
  const g=new AuthenticatedFrameOracle("e",5);
  for(let i=1;i<=100000;i++){
    g.acceptData({epoch:"e",generation:5,messageSequence:i,frameSequence:i});
    assert.equal(g.invariant(),true);
  }
  assert.deepEqual(g.state(),{lastMessage:100000,lastFrame:100000});
});


test("physical binding is irreversible and disables legacy authority",()=>{
  const b=new PhysicalBindingOracle(),owner={};
  b.claim(owner,"epoch-A",71);
  assert.equal(b.require(owner,"epoch-A",71),true);
  assert.equal(b.legacyAllowed(),false);
  assert.throws(()=>b.claim({},"epoch-A",72),/rebind/);
});
test("foreign owner, generation and epoch are denied",()=>{
  const b=new PhysicalBindingOracle(),owner={};
  b.claim(owner,"epoch-A",71);
  assert.throws(()=>b.require({},"epoch-A",71),/foreign/);
  assert.throws(()=>b.require(owner,"epoch-A",72),/foreign/);
  assert.throws(()=>b.require(owner,"epoch-B",71),/foreign/);
});


test("physical bridge binding is one-shot and disables legacy mutation",()=>{
  const g=new PhysicalBindingOracle(),owner={id:"a"},epoch="e";
  assert.equal(g.legacyAllowed(),true);
  g.claim(owner,epoch,11);
  assert.equal(g.legacyAllowed(),false);
  assert.equal(g.mutate(owner,epoch,11),true);
  assert.throws(()=>g.claim(owner,epoch,11),/rebind/);
  assert.throws(()=>g.claim({id:"b"},epoch,12),/rebind/);
  assert.deepEqual(g.state(),{bound:true,generation:11,retired:false});
});

test("foreign owner generation and epoch cannot mutate or retire bound bridge",()=>{
  const g=new PhysicalBindingOracle(),owner={},foreign={};
  g.claim(owner,"current",21);
  assert.throws(()=>g.mutate(foreign,"current",21),/foreign/);
  assert.throws(()=>g.mutate(owner,"current",22),/foreign/);
  assert.throws(()=>g.mutate(owner,"old",21),/foreign/);
  assert.throws(()=>g.retire(foreign,"current",21),/foreign/);
  assert.deepEqual(g.state(),{bound:true,generation:21,retired:false});
});

test("retirement never permits bridge rebind or post-retirement mutation",()=>{
  const g=new PhysicalBindingOracle(),owner={};
  g.claim(owner,"e",31);
  g.retire(owner,"e",31);
  assert.deepEqual(g.state(),{bound:true,generation:31,retired:true});
  assert.throws(()=>g.mutate(owner,"e",31),/retired/);
  assert.throws(()=>g.claim({}, "e",32),/rebind/);
});

test("100000 reconnects require 100000 fresh bridge instances",()=>{
  let previous=null;
  for(let generation=1;generation<=100000;generation++){
    const g=new PhysicalBindingOracle(),owner={generation};
    g.claim(owner,"e",generation);
    g.mutate(owner,"e",generation);
    g.retire(owner,"e",generation);
    if(previous)
      assert.throws(()=>previous.claim(owner,"e",generation),/rebind/);
    assert.equal(g.state().retired,true);
    previous=g;
  }
});


test("actor-carrier blocking guard fires before any host IPC side effect",()=>{
  const g=new BlockingHostOperationOracle();
  g.enterActorCarrier();
  assert.throws(()=>g.send(),/cannot block/);
  assert.throws(()=>g.readReceipt(),/cannot block/);
  assert.throws(()=>g.closeAndWait(),/cannot block/);
  assert.deepEqual(g.state(),{
    actorCarrier:true,sendAdmissions:0,receiptReads:0,closeMutations:0
  });
  g.exitActorCarrier();
  assert.equal(g.send(),true);
  assert.equal(g.readReceipt(),true);
  assert.equal(g.closeAndWait(),true);
  assert.deepEqual(g.state(),{
    actorCarrier:false,sendAdmissions:1,receiptReads:1,closeMutations:1
  });
});

test("100000 actor-carrier denials never consume admission/read/close state",()=>{
  const g=new BlockingHostOperationOracle();
  g.enterActorCarrier();
  for(let i=0;i<100000;i++){
    assert.throws(()=>g.send(),/cannot block/);
    assert.throws(()=>g.readReceipt(),/cannot block/);
    assert.throws(()=>g.closeAndWait(),/cannot block/);
  }
  assert.deepEqual(g.state(),{
    actorCarrier:true,sendAdmissions:0,receiptReads:0,closeMutations:0
  });
});
