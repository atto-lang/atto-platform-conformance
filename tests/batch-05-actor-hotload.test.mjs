import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const manifest=JSON.parse(readFileSync(
  new URL("../audits/batch-05-actor-hotload.json",import.meta.url),"utf8"));
const expected=[
 [41,"oreslang-source.java",478,"HOTLOAD_CAPABILITY_MONOTONICITY"],
 [42,"oreslang-source.llvm",606,"NATIVE_GUEST_HOTUPGRADE_LEASES"],
 [43,"oreslang-source.llvm",610,"NATIVE_UNLOAD_FAILURE_QUARANTINE"],
 [44,"oreslang-source.llvm",603,"NATIVE_SHARED_CODE_IMAGES"],
 [45,"oreslang-source.java",1341,"LINEAR_HOTUPGRADE_TRANSFER"],
 [46,"oreslang-source.java",1342,"OUTPUT_READER_REGISTRATION"],
 [47,"oreslang-source.java",1343,"ACTOR_ROUTE_EPOCH_IDENTITY"],
 [48,"oreslang-source.java",476,"OTP_SUPERVISOR_LIFECYCLE"],
 [49,"oreslang-source.java",494,"HOTLOAD_CONTRACT_ABI_PINNING"],
 [50,"oreslang-source.java",963,"EXECUTED_JAVA_CI_PROOF"]
];
test("Batch 5 workstream has exactly ten verified source issue URLs",()=>{
  assert.equal(manifest.schema,1);
  assert.equal(manifest.batch,5);
  assert.equal(manifest.items.length,10);
  assert.equal(new Set(manifest.items.map(x=>x.url)).size,10);
  for(const [index,[task,repo,num,gate]] of expected.entries()){
    const x=manifest.items[index];
    assert.equal(x.task,task);
    assert.equal(x.repository,"ores-truffle-oreslang/"+repo);
    assert.equal(x.issue,num);
    assert.equal(x.gate,gate);
    assert.equal(x.url,"https://github.com/"+x.repository+"/issues/"+num);
    assert.equal(x.release,"BLOCKED_ON_ACTUAL_GUEST_EXECUTION");
  }
});
test("reconstructed ranking must not be presented as canonical history",()=>{
  assert.equal(manifest.mappingConfidence,
    "RECONSTRUCTED_WORKING_SET_NOT_VERIFIED_CANONICAL_100_TASK_ORDER");
  assert.match(manifest.note,/not presented as the original backlog/);
});
test("zero-step CI never certifies compiler/runtime feature",()=>{
  for(const key of ["nativeCompiler","javaCompiler"])
    assert.equal(manifest.evidence[key],"NOT_ATTESTED");
  assert.equal(manifest.evidence.freshCi,"ZERO_STEP_RUNS_NOT_EXECUTION");
  assert.equal(manifest.evidence.sourceExport,
    "REQUIRES_APPROVED_REVIEWED_PRIVATE_BOUNDARY");
});
