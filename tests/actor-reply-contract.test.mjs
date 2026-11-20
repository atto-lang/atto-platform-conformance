import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {assertCanonicalActorReceive} from "./helpers/actor-receive-fixture.mjs";
const url=new URL("../fixtures/actor-reply/v1/",import.meta.url);
const manifest=JSON.parse(await readFile(new URL("manifest.json",url),"utf8"));
const canonicalCases=new Map([
 ["actor-explicit-respond",["explicit-respond.ores","accept"]],
 ["return-match-value",["return-match-value.ores","accept"]],
 ["do-match-value",["do-match-value.ores","accept"]],
 ["reject-implicit-void-return",["invalid-implicit-void-return.ores","reject"]],
 ["reject-double-response",["invalid-double-response.ores","reject"]],
 ["reject-do-match-void-return",["invalid-do-match-void-return.ores","reject"]]
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
  if(source.includes("match m over"))
   assert.match(source,/on Message.Result as/,"non-exhaustive Result case: "+entry.file);
  if(source.includes("define actor WorkerActor as"))
   assert.match(source,/@Implements\s+receive\(Message m\): void/,"receiver marker missing: "+entry.file);
  const digest=createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
  assert.equal(digest,entry.sourceGitBlobSha1,entry.file);
 }
});
test("source proposal distinguishes actor reply effects from callable returns",async()=>{
 const load=async name=>readFile(new URL(name,url),"utf8");
 const actor=await load("explicit-respond.ores");
 // Scan executable tokens, not raw text: comments, strings, nested
 // braces, branch-local done calls, and out-of-order effects must not spoof
 // the canonical procedural actor receive contract.
 assert.equal(assertCanonicalActorReceive(actor),true);
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
 const invalidDo=await load("invalid-do-match-void-return.ores");
 assert.match(invalidDo,/receive\(Message m\): void/);
 assert.match(invalidDo,/do match m over/);
 assert.match(invalidDo,/return Message\.Result\(/);
 assert.equal((invalidDo.match(/self\.done\(\)/g)||[]).length,2);
});


test("fixture JSON Schema vocabulary and closed-field contracts match the pinned manifest",async()=>{
 const schema=JSON.parse(await readFile(new URL("../schemas/actor-reply-fixtures.schema.json",import.meta.url),"utf8"));
 assert.equal(schema.$schema,"https://json-schema.org/draft/2020-12/schema");
 assert.equal(schema.additionalProperties,false);
 assert.equal(schema.$defs.case.additionalProperties,false);
 assert.equal(schema.properties.hostReference.additionalProperties,false);
 assert.equal(schema.properties.schemaVersion.const,1);
 assert.equal(schema.properties.scope.const,manifest.scope);
 assert.equal(schema.properties.cases.minItems,canonicalCases.size);
 assert.equal(schema.properties.cases.maxItems,canonicalCases.size);
 assert.deepEqual(schema.$defs.case.properties.id.enum,[...canonicalCases.keys()]);
 const backendNames=["java-graalvm","llvm","wasm","browser-worker"];
 assert.deepEqual(schema.$defs.backend.enum,backendNames);
 assert.deepEqual(schema.$defs.case.properties.expect.enum,["accept","reject"]);
 for(const item of manifest.cases){
  assert.ok(schema.$defs.case.properties.id.enum.includes(item.id));
  assert.match(item.file,new RegExp(schema.$defs.case.properties.file.pattern));
  assert.match(item.sourceGitBlobSha1,new RegExp(schema.$defs.case.properties.sourceGitBlobSha1.pattern));
  for(const backend of [...item.confirmedBackends,...item.pendingBackends])
   assert.ok(schema.$defs.backend.enum.includes(backend));
 }
 assert.equal(schema.properties.hostReference.properties.compilerAdmission.const,false);
});

test("procedural actor grammar cannot be spoofed by comments or strings",async()=>{
 const actor=await readFile(new URL("explicit-respond.ores",url),"utf8");
 const mutations=[
  // A non-executed comment must never satisfy the do match rule.
  actor.replace("do match m over", "/* do match m over { */ match m over"),
  actor.replace("do match m over", '"do match m over"; match m over'),
  actor.replace("do match m over", "// do match m over\n    match m over"),
  // An apparent done call in a comment is not a terminal delivery.
  actor.replace("self.done();\n      }\n    }\n  }\nend",
   "/* self.done(); */\n      }\n    }\n  }\nend"),
  // One delivery may not complete twice.
  actor.replace("self.done();", "self.done();\n        self.done();"),
  // No reply or effect is permitted after the terminal done() call.
  actor.replace("self.done();\n      }\n      on Message.Result",
   'self.done();\n        self.respond(Message.Result("late", 3));\n      }\n      on Message.Result'),
  // A reply must not be generated on the one-way Result branch.
  actor.replace("on Message.Result as (text, n) {\n        self.done();",
   'on Message.Result as (text, n) {\n        self.respond(Message.Result("wrong", 0));\n        self.done();'),
  // Returning from receive is not a response, even inside do match.
  actor.replace("self.respond(Message.Result(text, n + 1));",
   "return Message.Result(text, n + 1);"),
  // A catch-all arm cannot silently replace exhaustive variant handling.
  actor.replace("on Message.Result as", "on Message.Compute as"),
  // The reply must be the declared Result variant, not another Compute.
  actor.replace("self.respond(Message.Result(text, n + 1));",
   '/* self.respond(Message.Result("decoy", 42)); */\n        self.respond(Message.Compute(text, n + 1));'),
  // A second hidden receive overload is not part of this single-handler
  // canonical fixture even if its parameter types differ.
  actor.slice(0,actor.lastIndexOf("\nend\n"))+
   "\n  receive(ActorMail<int> other): void { return; }\nend\n"
 ];
 for(const [i,mutated] of mutations.entries()){
  assert.notEqual(mutated,actor,"mutation "+i+" did not modify source");
  assert.throws(()=>assertCanonicalActorReceive(mutated),undefined,
   "mutation "+i+" escaped scoped actor contract validation");
 }
 assert.equal(assertCanonicalActorReceive(actor),true);
});
