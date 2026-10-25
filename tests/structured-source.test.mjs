import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {join} from "node:path";
const dir=fileURLToPath(new URL("../fixtures/structured/",import.meta.url));
const manifest=JSON.parse(await readFile(join(dir,"manifest.json"),"utf8"));
test("explicit verified/pending backend matrix",()=>{
 assert.equal(manifest.schemaVersion,1);
 assert.equal(manifest.scope,"bounded-class-i64-wasm32-v1");
 assert.equal(manifest.cases.length,4);
 assert.match(manifest.graalEvidence,/actions\/runs\/[0-9]+/);
 const ids=new Set();
 for(const c of manifest.cases){
  assert.match(c.id,/^[a-z0-9-]+$/);
  assert.equal(ids.has(c.id),false);ids.add(c.id);
  assert.match(c.file,/^[a-z-]+\.ores$/);
  assert.match(c.sourceGitBlobSha1,/^[a-f0-9]{40}$/);
  const graalIsVerified=c.id==="class-shared-borrow"||
   c.id==="class-overlapping-loans";
  if(c.id==="class-explicit-mutable-borrow") {
   // Exact source bytes were compiled by real pinned LLVM C++ compiler
   // components and executed as wasm32 in an isolated Worker. Graal remains
   // pending and no entire latest LLVM repository tree rebuild is claimed.
   assert.deepEqual(c.confirmedBackends,["llvm","wasm"]);
   assert.deepEqual(c.pendingBackends,["graal"]);
   assert.equal(c.sourceGitBlobSha1,"a7c28cc10c8ed4a4164984fe1d8f875e616e2eda");
   assert.equal(manifest.explicitMutableCompilerCoreSha,
    "bb33404d2f9878e0581bc5df29eb949ab5c22095");
   assert.match(manifest.explicitMutableEvidence,
    /^https:\/\/github\.com\/akrion-sim\/akrion-sim-e2e\/actions\/runs\/38169346910$/);
   assert.match(manifest.explicitMutableCompilerScope,/not a mirror of the entire current LLVM repository tree/);
  }else{
   assert.deepEqual(c.confirmedBackends,
    graalIsVerified?["llvm","wasm","graal"]:["llvm","wasm"]);
   assert.deepEqual(c.pendingBackends,graalIsVerified?[]:["graal"]);
  }
  // A native-only interpretation of an unmarked mutable owner is NOT
  // a Java semantic parity success. Do not auto-promote this fixture.
  if(c.id==="class-mutable-borrow")
   assert.equal(c.expectedI64,"42");
  if(c.expect==="accept")assert.equal(c.expectedI64,"42");
  else assert.equal(c.diagnosticClass,"exclusive-loan-conflict");
 }
});
test("structured fixtures retain exact upstream Git blob bytes",async()=>{
 for(const c of manifest.cases){
  const bytes=await readFile(join(dir,c.file));
  const actual=createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
  assert.equal(actual,c.sourceGitBlobSha1,c.file+" drifted");
 }
});
