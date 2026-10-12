import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
const url=new URL("../fixtures/actor-reply/v1/",import.meta.url);
const manifest=JSON.parse(await readFile(new URL("manifest.json",url),"utf8"));
test("actor reply contract matrix is explicitly pending on every language backend",()=>{
 assert.equal(manifest.schemaVersion,1);
 assert.equal(manifest.scope,"actor-reply-control-source-proposal-v1");
 assert.equal(manifest.hostReference.kind,"javascript-only");
 assert.equal(manifest.hostReference.compilerAdmission,false);
 assert.equal(manifest.cases.length,5);
 for(const entry of manifest.cases){
  assert.match(entry.sourceGitBlobSha1,/^[a-f0-9]{40}$/);
  assert.match(entry.file,/^[a-z-]+\.ores$/);
  assert.deepEqual(entry.confirmedBackends,[]);
  assert.deepEqual(entry.pendingBackends,["java-graalvm","llvm","wasm","browser-worker"]);
  assert.ok(["accept","reject"].includes(entry.expect));
 }
});
test("all actor reply fixtures are byte-identical to versioned Git blobs",async()=>{
 for(const entry of manifest.cases){
  const bytes=await readFile(new URL(entry.file,url));
  const digest=createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
  assert.equal(digest,entry.sourceGitBlobSha1,entry.file);
 }
});
test("source proposal distinguishes actor reply effects from callable returns",async()=>{
 const load=async name=>readFile(new URL(name,url),"utf8");
 const actor=await load("explicit-respond.ores");
 assert.match(actor,/self\.respond\(Message\.Result\(/);
 assert.match(actor,/self\.done\(\)/);
 assert.doesNotMatch(actor,/return Message\.Result/);
 const val=await load("return-match-value.ores");
 assert.match(val,/return match m over/);
 assert.match(val,/return Message\.Result/);
 const proc=await load("do-match-value.ores");
 assert.match(proc,/do match m over/);
 assert.match(proc,/return Message\.Result/);
 const invalid=await load("invalid-implicit-void-return.ores");
 assert.match(invalid,/receive\(Message m\): void/);
 assert.match(invalid,/return match m over/);
});
