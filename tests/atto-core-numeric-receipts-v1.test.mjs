import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {verifyAttoNumericArtifactBundleV1,qualifyAttoNumericRunV1} from "../lib/atto-core-numeric-receipts-v1.mjs";
const sha=b=>createHash("sha256").update(b).digest("hex");
const blob=b=>createHash("sha1").update(Buffer.from("blob "+b.length+"\0")).update(b).digest("hex");
const graph=(path,entry,num)=>sha(Buffer.from(path+"\0"+sha(entry)+"\n@atto.core/numeric.atto\0"+sha(num)+"\n"));
function specimen(){
 const numeric=Buffer.from("define module numeric as pub fnc clamp_int(int x,int l,int u):int{return x;} end\n");
 const base=Buffer.from("import module numeric from \"atto.core/numeric\"; pub fnc main():int{return numeric.clamp_int(50,0,42);}");
 const mutated=Buffer.from("import module numeric from \"atto.core/numeric\"; pub fnc main():int{return numeric.clamp_int(50,0,43);}");
 const compiler=Buffer.from("synthetic-data-not-the-real-compiler");
 const expected={head:"a".repeat(40),tree:"b".repeat(40),rid:"linux-x64",
  runId:423999999,runAttempt:2,sourceBlobs:{numeric:blob(numeric),base:blob(base),mutated:blob(mutated)}};
 const artifacts={numeric,compiler,
  base:{entry:base,cil:Buffer.from("fake-CIL-42"),native:Buffer.from("fake-AOT-42")},
  mutated:{entry:mutated,cil:Buffer.from("fake-CIL-43"),native:Buffer.from("fake-AOT-43")}};
 const receipts={};
 for(const label of ["base","mutated"]){
  const a=artifacts[label];
  receipts[label]={scope:"atto.core/numeric-stage2-not-five-backend-parity",label,
   run_id:expected.runId,run_attempt:expected.runAttempt,
   workflow_path:".github/workflows/source-modules-native-aot.yml",
   workflow_job:"native-source-modules",runner_os:"ubuntu-24.04",
   source_head:expected.head,source_tree:expected.tree,
   canonical_library_git_blob:expected.sourceBlobs.numeric,
   entry_git_blob:expected.sourceBlobs[label],rid:expected.rid,
   compiler_binary_sha256:sha(compiler),
   graph_sha256:graph("0/atto-core-numeric-"+(label==="base"?"main":"mutated")+".atto",a.entry,numeric),
   cil_sha256:sha(a.cil),native_binary_sha256:sha(a.native),result:label==="base"?"42":"43"};
 }
 const run={id:expected.runId,head_sha:expected.head,run_attempt:expected.runAttempt,
  path:".github/workflows/source-modules-native-aot.yml",status:"completed",conclusion:"success"};
 const jobs=[{id:9,run_id:run.id,run_attempt:run.run_attempt,head_sha:expected.head,
  name:"native-source-modules (ubuntu-24.04, linux-x64)",status:"completed",
  conclusion:"success",runner_id:123,steps:[
   {name:"Existing compiler and module-linking regressions",number:1,status:"completed",conclusion:"success"},
   {name:"Build and execute canonical numeric.atto NativeAOT 42-to-43 mutation",number:2,status:"completed",conclusion:"success"}
  ]}];
 return {expected,receipts,artifacts,run,jobs};
}
test("synthetic bundle verifies only source and artifact bytes, never execution",()=>{
 assert.equal(verifyAttoNumericArtifactBundleV1(specimen()).classification,
  "ARTIFACT_BYTES_VERIFIED_EXECUTION_UNPROVEN");
});
test("synthetic green steps cannot self-certify independent review or parity",()=>{
 assert.equal(qualifyAttoNumericRunV1(specimen()).classification,
  "RECEIPTS_VERIFIED_PENDING_INDEPENDENT_REVIEW");
});
test("deterministic 396 hostile receipt and artifact substitutions are refused",()=>{
 const mutations=[
  v=>v.receipts.base.run_id++,v=>v.receipts.mutated.run_attempt++,
  v=>v.receipts.base.source_head="0".repeat(40),
  v=>v.receipts.mutated.source_tree="0".repeat(40),
  v=>v.receipts.base.workflow_path="fake.yml",
  v=>v.receipts.mutated.workflow_job="fake-job",
  v=>v.receipts.base.runner_os="windows-2022",
  v=>v.receipts.mutated.rid="win-x64",
  v=>v.receipts.base.canonical_library_git_blob="0".repeat(40),
  v=>v.receipts.mutated.entry_git_blob="0".repeat(40),
  v=>v.receipts.base.compiler_binary_sha256="0".repeat(64),
  v=>v.receipts.mutated.graph_sha256="0".repeat(64),
  v=>v.receipts.base.cil_sha256="0".repeat(64),
  v=>v.receipts.mutated.native_binary_sha256="0".repeat(64),
  v=>v.receipts.base.result="43",v=>v.receipts.mutated.result="42",
  v=>v.receipts.base.scope="unverified-guest",
  v=>v.receipts.mutated.label="base",
  v=>v.artifacts.compiler[0]^=1,v=>v.artifacts.numeric[0]^=1,
  v=>v.artifacts.base.entry[0]^=1,v=>v.artifacts.mutated.entry[0]^=1,
  v=>v.artifacts.base.cil[0]^=1,v=>v.artifacts.mutated.cil[0]^=1,
  v=>v.artifacts.base.native[0]^=1,v=>v.artifacts.mutated.native[0]^=1,
  v=>v.expected.sourceBlobs.numeric="0".repeat(40),
  v=>v.expected.sourceBlobs.base="0".repeat(40),
  v=>v.expected.sourceBlobs.mutated="0".repeat(40),
  v=>v.expected.head="0".repeat(40),v=>v.expected.tree="0".repeat(40),
  v=>v.expected.runId++,v=>v.expected.runAttempt++,
  v=>v.expected.rid="wasm32"
 ];
 let checked=0;
 for(let repetition=0;repetition<12;repetition++)
  for(const change of mutations){
   const v=specimen();change(v);
   assert.throws(()=>verifyAttoNumericArtifactBundleV1(v));
   checked++;
  }
 assert.equal(checked,396);
});
test("graph, CIL and native differences must each have a distinct mutation digest",()=>{
 for(const field of ["graph_sha256","cil_sha256","native_binary_sha256"]){
  const v=specimen();v.receipts.mutated[field]=v.receipts.base[field];
  assert.throws(()=>verifyAttoNumericArtifactBundleV1(v));
 }
});
test("zero-step, runnerless, skipped or mismatched GitHub job never qualifies",()=>{
 const changes=[
  v=>{v.run.conclusion="failure";v.jobs[0].conclusion="failure";v.jobs[0].runner_id=0;v.jobs[0].steps=[];},
  v=>v.jobs[0].runner_id=0,
  v=>v.jobs[0].steps[1].conclusion="skipped",
  v=>v.jobs[0].head_sha="0".repeat(40),
  v=>v.jobs[0].run_attempt++,
  v=>v.run.run_attempt++,
  v=>v.jobs[0].name="fake-job",
  v=>v.run.path=".github/workflows/fake.yml",
  v=>v.jobs[0].steps[1].name="host-only simulation",
  v=>v.jobs[0].steps[0].number=5,
  v=>v.jobs[0].steps[1].status="queued"
 ];
 for(const change of changes){
  const v=specimen();change(v);
  try {
   const result=qualifyAttoNumericRunV1(v);
   assert.notEqual(result.classification,"RECEIPTS_VERIFIED_PENDING_INDEPENDENT_REVIEW");
  } catch(error) {assert.ok(error instanceof Error);}
 }
});
