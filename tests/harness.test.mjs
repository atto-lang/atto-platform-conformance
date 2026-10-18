import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtemp,writeFile,rm,symlink} from "node:fs/promises";
import {writeFileSync,unlinkSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runSuite,validateCommand,loadManifest,COMPILER_BACKENDS} from "../src/harness.mjs";
const sha="012345678901234567890123456789abcdefabcd";
const cmd=[process.execPath,new URL("./fake-checker.mjs",import.meta.url).pathname,"{file}"];
test("manifest parses exact fixtures",async()=>{const m=await loadManifest();assert.equal(m.cases.length,2)});
test("unconfigured is explicit and never counted as verified",async()=>{
 const r=await runSuite({backend:"java"});
 assert.equal(r.configured,false);
 assert.equal(r.verified,0);
 assert.equal(r.skipped,2);
 assert.ok(r.results.every(x=>x.status==="UNCONFIGURED"));
});
test("required unconfigured suite exits with non-success state",async()=>{
 const r=await runSuite({backend:"java",requireConfigured:true});
 assert.equal(r.ok,false);
 const p=spawnSync(process.execPath,[new URL("../bin/conformance.mjs",import.meta.url).pathname,"--backend=java","--require"],{encoding:"utf8"});
 assert.notEqual(p.status,0);
 assert.match(p.stdout,/UNCONFIGURED/);
});
test("fake checker only exercises harness accept and reject handling",async()=>{
 const r=await runSuite({backend:"java",argv:cmd,sourceSha:sha});
 assert.equal(r.configured,true);
 assert.equal(r.verified,2);
 assert.equal(r.failed,0);
 assert.ok(r.results.every(x=>x.status==="VERIFIED"));
});
test("same fixtures can be selected for LLVM, without claiming LLVM executed",async()=>{
 const r=await runSuite({backend:"llvm",argv:cmd,sourceSha:sha});
 assert.equal(r.verified,2);
});
test("missing executable is not mistaken for valid reject",async()=>{
 const r=await runSuite({backend:"llvm",argv:["/no/such/executable/oreslang","{file}"],sourceSha:sha});
 assert.equal(r.failed,2);
 assert.ok(r.results.every(x=>x.status==="SPAWN_ERROR"));
});
test("no compiler revision or unsafe argument template fails closed",async()=>{
 await assert.rejects(runSuite({backend:"java",argv:cmd}),/SHA/);
 for(const bad of [[],["echo"],["echo","foo{file}"],["echo","{file}","{file}"]])assert.throws(()=>validateCommand(bad));
});
test("nonzero exit without expected error is never accepted",async()=>{
 const r=await runSuite({backend:"java",argv:cmd,sourceSha:sha,spawn:()=>({status:2,stdout:"",stderr:"disk failure"})});
 assert.equal(r.failed,2);
});
test("timeout and signal are never green",async()=>{
 const r=await runSuite({backend:"llvm",argv:cmd,sourceSha:sha,spawn:()=>({status:null,signal:null,error:{code:"ETIMEDOUT"}})});
 assert.equal(r.failed,2);
 assert.ok(r.results.every(x=>x.status==="TIMEOUT"));
});

test("verified harness results retain executable and fixture SHA-256 evidence",async()=>{
 const r=await runSuite({backend:"llvm",argv:cmd,sourceSha:sha});
 assert.match(r.executableSha256,/^[0-9a-f]{64}$/);
 assert.equal(r.declaredSourceSha,sha);
 assert.match(r.provenanceNote,/does not attest/);
 for(const item of r.results){
  assert.match(item.fixtureSha256,/^[0-9a-f]{64}$/);
  assert.equal(item.executableSha256Before,r.executableSha256);
  assert.equal(item.executableSha256After,r.executableSha256);
  assert.equal(item.executableResolvedPathBefore,item.executableResolvedPathAfter);
 }
});
test("crash text quoting the symbol is not a real compile-time diagnostic",async()=>{
 const r=await runSuite({backend:"llvm",argv:cmd,sourceSha:sha,spawn:()=>({status:1,stdout:"",stderr:"crash during compilation: nonexistent_symbol"})});
 assert.equal(r.verified,0);
 assert.equal(r.failed,2);
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

test("all five source compiler backends have target fixtures but none are verified without a real runner",async()=>{
 const manifest=await loadManifest();
 assert.deepEqual([...COMPILER_BACKENDS].sort(),["forge","java","llvm","net","wasm"].sort());
 for(const c of manifest.cases) assert.deepEqual([...c.backends].sort(),[...COMPILER_BACKENDS].sort());
 for(const backend of COMPILER_BACKENDS){
  const r=await runSuite({backend,requireConfigured:true});
  assert.equal(r.ok,false,backend);
  assert.equal(r.configured,false,backend);
  assert.equal(r.verified,0,backend);
  assert.equal(r.skipped,manifest.cases.length,backend);
  assert.ok(r.results.every(x=>x.status==="UNCONFIGURED"),backend);
 }
});
test("missing real tools cannot yield verification for newly admitted backends",async()=>{
 for(const backend of ["net","wasm","forge"]){
  const r=await runSuite({backend,argv:["/no/such/oreslang-compiler","{file}"],sourceSha:sha});
  assert.equal(r.ok,false,backend);
  assert.equal(r.failed,2,backend);
  assert.ok(r.results.every(x=>x.status==="SPAWN_ERROR"),backend);
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
  assert.equal(calls,2);
  assert.equal(r.ok,false);
  assert.equal(r.verified,0);
  assert.equal(r.failed,2);
  assert.equal(r.results[0].status,"EXECUTABLE_CHANGED");
  assert.equal(r.results[0].priorVerificationRevoked,true);
  assert.equal(r.results[1].status,"EXECUTABLE_CHANGED");
  assert.notEqual(r.results[1].executableSha256Before,r.results[1].executableSha256After);
 }finally{await rm(dir,{recursive:true,force:true})}
});
