import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {loadManifest,runSuite,BACKENDS} from "../src/harness.mjs";
const sha="1".repeat(40);
const argv=[process.execPath,"{file}"];
test("versioned I/O corpus has exact shared identity and all five backend selectors",async()=>{
 const raw=await readFile(new URL("../fixtures/mandatory-async-io.json",import.meta.url));
 assert.equal(createHash("sha256").update(raw).digest("hex"),"e3b5caa3267683e7a1ec83f04d671333455746ceb87188dba6ec7ec1e75ec042");
 const corpus=JSON.parse(raw);const manifest=await loadManifest("mandatory-async");
 assert.equal(manifest.cases.length,corpus.cases.length);
 for(const [i,c] of corpus.cases.entries()){
  const fixture=manifest.cases[i];assert.deepEqual(fixture.backends,["java","net","llvm","forge","wasm"]);
  assert.equal(fixture.expect,c.expect);
  assert.equal(await readFile(new URL("../fixtures/"+fixture.file,import.meta.url),"utf8"),c.source+"\n");
 }
});
test("unconfigured backend never claims mandatory I/O coverage",async()=>{
 for(const backend of BACKENDS.filter(x=>x!=="browser")){
  const result=await runSuite({backend,suite:"mandatory-async",requireConfigured:true});
  assert.equal(result.ok,false);assert.equal(result.verified,0);assert.equal(result.skipped,22);
 }
});
test("negative I/O rejects usage, crashes, partial artifacts and tool failures",async()=>{
 for(const output of [
  {status:2,stdout:"",stderr:"error: unexpected argument"},
  {status:139,stdout:"",stderr:"error: crash"},
  {status:1,stdout:"partial IR",stderr:"error: unsupported operation"},
  {status:null,stdout:"",stderr:"error: unsupported",signal:"SIGTERM"},
  {status:null,stdout:"",stderr:"error: unsupported",error:{code:"ETIMEDOUT"}}
 ]){
  const result=await runSuite({backend:"net",suite:"mandatory-async",argv,sourceSha:sha,spawn:()=>output});
  assert.equal(result.verified,0);assert.equal(result.failed,22);
 }
});
test("only diagnosed exit-one with no artifact can verify I/O rejection",async()=>{
 const result=await runSuite({backend:"forge",suite:"mandatory-async",argv,sourceSha:sha,spawn:()=>({status:1,stdout:"",stderr:"error: unsupported operation"})});
 assert.equal(result.verified,20);assert.equal(result.failed,2);assert.equal(result.ok,false);
 await assert.rejects(loadManifest("../other"),/unknown conformance suite/);
});
