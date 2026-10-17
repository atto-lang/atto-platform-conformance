import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,unlinkSync,symlinkSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runSuite,COMPILER_BACKENDS} from "../src/harness.mjs";

const sha="012345678901234567890123456789abcdefabcd";
const fixtureResponse=(_executable,args)=>{
 const negative=args.some(x=>x.includes("unresolved-identifier.ores"));
 return negative
  ? {status:1,stdout:"",stderr:"error: unresolved nonexistent_symbol",signal:null}
  : {status:0,stdout:"",stderr:"",signal:null};
};
async function withCompiler(fn){
 const root=mkdtempSync(join(tmpdir(),"oreslang-executable-proof-"));
 const executable=join(root,"compiler");
 writeFileSync(executable,"compiler image A");
 try{return await fn({root,executable,argv:[executable,"{file}"]})}
 finally{rmSync(root,{recursive:true,force:true})}
}

test("unchanged synthetic compiler receives executable/command/harness identity proof",async()=>
 withCompiler(async({argv})=>{
  const result=await runSuite({backend:"java",argv,sourceSha:sha,spawn:fixtureResponse});
  assert.equal(result.ok,true);
  assert.equal(result.verified,2);
  assert.equal(result.executableDriftDetected,false);
  assert.match(result.executableSha256,/^[0-9a-f]{64}$/);
  assert.match(result.commandSha256,/^[0-9a-f]{64}$/);
  assert.equal(result.harnessRuntime.node,process.version);
  assert.ok(result.results.every(x=>x.executableBeforeSha256===result.executableSha256 &&
                                 x.executableAfterSha256===result.executableSha256));
  assert.match(result.provenanceNote,/cannot attest/);
 }));

test("changed executable inside first fixture is rejected, never VERIFIED",async()=>
 withCompiler(async({executable,argv})=>{
  let count=0;
  const r=await runSuite({backend:"llvm",argv,sourceSha:sha,spawn:(...a)=>{
   if(++count===1)writeFileSync(executable,"compiler image B");
   return fixtureResponse(...a);
  }});
  assert.equal(r.executableDriftDetected,true);
  assert.equal(r.ok,false);
  assert.equal(r.verified,0);
  assert.ok(r.results.every(x=>x.status==="EXECUTABLE_CHANGED"));
 }));

test("later fixture replacement retroactively invalidates an earlier VERIFIED result",async()=>
 withCompiler(async({executable,argv})=>{
  let count=0;
  const r=await runSuite({backend:"forge",argv,sourceSha:sha,spawn:(...a)=>{
   if(++count===2)writeFileSync(executable,"compiler image B");
   return fixtureResponse(...a);
  }});
  assert.equal(r.verified,0);
  assert.equal(r.failed,2);
  assert.ok(r.results.every(x=>x.status==="EXECUTABLE_CHANGED"));
 }));

test("deleted compiler after a fixture cannot certify any result",async()=>
 withCompiler(async({executable,argv})=>{
  let count=0;
  const r=await runSuite({backend:"net",argv,sourceSha:sha,spawn:(...a)=>{
   if(++count===1)unlinkSync(executable);
   return fixtureResponse(...a);
  }});
  assert.equal(r.ok,false);
  assert.equal(r.verified,0);
  assert.equal(r.executableDriftDetected,true);
 }));

test("replace initially regular compiler with a symlink retarget is rejected",async()=>
 withCompiler(async({root,executable,argv})=>{
  const alternate=join(root,"alternative");
  writeFileSync(alternate,"compiler image B");
  let count=0;
  const r=await runSuite({backend:"wasm",argv,sourceSha:sha,spawn:(...a)=>{
   if(++count===1){unlinkSync(executable);symlinkSync(alternate,executable)}
   return fixtureResponse(...a);
  }});
  assert.equal(r.ok,false);
  assert.equal(r.verified,0);
  assert.equal(r.executableDriftDetected,true);
 }));

test("an initially symlinked executable cannot be authenticated by its target hash",async()=>
 withCompiler(async({root,executable,argv})=>{
  const real=join(root,"real");
  writeFileSync(real,"a working compiler");
  unlinkSync(executable);
  symlinkSync(real,executable);
  const r=await runSuite({backend:"java",argv,sourceSha:sha,spawn:fixtureResponse});
  assert.equal(r.ok,false);
  assert.equal(r.verified,0);
  assert.equal(r.executableSha256,null);
  assert.ok(r.results.every(x=>x.status==="UNHASHABLE_EXECUTABLE"));
 }));

test("all five backends share the mutation guard; this synthetic stub is not runtime parity",async()=>
 withCompiler(async({argv})=>{
  for(const backend of COMPILER_BACKENDS){
   const r=await runSuite({backend,argv,sourceSha:sha,spawn:fixtureResponse});
   assert.equal(r.verified,2,backend);
   assert.equal(r.executableDriftDetected,false,backend);
   assert.ok(r.results.every(x=>x.status==="VERIFIED"),backend);
  }
 }));
