import test from "node:test";
import assert from "node:assert/strict";
import {AuthenticatedFrameOracle,PhysicalBindingOracle} from "../src/batch05-authenticated-frame-oracle.mjs";

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
