import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
const root=new URL("../fixtures/scalar-wasm/",import.meta.url);
const manifest=JSON.parse(await readFile(new URL("manifest.json",root),"utf8"));
const cases=[
 ["constant-main","0f1de3b2fbcabfa1f982270ce06e15ab3fffe436","42"],
 ["return-arithmetic","a9871bd51ada5cacd49c0271c450be848d96955e","28"],
 ["owned-identifier-main","51480d7daab9d423db60ecedecfff04506b68759","42"]
];
test("pinned real-source Wasm Worker evidence does not claim Java or native execution",()=>{
 assert.equal(manifest.schemaVersion,1);
 assert.equal(manifest.compilerSourceCommit,"c7d3b61d95b1c8ff78d6b2efbed44c9d92791b80");
 assert.match(manifest.executionEvidence,/^https:\/\/github\.com\/akrion-sim\/akrion-sim-e2e\/actions\/runs\/38168849813$/);
 assert.equal(manifest.sourceBlobVerificationCount,17);
 assert.equal(manifest.cases.length,3);
 assert.equal(manifest.environment,"Node22 Worker with browser module entry; not Chromium or Firefox");
 for(const c of manifest.cases){
  assert.deepEqual(c.verifiedTargets,["llvm-to-wasm32-node-worker"]);
  assert.deepEqual(c.pendingTargets,["llvm-native-execution","graal-jvm","chromium","firefox"]);
 }
});
test("each recorded program has exact SHA-1 Git source bytes executed by the LLVM-to-Wasm gate",async()=>{
 for(const [id,sha,expected] of cases){
  const c=manifest.cases.find(x=>x.id===id);
  assert.ok(c,id);
  assert.equal(c.file,id+".ores");
  assert.equal(c.sourceGitBlobSha1,sha);
  assert.equal(c.expectedI64,expected);
  const bytes=await readFile(new URL(c.file,root));
  const actual=createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
  assert.equal(actual,sha,id+" bytes drifted from executed source");
 }
});
