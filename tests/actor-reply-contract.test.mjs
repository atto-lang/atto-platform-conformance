import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
const url=new URL("../fixtures/actor-reply/v1/",import.meta.url);
const manifest=JSON.parse(await readFile(new URL("manifest.json",url),"utf8"));
const canonicalCases=new Map([
 ["actor-explicit-respond",["explicit-respond.ores","accept"]],
 ["return-match-value",["return-match-value.ores","accept"]],
 ["do-match-value",["do-match-value.ores","accept"]],
 ["reject-implicit-void-return",["invalid-implicit-void-return.ores","reject"]],
 ["reject-double-response",["invalid-double-response.ores","reject"]]
]);
function assertCanonicalCaseMatrix(cases){
 assert.ok(Array.isArray(cases));
 assert.equal(cases.length,canonicalCases.size);
 const seenIds=new Set(),seenFiles=new Set(),seenBlobs=new Set();
 for(const entry of cases){
  assert.ok(entry&&typeof entry==="object"&&!Array.isArray(entry));
  assert.ok(canonicalCases.has(entry.id),"unknown case "+entry.id);
  assert.equal(seenIds.has(entry.id),false,"duplicate case id "+entry.id);
  seenIds.add(entry.id);
  const [file,expect]=canonicalCases.get(entry.id);
  assert.equal(entry.file,file,"incorrect fixture for "+entry.id);
  assert.equal(entry.expect,expect,"incorrect expected outcome for "+entry.id);
  assert.equal(seenFiles.has(entry.file),false,"duplicate fixture path");
  seenFiles.add(entry.file);
  assert.equal(seenBlobs.has(entry.sourceGitBlobSha1),false,"duplicate source blob");
  seenBlobs.add(entry.sourceGitBlobSha1);
 }
 assert.deepEqual([...seenIds].sort(),[...canonicalCases.keys()].sort());
}
test("actor reply contract matrix is explicitly pending on every language backend",()=>{
 assert.equal(manifest.schemaVersion,1);
 assert.equal(manifest.scope,"actor-reply-control-source-proposal-v1");
 assert.equal(manifest.hostReference.kind,"javascript-only");
 assert.equal(manifest.hostReference.compilerAdmission,false);
 assertCanonicalCaseMatrix(manifest.cases);
 assert.equal(manifest.hostReference.repo,"ores-truffle-oreslang/oreslang-wasm");
 assert.equal(manifest.hostReference.pullRequest,16);
 for(const entry of manifest.cases){
  assert.match(entry.sourceGitBlobSha1,/^[a-f0-9]{40}$/);
  assert.match(entry.file,/^[a-z-]+\.ores$/);
  assert.deepEqual(entry.confirmedBackends,[]);
  assert.deepEqual(entry.pendingBackends,["java-graalvm","llvm","wasm","browser-worker"]);
  assert.ok(["accept","reject"].includes(entry.expect));
 }
});
test("a duplicate or relabelled actor fixture cannot silently replace a negative case",()=>{
 const clone=()=>structuredClone(manifest.cases);
 const repeated=clone();repeated[4]=repeated[0];
 assert.throws(()=>assertCanonicalCaseMatrix(repeated),/duplicate case id/);
 const relabelled=clone();relabelled[4].expect="accept";
 assert.throws(()=>assertCanonicalCaseMatrix(relabelled),/incorrect expected outcome/);
 const swapped=clone();swapped[3].file="explicit-respond.ores";
 assert.throws(()=>assertCanonicalCaseMatrix(swapped),/incorrect fixture/);
 const foreign=clone();foreign[0].id="unexpected-source-claim";
 assert.throws(()=>assertCanonicalCaseMatrix(foreign),/unknown case/);
});
test("all actor reply fixtures are byte-identical to versioned Git blobs",async()=>{
 for(const entry of manifest.cases){
  const bytes=await readFile(new URL(entry.file,url));
  // A language-level accept/reject verdict must not hinge on an unresolved
  // Message type unrelated to the intended reply-control diagnostic.
  const source=bytes.toString("utf8");
  assert.match(source,/define enum Message as/);
  assert.match(source,/Compute Tuple\[string, int\] 1/);
  assert.match(source,/Result Tuple\[string, int\] 2/);
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
 const doubled=await load("invalid-double-response.ores");
 assert.equal((doubled.match(/self\.respond\s*\(/g)||[]).length,2);
 assert.match(doubled,/self\.done\(\)/);
});
