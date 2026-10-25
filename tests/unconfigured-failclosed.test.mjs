import test from "node:test";
import assert from "node:assert/strict";
import {runSuite,COMPILER_BACKENDS} from "../src/harness.mjs";

test("discovery mode is informational; unconfigured never reports a passing suite",async()=>{
 for(const backend of COMPILER_BACKENDS){
  for(const requireConfigured of [false,true]){
   const r=await runSuite({backend,requireConfigured});
   assert.equal(r.configured,false,backend);
   assert.equal(r.ok,false,backend);
   assert.equal(r.verified,0,backend);
   assert.equal(r.failed,0,backend);
   assert.ok(r.skipped>0,backend);
   assert.ok(r.results.every(x=>x.status==="UNCONFIGURED"),backend);
  }
 }
});

test("absence of argv cannot be misreported as parity, even with forged source SHA",async()=>{
 const r=await runSuite({backend:"java",sourceSha:"0".repeat(40)});
 assert.equal(r.ok,false);
 assert.equal(r.configured,false);
 assert.equal(r.verified,0);
});
