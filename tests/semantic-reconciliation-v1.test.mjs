import test from "node:test";
import assert from "node:assert/strict";
import {loadSemanticManifest, loadSemanticManifestSnapshot, validateSemanticManifest, classifySemanticCompilerResult, selectSemanticCases, runSemanticAdmission} from "../src/semantic-reconciliation-v1.mjs";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";

test("semantic inventory has complete five-backend negative and positive coverage, never implied guest parity", async () => {
 const cases = await loadSemanticManifest();
 assert.equal(cases.compilerCases.length,26);
 assert.equal(cases.runtimeCases.length,2);
 const ownership = cases.compilerCases.filter(c => c.concern === "ownership");
 assert.equal(ownership.length,14);
 assert.equal(ownership.filter(c => c.expect === "accept").length,7);
 assert.equal(ownership.filter(c => c.expect === "reject").length,7);
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
 assert.equal(doc.compilerCases.length,26);
 assert.throws(()=>selectSemanticCases(doc,"unknown"),/unsupported semantic suite/);
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
 assert.equal(snapshot.doc.compilerCases.length,26);
 assert.equal(selectSemanticCases(snapshot.doc,"all").length,26);
 const second=await loadSemanticManifestSnapshot();
 assert.equal(second.manifestSha256,expected);
 assert.deepEqual(second.doc.backends,["java","llvm","net","wasm","forge"]);
});
