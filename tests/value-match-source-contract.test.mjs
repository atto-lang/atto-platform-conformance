import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";

const root=new URL("../fixtures/value-match/v1/",import.meta.url);
const manifest=JSON.parse(await readFile(new URL("manifest.json",root),"utf8"));
const expected=new Map([
 ["value-option-braced.ores","accept"],
 ["value-vs-procedural.ores","accept"],
 ["value-guard-over-end.ores","accept"],
 ["reject-nonexhaustive.ores","reject"],
 ["reject-mismatched-types.ores","reject"],
 ["reject-no-value.ores","reject"]
]);
test("value match source inventory is closed and all backend claims pending",()=>{
 assert.equal(manifest.schemaVersion,1);
 assert.equal(manifest.scope,"value-match-expression-v1");
 assert.equal(manifest.cases.length,expected.size);
 const names=new Set();
 for(const entry of manifest.cases){
  assert.equal(names.has(entry.file),false,"duplicate file "+entry.file);
  names.add(entry.file);
  assert.equal(entry.id,entry.file.slice(0,-5));
  assert.equal(entry.expect,expected.get(entry.file));
  assert.match(entry.sourceGitBlobSha1,/^[a-f0-9]{40}$/);
  assert.deepEqual(entry.confirmedBackends,[]);
  assert.deepEqual(entry.pendingBackends,["java-graalvm","llvm","wasm","browser-worker"]);
 }
 assert.deepEqual([...names].sort(),[...expected.keys()].sort());
 assert.equal(manifest.evidence.exactFixtureExecution,false);
});
test("value match fixture Git blob integrity",async()=>{
 for(const entry of manifest.cases){
  const bytes=await readFile(new URL(entry.file,root));
  const sha=createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
  assert.equal(sha,entry.sourceGitBlobSha1,entry.file);
  const source=bytes.toString("utf8");
  assert.ok(source.includes("match "),"match missing "+entry.file);
  assert.ok(source.includes("return"),"explicit return missing "+entry.file);
 }
});
test("value-producing versus procedural source examples remain distinct",async()=>{
 const value=await readFile(new URL("value-option-braced.ores",root),"utf8");
 const both=await readFile(new URL("value-vs-procedural.ores",root),"utf8");
 assert.match(value,/return match value over/);
 assert.match(both,/val int x = match input over/);
 assert.match(both,/do match input over/);
 const missing=await readFile(new URL("reject-no-value.ores",root),"utf8");
 assert.match(missing,/on Some\(n\) \{ return; \}/);
});
