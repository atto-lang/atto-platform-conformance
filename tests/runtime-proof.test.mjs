import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {runTypedSuite,verifyTypedRuntimeReports,loadRuntimeCases,canonicalI64} from "../src/runtime-proof.mjs";
const pins=JSON.parse(await readFile(fileURLToPath(new URL("../fixtures/compiler-pins.json",import.meta.url))));
const argv=[process.execPath,fileURLToPath(new URL("./fake-runtime.mjs",import.meta.url)),"{file}"];
const sha=x=>createHash("sha256").update(x).digest("hex");
const binarySha=sha(await readFile(process.execPath));
async function reports(){
 const cases=await loadRuntimeCases();
 const java=await runTypedSuite({backend:"java",argv,sourceSha:pins.backends.java.sourceCommit});
 const llvm=await runTypedSuite({backend:"llvm",argv,sourceSha:pins.backends.llvm.sourceCommit});
 const buildReports={java:{artifacts:[{role:"runtime-runner",sha256:binarySha}]},
  llvm:{artifacts:[{role:"runtime-runner",sha256:binarySha}]}};
 return {java,llvm,cases,buildReports};
}
test("typed manifest is independently pinned to shared accepted compiler sources",async()=>{
 const cases=await loadRuntimeCases();
 assert.equal(cases.length,5);
 assert.deepEqual(cases.map(x=>x.expect),["42","42","28","-7","65539"]);
});
test("mock runtime only verifies typed harness semantics, not actual compiler parity",async()=>{
 const {java,llvm,cases,buildReports}=await reports();
 assert.equal(java.verified,5);assert.equal(llvm.verified,5);
 assert.equal(verifyTypedRuntimeReports(java,llvm,cases,pins,buildReports).status,"PAIRED_TYPED_I64_RUNTIME_PASS");
});
test("full signed range is accepted, but noncanonical and overflowing values are rejected",()=>{
 for(const s of ["-9223372036854775808","9223372036854775807","0","-7"])assert.equal(canonicalI64(s),s);
 for(const s of ["01","-0","+42"," 42","9223372036854775808","-9223372036854775809","1.0","1e3"])assert.throws(()=>canonicalI64(s));
});
test("different execution outcomes, skipped cases or wrong fixtures cannot be paired",async()=>{
 const {java,llvm,cases,buildReports}=await reports();
 llvm.results[0].value="41";
 assert.throws(()=>verifyTypedRuntimeReports(java,llvm,cases,pins,buildReports),/mismatch/);
 llvm.results[0].value="42";llvm.results.pop();llvm.verified=4;
 assert.throws(()=>verifyTypedRuntimeReports(java,llvm,cases,pins,buildReports),/incomplete/);
});
test("runner SHA must be bound to an independently hashed build report",async()=>{
 const {java,llvm,cases,buildReports}=await reports();
 buildReports.java.artifacts[0].sha256="f".repeat(64);
 assert.throws(()=>verifyTypedRuntimeReports(java,llvm,cases,pins,buildReports),/incomplete/);
});
test("reject forged stdout, signal, exit code and misplaced source revision",async()=>{
 const {java,llvm,cases,buildReports}=await reports();
 llvm.results[0].stdout="debug\\n42\\n";
 assert.throws(()=>verifyTypedRuntimeReports(java,llvm,cases,pins,buildReports),/mismatch/);
 llvm.results[0].stdout="42\\n";llvm.results[0].exitCode=7;
 assert.throws(()=>verifyTypedRuntimeReports(java,llvm,cases,pins,buildReports),/mismatch/);
 llvm.results[0].exitCode=0;llvm.declaredSourceSha="e".repeat(40);
 assert.throws(()=>verifyTypedRuntimeReports(java,llvm,cases,pins,buildReports),/incomplete/);
});
test("runtime crashes, timeouts and truncated process results fail closed",async()=>{
 const good=()=>({status:0,stdout:String.fromCharCode(52,50,10),stderr:"",signal:null});
 const crash=await runTypedSuite({backend:"java",argv,sourceSha:pins.backends.java.sourceCommit,spawn:()=>({status:null,signal:"SIGSEGV",stdout:"",stderr:""})});
 assert.equal(crash.failed,5);assert.ok(crash.results.every(x=>x.status==="SIGNALED"));
 const timeout=await runTypedSuite({backend:"llvm",argv,sourceSha:pins.backends.llvm.sourceCommit,spawn:()=>({status:null,signal:null,error:{code:"ETIMEDOUT"}})});
 assert.equal(timeout.failed,5);assert.ok(timeout.results.every(x=>x.status==="TIMEOUT"));
 const truncated=await runTypedSuite({backend:"java",argv,sourceSha:pins.backends.java.sourceCommit,spawn:good});
 assert.equal(truncated.failed,3); // arithmetic-precedence expected 28, not 42
});
