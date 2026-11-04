import test from "node:test";
import assert from "node:assert/strict";
import {loadSemanticManifest, loadSemanticManifestSnapshot, validateSemanticManifest, classifySemanticCompilerResult, observedSemanticDiagnostic, selectSemanticCases, semanticFixtureUnchanged, runSemanticAdmission} from "../src/semantic-reconciliation-v1.mjs";
import {readFile, writeFile, mkdtemp, lstat, rm, symlink, rename, unlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";

test("semantic inventory has complete five-backend negative and positive coverage, never implied guest parity", async () => {
 const cases = await loadSemanticManifest();
 assert.equal(cases.compilerCases.length,44);
 assert.equal(cases.runtimeCases.length,2);
 const ownership = cases.compilerCases.filter(c => c.concern === "ownership");
 assert.equal(ownership.length,32);
 assert.equal(ownership.filter(c => c.expect === "accept").length,16);
 assert.equal(ownership.filter(c => c.expect === "reject").length,16);
 assert.ok(ownership.some(c => c.id === "rt-take-member-projection" && c.diagnosticCode === "E_PARTIAL_MOVE"));
 const futureMap = cases.compilerCases.filter(c => c.id.startsWith("future-map-"));
 assert.deepEqual(futureMap.map(c=>c.expect),["accept","reject"]);
 assert.match(futureMap[0].source,/Future<Future<int>>/);
 assert.match(futureMap[0].source,/pub suspends fnc main\(\): void/);
 assert.match(futureMap[0].source,/val Future<int> inner = await pending/);
 assert.match(futureMap[0].source,/stdio\.stdout\.write\(await inner\)/);
 const twoAwait=cases.compilerCases.find(c=>c.id==="nested-future-two-awaits");
 assert.match(twoAwait.source,/pub suspends fnc main\(\): int \{ return use\(\); \}/);
 assert.match(futureMap[1].source,/Future<int> pending/);
 assert.equal(futureMap[1].diagnosticCode,"E_WRAPPER_LAYER");
 assert.equal(cases.status,"TARGET_ONLY_NOT_IMPLEMENTATION_EVIDENCE");
 for(const item of [...cases.compilerCases,...cases.runtimeCases]) {
   assert.deepEqual(Object.keys(item.backends),["java","llvm","net","wasm","forge"]);
   assert.ok(Object.values(item.backends).every(s=>s==="PENDING_GUEST_PROOF"));
 }
});
test("implicit by-value extraction targets are paired, exact and unverified on all backends", async () => {
 const manifest=await loadSemanticManifest();
 const pairs=[
   ["implicit-field-scalar-copy","implicit-field-move-only-consume",/consume\(holder\.item\)/],
   ["implicit-index-scalar-copy","implicit-index-move-only-return",/return items\[0\]/],
   ["take-conditional-copy-value","take-conditional-untracked-place",/rt take \(choose \? first : second\)/],
   ["take-cast-scalar-read","take-cast-untracked-place",/rt take \(box\.value as int\)/],
   ["assignment-ordinary-mutation","take-assignment-untracked-place",/rt take \(box\.value = 12\)/]
 ];
 for(const [positive,negative,pattern] of pairs) {
   const ok=manifest.compilerCases.find(c=>c.id===positive);
   const bad=manifest.compilerCases.find(c=>c.id===negative);
   assert.ok(ok && bad, "missing extraction pair: "+positive);
   assert.equal(ok.concern,"ownership");
   assert.equal(ok.expect,"accept");
   assert.equal(bad.concern,"ownership");
   assert.equal(bad.expect,"reject");
   assert.equal(bad.diagnosticCode,"E_PARTIAL_MOVE");
   assert.match(bad.source,pattern);
   assert.match(ok.source,/pub fnc main\(\): int/);
   assert.match(bad.source,/pub fnc main\(\): int/);
   for(const c of [ok,bad]) {
     assert.deepEqual(Object.keys(c.backends),["java","llvm","net","wasm","forge"]);
     assert.ok(Object.values(c.backends).every(v=>v==="PENDING_GUEST_PROOF"));
   }
 }
});


test("heap borrowing targets are paired, indexed-rooted and fail closed on all five backends", async () => {
 const manifest=await loadSemanticManifest();
 const pairs=[
   ["heap-array-scoped-read-loans","heap-array-resize-live-loan","E_BORROW_CONFLICT",/values\\.add\\(8\\)/],
   ["heap-array-scoped-exclusive","heap-array-exclusive-vs-read","E_BORROW_CONFLICT",/rt mut borrow values/],
   ["heap-array-owned-element-copy","heap-array-borrowed-element-return","E_BORROW_ESCAPE",/return rt borrow values\\[0\\]/],
   ["heap-array-whole-owner-take","heap-array-indexed-take","E_PARTIAL_MOVE",/rt take values\\[0\\]/]
 ];
 for(const [allowed,denied,diagnostic,pattern] of pairs) {
   const ok=manifest.compilerCases.find(c=>c.id===allowed);
   const bad=manifest.compilerCases.find(c=>c.id===denied);
   assert.ok(ok && bad,"missing heap ownership pair: "+allowed);
   assert.equal(ok.concern,"ownership");
   assert.equal(bad.concern,"ownership");
   assert.equal(ok.expect,"accept");
   assert.equal(bad.expect,"reject");
   assert.equal(bad.diagnosticCode,diagnostic);
   assert.match(ok.source,/Array<int>/);
   assert.match(bad.source,/Array<int>/);
   assert.match(bad.source,pattern);
   for (const c of [ok,bad]) {
     assert.match(c.source,/pub fnc main\\(\\): int/);
     assert.deepEqual(Object.keys(c.backends),["java","llvm","net","wasm","forge"]);
     assert.ok(Object.values(c.backends).every(x=>x==="PENDING_GUEST_PROOF"));
   }
 }
 const all=selectSemanticCases(manifest,"all");
 assert.equal(all.length,44);
 assert.equal(all.filter(c=>c.id.startsWith("heap-array-")).length,8);
});

test("heap ownership subset cannot promote full inventory and rejects incomplete pairs",async()=>{
 const manifest=await loadSemanticManifest();
 const suite=selectSemanticCases(manifest,"heap-ownership");
 const ids=[
   "heap-array-scoped-read-loans","heap-array-resize-live-loan",
   "heap-array-scoped-exclusive","heap-array-exclusive-vs-read",
   "heap-array-owned-element-copy","heap-array-borrowed-element-return",
   "heap-array-whole-owner-take","heap-array-indexed-take"
 ];
 assert.deepEqual(suite.map(x=>x.id),ids);
 assert.deepEqual(suite.map(x=>x.expect),[
   "accept","reject","accept","reject","accept","reject","accept","reject"
 ]);
 assert.ok(suite.every(x=>x.concern==="ownership"));
 const incomplete=structuredClone(manifest);
 incomplete.compilerCases=incomplete.compilerCases.filter(x=>x.id!=="heap-array-indexed-take");
 assert.throws(()=>selectSemanticCases(incomplete,"heap-ownership"),/incomplete semantic suite/);
 const swapped=structuredClone(manifest);
 swapped.compilerCases.find(x=>x.id==="heap-array-exclusive-vs-read").expect="accept";
 assert.throws(()=>selectSemanticCases(swapped,"heap-ownership"),/invalid or incomplete semantic suite/);
 const unconfigured=await runSemanticAdmission({backend:"java",suite:"heap-ownership"});
 assert.equal(unconfigured.ok,false);
 assert.equal(unconfigured.status,"UNCONFIGURED");
 assert.equal(unconfigured.fullInventoryMatched,false);
 assert.equal(unconfigured.selectedCaseIds.length,8);
 assert.equal(unconfigured.guestRuntimeVerified,false);
 assert.equal(unconfigured.parityVerified,false);
});

test("duplicate case ids, missing variants and fake backend promotion are rejected",async()=>{
 const base = await loadSemanticManifest();
 const clone = () => structuredClone(base);
 let v=clone();v.compilerCases[1].id=v.compilerCases[0].id;
 assert.throws(()=>validateSemanticManifest(v),/duplicate/);
 v=clone();v.compilerCases[1].expect="accept"; delete v.compilerCases[1].diagnosticCode;
 assert.throws(()=>validateSemanticManifest(v),/missing positive\/negative/);
 v=clone();v.compilerCases[0].backends.java="VERIFIED";
 assert.throws(()=>validateSemanticManifest(v),/silently verified/);
 v=clone();delete v.compilerCases[0].backends.wasm;
 assert.throws(()=>validateSemanticManifest(v),/silently verified/);
 v=clone();delete v.compilerCases[1].diagnosticCode;
 assert.throws(()=>validateSemanticManifest(v),/exact semantic code/);
});
test("diagnostic oracle requires actual exact semantic error, not arbitrary type/parse failures",async()=>{
 const c=(await loadSemanticManifest()).compilerCases.find(c=>c.expect==="reject");
 const code=c.diagnosticCode;
 assert.equal(classifySemanticCompilerResult(c,{status:1,stderr:"error: parse failed"}),"MISMATCH");
 assert.equal(classifySemanticCompilerResult(c,{status:0,stderr:"error["+code+"]: no"}),"MISMATCH");
 assert.equal(classifySemanticCompilerResult(c,{status:1,stderr:"error: unrelated\nnote: error["+code+"]: ignored"}),"MISMATCH");
 assert.equal(classifySemanticCompilerResult(c,{status:1,stderr:"error: unrelated\nerror["+code+"]: implicit conversion"}),"MISMATCH");
 assert.equal(classifySemanticCompilerResult(c,{status:1,stderr:"error["+code+"]: implicit conversion"}),"MATCHED_UNATTESTED");
 assert.equal(classifySemanticCompilerResult(c,{status:null,signal:"SIGSEGV",stderr:"error["+code+"]: fake"}),"INFRA_OR_CRASH");
});

test("semantic error receipts require one observed primary stderr code and no emitted IR", async () => {
 const candidate=(await loadSemanticManifest()).compilerCases.find(c => c.id==="heap-array-resize-live-loan");
 const correct="error[E_BORROW_CONFLICT]: cannot resize borrowed array";
 assert.equal(classifySemanticCompilerResult(candidate,{status:1,stderr:correct}),"MATCHED_UNATTESTED");
 assert.equal(observedSemanticDiagnostic({stderr:correct}),"E_BORROW_CONFLICT");
 assert.equal(observedSemanticDiagnostic({stderr:"error: unknown syntax"}),null);
 assert.equal(observedSemanticDiagnostic({stderr:"error[E_BORROW_CONFLICT]:"}),null);
 assert.equal(classifySemanticCompilerResult(candidate,{status:1,stdout:correct}),"MISMATCH",
   "a source echo or stdout diagnostic is not compiler proof");
 assert.equal(classifySemanticCompilerResult(candidate,{status:1,stderr:correct,stdout:"define i64 @main() {"}),"MISMATCH");
 assert.equal(classifySemanticCompilerResult(candidate,{status:1,stderr:correct+"\n; ModuleID = leaked"}),"MISMATCH");
 assert.equal(classifySemanticCompilerResult(candidate,{status:1,stderr:correct+"\ndeclare i64 @leak()"}),"MISMATCH");
 assert.equal(classifySemanticCompilerResult(candidate,{status:1,stderr:correct+"\nerror: unrelated parse failure"}),"MISMATCH");
 assert.equal(classifySemanticCompilerResult(candidate,{status:1,stderr:correct+"\nerror[E_WRAPPER_LAYER]: wrong source"}),"MISMATCH");
 assert.equal(classifySemanticCompilerResult(candidate,{status:1,stderr:"error[E_WRAPPER_LAYER]: wrong reason"}),"MISMATCH");
 assert.equal(classifySemanticCompilerResult(candidate,{status:0,stderr:correct}),"MISMATCH");
 assert.equal(classifySemanticCompilerResult(candidate,{status:null,signal:"SIGABRT",stderr:correct}),"INFRA_OR_CRASH");
});

test("fake compiler cannot promote source rejection after publishing an artifact", async () => {
 // This tests only the harness. A synthetic process can never establish
 // Oreslang compiler support or real backend parity.
 const dir=await mkdtemp(join(tmpdir(),"ores-semantic-artifact-denial-"));
 const script=join(dir,"fake-compiler.cjs");
 try {
   await writeFile(script, [
     '"use strict";',
     'const fs = require("node:fs");',
     'const source = process.argv.at(-1);',
     'if (source.includes("future-map-rejects-implicit-adoption")) {',
     '  fs.writeFileSync("partial.wasm", "invalid guest artifact");',
     '  console.error("error[E_WRAPPER_LAYER]: rejected by synthetic compiler");',
     '  process.exitCode = 1;',
     '}'
   ].join("\n"));
   const receipt=await runSemanticAdmission({
     backend:"java",suite:"future-map",sourceSha:"1".repeat(40),
     argv:[process.execPath,script,"{file}"]
   });
   assert.equal(receipt.ok,false);
   assert.equal(receipt.status,"NOT_VERIFIED");
   assert.equal(receipt.fullInventoryMatched,false);
   assert.equal(receipt.guestRuntimeVerified,false);
   assert.equal(receipt.parityVerified,false);
   const positive=receipt.sourceCases.find(x=>x.id==="future-map-preserves-nested-return");
   const negative=receipt.sourceCases.find(x=>x.id==="future-map-rejects-implicit-adoption");
   assert.equal(positive.status,"MATCHED_UNATTESTED");
   assert.equal(negative.status,"UNEXPECTED_COMPILER_ARTIFACT");
   assert.equal(negative.expectedDiagnosticCode,"E_WRAPPER_LAYER");
   assert.equal(negative.observedDiagnosticCode,"E_WRAPPER_LAYER");
 } finally {
   await rm(dir,{recursive:true,force:true});
 }
});


test("later compiler source mutation invalidates an earlier accepted result",async()=>{
 // A source-free synthetic process checks the verifier's suite-wide receipt.
 const dir=await mkdtemp(join(tmpdir(),"ores-semantic-previous-source-"));
 const script=join(dir,"fake-previous-source.cjs");
 try {
   await writeFile(script,[
     '"use strict";',
     'const fs = require("node:fs");',
     'const source = process.argv.at(-1);',
     'if (source.includes("future-map-rejects-implicit-adoption")) {',
     '  fs.unlinkSync("future-map-preserves-nested-return.ores");',
     '  fs.writeFileSync("future-map-preserves-nested-return.ores", "replaced");',
     '  console.error("error[E_WRAPPER_LAYER]: synthetic rejection");',
     '  process.exitCode = 1;',
     '}'
   ].join("\n"));
   const receipt=await runSemanticAdmission({
     backend:"llvm",suite:"future-map",sourceSha:"2".repeat(40),
     argv:[process.execPath,script,"{file}"]
   });
   assert.equal(receipt.ok,false);
   assert.equal(receipt.status,"NOT_VERIFIED");
   assert.equal(receipt.sourceCases[0].status,"SOURCE_MUTATED");
   assert.equal(receipt.sourceCases[1].status,"MATCHED_UNATTESTED");
   assert.equal(receipt.fullInventoryMatched,false);
   assert.equal(receipt.parityVerified,false);
 }finally{
   await rm(dir,{recursive:true,force:true});
 }
});

test("without actual compiler execution no backend may be declared verified",async()=>{
 for (const backend of ["java","llvm","net","wasm","forge"]) {
   const r=await runSemanticAdmission({backend});
   assert.equal(r.ok,false);
   assert.equal(r.status,"UNCONFIGURED");
   assert.equal(r.guestRuntimeVerified,false);
   assert.equal(r.parityVerified,false);
 }
});

test("bounded Future.map suite is paired and cannot claim full-inventory parity",async()=>{
 const doc=await loadSemanticManifest();
 const pair=selectSemanticCases(doc,"future-map");
 assert.deepEqual(pair.map(c=>c.id),["future-map-preserves-nested-return","future-map-rejects-implicit-adoption"]);
 assert.deepEqual(pair.map(c=>c.expect),["accept","reject"]);
 assert.equal(selectSemanticCases(doc,"all").length,doc.compilerCases.length);
 assert.equal(doc.compilerCases.length,44);
 assert.throws(()=>selectSemanticCases(doc,"unknown"),/unsupported semantic suite/);
 for(const inherited of ["constructor","toString","__proto__"]) {
   assert.throws(()=>selectSemanticCases(doc,inherited),/unsupported semantic suite/);
 }
 const broken=structuredClone(doc);
 broken.compilerCases=broken.compilerCases.filter(c=>c.id!=="future-map-rejects-implicit-adoption");
 assert.throws(()=>selectSemanticCases(broken,"future-map"),/incomplete semantic suite/);
 const r=await runSemanticAdmission({backend:"java",suite:"future-map"});
 assert.equal(r.status,"UNCONFIGURED");
 assert.equal(r.fullInventoryMatched,false);
 assert.deepEqual(r.selectedCaseIds,pair.map(c=>c.id));
 await assert.rejects(()=>runSemanticAdmission({backend:"java",suite:"unknown"}),/unsupported semantic suite/);
});

test("manifest provenance hashes the same exact bytes used for validation",async()=>{
 const snapshot=await loadSemanticManifestSnapshot();
 const bytes=await readFile(new URL("../contracts/v1/semantic-reconciliation-cases.v1.json",import.meta.url));
 const expected=createHash("sha256").update(bytes).digest("hex");
 assert.match(snapshot.manifestSha256,/^[0-9a-f]{64}$/);
 assert.equal(snapshot.manifestSha256,expected);
 assert.equal(snapshot.doc.compilerCases.length,44);
 assert.equal(selectSemanticCases(snapshot.doc,"all").length,44);
 const second=await loadSemanticManifestSnapshot();
 assert.equal(second.manifestSha256,expected);
 assert.deepEqual(second.doc.backends,["java","llvm","net","wasm","forge"]);
});

test("post-compiler fixture proof rejects symlinks, replacement inodes and deletion",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ores-semantic-mutation-test-"));
 const file=join(dir,"source.ores"),replacement=join(dir,"replacement.ores");
 const bytes="pub fnc main(): int { return 42; }\\n";
 const digest=createHash("sha256").update(bytes).digest("hex");
 try {
   await writeFile(file,bytes,{mode:0o400,flag:"wx"});
   const original=await lstat(file);
   assert.equal(await semanticFixtureUnchanged(file,original,digest),true);
   await writeFile(replacement,bytes,{mode:0o400,flag:"wx"});
   await unlink(file);
   await symlink(replacement,file);
   assert.equal(await semanticFixtureUnchanged(file,original,digest),false,
     "a symlink to identical bytes must never count as the original fixture");
   await unlink(file);
   await rename(replacement,file);
   assert.equal(await semanticFixtureUnchanged(file,original,digest),false,
     "a new inode with identical bytes is a source substitution");
   await unlink(file);
   assert.equal(await semanticFixtureUnchanged(file,original,digest),false,
     "missing source must be SOURCE_MUTATED, not an uncaught admission pass");
 } finally { await rm(dir,{recursive:true,force:true}); }
});
