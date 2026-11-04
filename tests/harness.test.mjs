import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtemp,writeFile,rm,symlink} from "node:fs/promises";
import {writeFileSync,unlinkSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runSuite,validateCommand,validateManifestSchema,loadManifest,COMPILER_BACKENDS} from "../src/harness.mjs";
const sha="012345678901234567890123456789abcdefabcd";
const cmd=[process.execPath,new URL("./fake-checker.mjs",import.meta.url).pathname,"{file}"];
// Pin the authored corpus, not just its length. The LiveView source fixture
// added in #287 targets the five native backends, deliberately excluding JS.
const EXPECTED_CASE_IDS=[
 "int-arithmetic","unresolved-identifier",
 "generator-sync","generator-async","generator-suspend",
 "liveview-revision-order"
];
const fixtureCount=EXPECTED_CASE_IDS.length;
const unsupportedFixtureCount=3;
const executableFixtureCount=fixtureCount-unsupportedFixtureCount;
const jsFixtureCount=fixtureCount-1;
const jsExecutableFixtureCount=jsFixtureCount-unsupportedFixtureCount;
test("manifest parses exact fixtures",async()=>{
 const m=await loadManifest();
 assert.deepEqual(m.cases.map(c=>c.id),EXPECTED_CASE_IDS);
 assert.equal(m.cases.length,fixtureCount);
});
test("unsupported capability ledger is constrained to positive listed backends",()=>{
 const base={
  schemaVersion:1,
  cases:[
   {id:"ok",file:"ok.ores",expect:"accept",backends:[...COMPILER_BACKENDS]},
   {id:"bad",file:"bad.ores",expect:"reject",diagnostic:"missing",backends:[...COMPILER_BACKENDS]}
  ]
 };
 assert.doesNotThrow(()=>validateManifestSchema(structuredClone(base)));
 const noExecutablePositive=structuredClone(base);
 noExecutablePositive.cases[0].unsupportedBackends=["java"];
 assert.throws(
   ()=>validateManifestSchema(noExecutablePositive),
   /missing positive\/negative fixture coverage for java/
 );
 for(const mutate of [
  manifest=>{manifest.cases[0].unsupportedBackends=["not-a-backend"]},
  manifest=>{manifest.cases[0].unsupportedBackends=["java","java"]},
  manifest=>{manifest.cases[1].unsupportedBackends=["java"]},
  manifest=>{manifest.cases[0].unsupportedBackends=["browser"]}
 ]){
  const candidate=structuredClone(base);mutate(candidate);
  assert.throws(()=>validateManifestSchema(candidate),/unsupported backend capability ledger/);
 }
});

test("unconfigured is explicit and never counted as verified",async()=>{
 const r=await runSuite({backend:"java"});
 assert.equal(r.configured,false);
 assert.equal(r.verified,0);
 assert.equal(r.skipped,fixtureCount);
 assert.equal(r.unsupported,0);
 assert.ok(r.results.every(x=>x.status==="UNCONFIGURED"));
});
test("required unconfigured suite exits with non-success state",async()=>{
 const r=await runSuite({backend:"java",requireConfigured:true});
 assert.equal(r.ok,false);
 const p=spawnSync(process.execPath,[new URL("../bin/conformance.mjs",import.meta.url).pathname,"--backend=java","--require"],{encoding:"utf8"});
 assert.notEqual(p.status,0);
 assert.match(p.stdout,/UNCONFIGURED/);
});
test("declared unsupported generator targets never become fake verification",async()=>{
 const r=await runSuite({backend:"java",argv:cmd,sourceSha:sha});
 assert.equal(r.configured,true);
 assert.equal(r.verified,executableFixtureCount);
 assert.equal(r.failed,unsupportedFixtureCount);
 assert.equal(r.unsupported,unsupportedFixtureCount);
 assert.equal(r.ok,false);
 assert.equal(r.results.filter(x=>x.status==="VERIFIED").length,executableFixtureCount);
 assert.equal(r.results.filter(x=>x.status==="UNSUPPORTED").length,unsupportedFixtureCount);
 assert.ok(r.results.filter(x=>x.status==="UNSUPPORTED")
   .every(x=>x.exitCode===null&&x.capabilityNote?.includes("declared unsupported")));
});
test("LLVM capability ledger is explicit rather than inferred from parser rejection",async()=>{
 const r=await runSuite({backend:"llvm",argv:cmd,sourceSha:sha});
 assert.equal(r.verified,executableFixtureCount);
 assert.equal(r.results.filter(x=>x.status==="UNSUPPORTED").length,unsupportedFixtureCount);
 assert.equal(r.unsupported,unsupportedFixtureCount);
 assert.equal(r.ok,false);
});
test("missing executable is not mistaken for valid reject",async()=>{
 const r=await runSuite({backend:"llvm",argv:["/no/such/executable/oreslang","{file}"],sourceSha:sha});
 assert.equal(r.failed,fixtureCount);
 assert.equal(r.results.filter(x=>x.status==="SPAWN_ERROR").length,executableFixtureCount);
 assert.equal(r.results.filter(x=>x.status==="UNSUPPORTED").length,unsupportedFixtureCount);
});
test("no compiler revision or unsafe argument template fails closed",async()=>{
 await assert.rejects(runSuite({backend:"java",argv:cmd}),/SHA/);
 for(const bad of [[],["echo"],["echo","foo{file}"],["echo","{file}","{file}"]])assert.throws(()=>validateCommand(bad));
});
test("nonzero exit without expected error is never accepted",async()=>{
 const r=await runSuite({backend:"java",argv:cmd,sourceSha:sha,spawn:()=>({status:2,stdout:"",stderr:"disk failure"})});
 assert.equal(r.failed,fixtureCount);
});
test("timeout and signal are never green",async()=>{
 const r=await runSuite({backend:"llvm",argv:cmd,sourceSha:sha,spawn:()=>({status:null,signal:null,error:{code:"ETIMEDOUT"}})});
 assert.equal(r.failed,fixtureCount);
 assert.equal(r.results.filter(x=>x.status==="TIMEOUT").length,executableFixtureCount);
 assert.equal(r.results.filter(x=>x.status==="UNSUPPORTED").length,unsupportedFixtureCount);
});

test("verified harness results retain executable and fixture SHA-256 evidence",async()=>{
 const r=await runSuite({backend:"llvm",argv:cmd,sourceSha:sha});
 assert.match(r.executableSha256,/^[0-9a-f]{64}$/);
 assert.equal(r.declaredSourceSha,sha);
 assert.match(r.provenanceNote,/does not attest/);
 assert.equal(r.verificationScope,"compiler-source-check-only");
 assert.equal(r.runtimeVerified,false);
 for(const item of r.results){
  assert.match(item.fixtureSha256,/^[0-9a-f]{64}$/);
  if(item.status==="UNSUPPORTED"){
   assert.equal(item.executableSha256Before,null);
   assert.equal(item.executableSha256After,null);
   continue;
  }
  assert.equal(item.executableSha256Before,r.executableSha256);
  assert.equal(item.executableSha256After,r.executableSha256);
  assert.equal(item.executableResolvedPathBefore,item.executableResolvedPathAfter);
 }
});
test("crash text quoting the symbol is not a real compile-time diagnostic",async()=>{
 const r=await runSuite({backend:"llvm",argv:cmd,sourceSha:sha,spawn:()=>({status:1,stdout:"",stderr:"crash during compilation: nonexistent_symbol"})});
 assert.equal(r.verified,0);
 assert.equal(r.failed,fixtureCount);
});
test("bad timeouts and PATH-dependent commands are rejected",async()=>{
 for(const timeoutMs of [0,99,120001,NaN,Infinity])await assert.rejects(runSuite({backend:"java",timeoutMs}),/timeoutMs/);
 assert.throws(()=>validateCommand(["node","{file}"]),/absolute/);
});

test("duplicate CLI selectors cannot silently replace compiler invocation or provenance",()=>{
 const cli=new URL("../bin/conformance.mjs",import.meta.url).pathname;
 for(const [first,second] of [
  ["--backend=java","--backend=llvm"],
  ["--argv=[]","--argv=[]"],
  ["--source-sha="+sha,"--source-sha="+"0".repeat(40)],
  ["--timeout-ms=100","--timeout-ms=200"],
  ["--require","--require"]]){
  const result=spawnSync(process.execPath,[cli,first,second],{encoding:"utf8"});
  assert.equal(result.status,2);
  assert.match(result.stderr,/duplicate conformance argument/);
  assert.equal(result.stdout,"");
 }
});

test("all six source compiler backends have target fixtures but none are verified without a real runner",async()=>{
 const manifest=await loadManifest();
 assert.deepEqual([...COMPILER_BACKENDS].sort(),["forge","java","js","llvm","net","wasm"].sort());
 for(const c of manifest.cases){
  // Do not widen the native-only LiveView fixture to the JS compiler.
  const required=c.id==="liveview-revision-order"
    ?COMPILER_BACKENDS.filter(backend=>backend!=="js")
    :COMPILER_BACKENDS;
  assert.deepEqual([...c.backends].sort(),[...required].sort(),c.id);
 }
 for(const backend of COMPILER_BACKENDS){
  const r=await runSuite({backend,requireConfigured:true});
  assert.equal(r.ok,false,backend);
  assert.equal(r.configured,false,backend);
  assert.equal(r.verified,0,backend);
  assert.equal(r.skipped,backend==="js"?jsFixtureCount:fixtureCount,backend);
  assert.ok(r.results.every(x=>x.status==="UNCONFIGURED"),backend);
 }
});
test("missing real tools cannot yield verification for newly admitted backends",async()=>{
 for(const backend of ["net","wasm","forge","js"]){
  const r=await runSuite({backend,argv:["/no/such/oreslang-compiler","{file}"],sourceSha:sha});
  assert.equal(r.ok,false,backend);
  // JS is deliberately excluded from the native-only LiveView row.
  const isJs=backend==="js";
  assert.equal(r.failed,isJs?jsFixtureCount:fixtureCount,backend);
  assert.equal(r.results.filter(x=>x.status==="SPAWN_ERROR").length,
    isJs?jsExecutableFixtureCount:executableFixtureCount,backend);
  assert.equal(r.results.filter(x=>x.status==="UNSUPPORTED").length,unsupportedFixtureCount,backend);
 }
 await assert.rejects(runSuite({backend:"not-a-compiler"}),/unknown backend/);
});


test("compiler byte replacement during a fixture invocation fails closed",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"oreslang-executable-drift-"));
 const executable=join(dir,"compiler");
 await writeFile(executable,"version-A");
 let calls=0;
 try{
  const r=await runSuite({backend:"java",argv:[executable,"{file}"],sourceSha:sha,spawn:()=>{
   if(++calls===1)writeFileSync(executable,"version-B");
   return {status:0,signal:null,stdout:"",stderr:""};
  }});
  assert.equal(r.ok,false);
  assert.equal(r.verified,0);
  assert.equal(r.results[0].status,"EXECUTABLE_CHANGED");
  assert.notEqual(r.results[0].executableSha256Before,r.results[0].executableSha256After);
  assert.ok(r.results.every(x=>x.status!=="VERIFIED"));
 }finally{await rm(dir,{recursive:true,force:true})}
});

test("compiler deletion after prehash fails closed",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"oreslang-executable-delete-"));
 const executable=join(dir,"compiler");
 await writeFile(executable,"version-A");
 let calls=0;
 try{
  const r=await runSuite({backend:"llvm",argv:[executable,"{file}"],sourceSha:sha,spawn:()=>{
   if(++calls===1)unlinkSync(executable);
   return {status:0,signal:null,stdout:"",stderr:""};
  }});
  assert.equal(r.ok,false);
  assert.equal(r.results[0].status,"EXECUTABLE_CHANGED");
  assert.equal(r.results[0].executableSha256After,null);
  assert.ok(r.results.every(x=>x.status!=="VERIFIED"));
 }finally{await rm(dir,{recursive:true,force:true})}
});

test("compiler symlink retargeting is detected",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"oreslang-executable-symlink-"));
 const targetA=join(dir,"compiler-A"),targetB=join(dir,"compiler-B"),executable=join(dir,"compiler");
 await writeFile(targetA,"version-A");
 await writeFile(targetB,"version-B");
 await symlink(targetA,executable);
 let calls=0;
 try{
  const r=await runSuite({backend:"forge",argv:[executable,"{file}"],sourceSha:sha,spawn:()=>{
   if(++calls===1){unlinkSync(executable);symlinkSync(targetB,executable)}
   return {status:0,signal:null,stdout:"",stderr:""};
  }});
  assert.equal(r.ok,false);
  assert.equal(r.results[0].status,"EXECUTABLE_CHANGED");
  assert.notEqual(r.results[0].executableResolvedPathBefore,r.results[0].executableResolvedPathAfter);
  assert.ok(r.results.every(x=>x.status!=="VERIFIED"));
 }finally{await rm(dir,{recursive:true,force:true})}
});

test("late compiler replacement revokes previous successful fixture evidence",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"oreslang-late-executable-drift-"));
 const executable=join(dir,"compiler");
 await writeFile(executable,"version-A");
 let calls=0;
 try{
  const r=await runSuite({backend:"java",argv:[executable,"{file}"],sourceSha:sha,spawn:()=>{
   if(++calls===2)writeFileSync(executable,"version-B");
   return {status:0,signal:null,stdout:"",stderr:""};
  }});
  assert.equal(calls,executableFixtureCount);
  assert.equal(r.ok,false);
  assert.equal(r.verified,0);
  assert.equal(r.failed,fixtureCount);
  assert.equal(r.results[0].status,"EXECUTABLE_CHANGED");
  assert.equal(r.results[0].priorVerificationRevoked,true);
  assert.equal(r.results[1].status,"EXECUTABLE_CHANGED");
  assert.notEqual(r.results[1].executableSha256Before,r.results[1].executableSha256After);
 }finally{await rm(dir,{recursive:true,force:true})}
});
