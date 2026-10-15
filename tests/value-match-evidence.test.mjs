import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,unlinkSync,symlinkSync} from "node:fs";
import {basename,dirname} from "node:path";
import {createHash} from "node:crypto";
import {runValueMatchEvidence,validateEvidenceCommand} from "../src/value-match-evidence.mjs";

const sha="012345678901234567890123456789abcdefabcd";
const check=[process.execPath,"--check","{file}"];
const run=[process.execPath,"--run","{file}"];
const diagnostics={
 "reject-no-value.ores":"oreslang: value match arms require exactly one return expression",
 "reject-nonexhaustive.ores":"oreslang: non-exhaustive match for Option<int>",
 "reject-mismatched-types.ores":"oreslang: incompatible value match arm result type"
};
const expected={"value-option-braced.ores":"42:0","value-vs-procedural.ores":"142:42","guard-with-entrypoint.ores":"42:0:0:2"};
const ok=(stdout="")=>({status:0,signal:null,stdout,stderr:""});
const bad=stderr=>({status:1,signal:null,stdout:"",stderr});
const fixtureMock=(exe,args)=>{
 const p=basename(args.at(-1));
 if(args.includes("--check"))return diagnostics[p]?bad(diagnostics[p]):ok();
 if(args.includes("--run"))return ok(expected[p]);
 throw Error("unexpected mock arguments");
};
const invoke=(overrides={})=>runValueMatchEvidence({backend:"java-graalvm",sourceSha:sha,checkArgv:check,runArgv:run,spawn:fixtureMock,...overrides});

test("unconfigured backend remains pending; no backend confirmation is invented",async()=>{
 const r=await runValueMatchEvidence({backend:"llvm"});
 assert.equal(r.ok,false);
 assert.equal(r.attested,false);
 assert.deepEqual(r.confirmedBackends,[]);
 assert.equal(r.results.length,6);
 assert.ok(r.results.every(x=>x.status==="UNCONFIGURED"));
});
test("simulated compiler/run callbacks verify the harness algorithm, never real backend parity",async()=>{
 const r=await invoke();
 assert.equal(r.ok,true);
 assert.equal(r.simulated,true);
 assert.equal(r.attested,false);
 assert.deepEqual(r.confirmedBackends,[]);
 assert.equal(r.checksPassed,6);
 assert.equal(r.runsPassed,3);
 assert.equal(r.results.filter(x=>x.status==="VERIFIED_REJECTION").length,3);
 assert.equal(r.results.filter(x=>x.status==="VERIFIED_OUTPUT").length,3);
 assert.match(r.executableSha256[0],/^[a-f0-9]{64}$/);
 assert.match(r.provenanceNote,/not independently attested/);
});
test("guard uses unmodified fixture plus explicitly supplemental runtime entrypoint",async()=>{
 let saw=false;
 const spawn=(exe,args)=>{
  const file=args.at(-1);
  if(args.includes("--run")&&basename(file)==="guard-with-entrypoint.ores"){
   const program=readFileSync(file,"utf8");
   assert.match(program,/fnc compute\(int value\): int/);
   assert.match(program,/compute\(41\)/);
   assert.match(program,/compute\(-3\)/);
   saw=true;
  }
  return fixtureMock(exe,args);
 };
 const r=await invoke({spawn});
 assert.equal(r.ok,true);
 assert.equal(saw,true);
 assert.equal(r.results.find(x=>x.id==="value-guard-over-end").supplementalHarness,true);
 assert.equal(r.results.find(x=>x.id==="value-option-braced").supplementalHarness,false);
});
test("stdout comparison is byte-exact; extra newline must not count",async()=>{
 const spawn=(exe,args)=>{
  const x=fixtureMock(exe,args);
  if(args.includes("--run")&&basename(args.at(-1))==="value-option-braced.ores")return ok("42:0\n");
  return x;
 };
 const r=await invoke({spawn});
 assert.equal(r.ok,false);
 assert.equal(r.runsPassed,2);
 assert.equal(r.results[0].status,"OUTPUT_MISMATCH");
});
test("unsupported language, wrong diagnostic, and generic crashes cannot pass as semantic rejection",async()=>{
 for(const stderr of ["error: unsupported match", "disk failure","error: non-exhaustive match",
   "fatal error: value match arms require exactly one"]){
  const spawn=(exe,args)=>{
   if(args.includes("--check")&&basename(args.at(-1))==="reject-no-value.ores")return bad(stderr);
   return fixtureMock(exe,args);
  };
  const r=await invoke({spawn});
  assert.equal(r.ok,false,stderr);
  assert.equal(r.results.find(x=>x.id==="reject-no-value").status,stderr.startsWith("fatal")?"CRASH":"CHECK_MISMATCH");
 }
});
test("timeout, signal and absent executable cannot pass as expected rejection",async()=>{
 for(const p of [{status:null,signal:null,error:{code:"ETIMEDOUT"}},
                 {status:null,signal:"SIGKILL",stderr:""},
                 {status:null,signal:null,error:{code:"ENOENT"}}]){
  const spawn=(exe,args)=>{
   if(args.includes("--check")&&basename(args.at(-1))==="reject-no-value.ores")return p;
   return fixtureMock(exe,args);
  };
  const r=await invoke({spawn});
  assert.equal(r.ok,false);
  assert.notEqual(r.results.find(x=>x.id==="reject-no-value").status,"VERIFIED_REJECTION");
 }
});
test("admission is not equivalent to runtime: both commands are mandatory",async()=>{
 const r=await runValueMatchEvidence({backend:"java-graalvm",sourceSha:sha,checkArgv:check});
 assert.equal(r.ok,false);
 assert.ok(r.results.every(x=>x.status==="UNCONFIGURED"));
});
test("source SHA, backend, argv and timeout must all be validated",async()=>{
 await assert.rejects(invoke({sourceSha:"invalid"}),/source SHA/);
 await assert.rejects(invoke({backend:"not-llvm"}),/unknown backend/);
 await assert.rejects(invoke({timeoutMs:99}),/timeout/);
 await assert.rejects(invoke({checkArgv:["/usr/bin/env","--check","--file={file}"]}),/standalone/);
 for(const argv of [["node","{file}"],[],["/bin/echo","{file}","{file}"],
   ["/bin/echo","{file}","{output}"],["/bin/echo","bad\0arg","{file}"]]){
  assert.throws(()=>validateEvidenceCommand(argv));
 }
});

test("checker receives private, immutable staged bytes rather than the original source path",async()=>{
 let checks=0,runs=0;
 const spawn=(exe,args)=>{
  const file=args.at(-1),base=basename(file);
  assert.match(dirname(file),/ores-vmatch-/,"backend did not receive a private snapshot");
  if(base.endsWith(".ores")&&base!=="guard-with-entrypoint.ores"){
   const canonical=new URL("../fixtures/value-match/v1/"+base,import.meta.url);
   const expected=readFileSync(canonical),observed=readFileSync(file);
   assert.deepEqual(observed,expected,"backend source differs from SHA-pinned bytes");
   if(args.includes("--check"))checks++;
   else runs++;
  }
  return fixtureMock(exe,args);
 };
 const r=await invoke({spawn});
 assert.equal(r.ok,true);
 assert.equal(checks,6);
 assert.equal(runs,2);
 for(const item of r.results)assert.match(item.fixtureSha256,/^[0-9a-f]{64}$/);
});
test("negative source errors appearing only on stdout are never compiler proof",async()=>{
 const spawn=(exe,args)=>{
  if(args.includes("--check")&&basename(args.at(-1))==="reject-no-value.ores")
   return {status:1,signal:null,stdout:diagnostics["reject-no-value.ores"],stderr:""};
  return fixtureMock(exe,args);
 };
 const r=await invoke({spawn});
 assert.equal(r.ok,false);
 assert.equal(r.results.find(x=>x.id==="reject-no-value").status,"CHECK_MISMATCH");
});
test("successful exit with compiler errors on stderr never counts as admitted or executed",async()=>{
 for(const phase of ["--check","--run"]){
  const spawn=(exe,args)=>{
   const file=basename(args.at(-1));
   if(args.includes(phase)&&file==="value-option-braced.ores"){
    return {status:0,signal:null,
      stdout:phase==="--run"?"42:0":"",
      stderr:"error: value match arm type mismatch"};
   }
   return fixtureMock(exe,args);
  };
  const r=await invoke({spawn});
  assert.equal(r.ok,false,phase);
  assert.equal(r.results.find(x=>x.id==="value-option-braced").status,
   phase==="--check"?"CHECK_MISMATCH":"OUTPUT_MISMATCH");
 }
});
test("rejections emitting extraneous stdout do not satisfy exact compiler contract",async()=>{
 const spawn=(exe,args)=>{
  if(args.includes("--check")&&basename(args.at(-1))==="reject-no-value.ores")
   return {status:1,signal:null,stdout:"partial guest output",
     stderr:diagnostics["reject-no-value.ores"]};
  return fixtureMock(exe,args);
 };
 const r=await invoke({spawn});
 assert.equal(r.ok,false);
 assert.equal(r.results.find(x=>x.id==="reject-no-value").status,"CHECK_MISMATCH");
});
test("runtime stdout matching expected output is not green if it also reports a crash",async()=>{
 const spawn=(exe,args)=>{
  if(args.includes("--run")&&basename(args.at(-1))==="value-option-braced.ores")
   return {status:0,signal:null,stdout:"42:0",stderr:"assertion failed"};
  return fixtureMock(exe,args);
 };
 const r=await invoke({spawn});
 assert.equal(r.ok,false);
 assert.equal(r.results[0].status,"CRASH");
});

test("check and runtime use separate verified byte snapshots for all runnable positives",async()=>{
 const paths=new Map();
 const spawn=(exe,args)=>{
  const file=args.at(-1),name=basename(file);
  if(args.includes("--check")&&["value-option-braced.ores","value-vs-procedural.ores","value-guard-over-end.ores"].includes(name)){
   paths.set(name,file);
  }
  if(args.includes("--run")&&name!=="guard-with-entrypoint.ores"){
   assert.notEqual(file,paths.get(name),"runtime reused check-stage input");
   assert.deepEqual(readFileSync(file),readFileSync(new URL("../fixtures/value-match/v1/"+name,import.meta.url)));
  }
  if(args.includes("--run")&&name==="guard-with-entrypoint.ores")
   assert.notEqual(file,paths.get("value-guard-over-end.ores"));
  return fixtureMock(exe,args);
 };
 const result=await invoke({spawn});
 assert.equal(result.ok,true);
 assert.equal(result.runsPassed,3);
});
test("checker source mutation is detected even if it returns a successful verdict",async()=>{
 let runtimeCalled=false;
 const spawn=(exe,args)=>{
  const name=basename(args.at(-1));
  if(name==="value-option-braced.ores"&&args.includes("--check")){
   writeFileSync(args.at(-1),"pub fnc main(): void { return; }");
   return ok();
  }
  if(name==="value-option-braced.ores"&&args.includes("--run"))runtimeCalled=true;
  return fixtureMock(exe,args);
 };
 const r=await invoke({spawn});
 assert.equal(r.ok,false);
 assert.equal(runtimeCalled,false);
 assert.equal(r.results[0].status,"SOURCE_MUTATED");
 assert.equal(r.checksPassed,5);
 assert.equal(r.runsPassed,2);
});
test("checker cannot silently replace input with a symlink and claim proof",async()=>{
 const spawn=(exe,args)=>{
  if(args.includes("--check")&&basename(args.at(-1))==="value-option-braced.ores"){
   unlinkSync(args.at(-1));
   symlinkSync(new URL("../fixtures/value-match/v1/value-option-braced.ores",import.meta.url).pathname,args.at(-1));
   return ok();
  }
  return fixtureMock(exe,args);
 };
 const r=await invoke({spawn});
 assert.equal(r.ok,false);
 assert.equal(r.results[0].status,"SOURCE_MUTATED");
});
test("runtime source mutation invalidates a coincidentally correct output",async()=>{
 const spawn=(exe,args)=>{
  if(args.includes("--run")&&basename(args.at(-1))==="value-option-braced.ores"){
   writeFileSync(args.at(-1),"pub fnc main(): void { return; }");
   return ok("42:0");
  }
  return fixtureMock(exe,args);
 };
 const r=await invoke({spawn});
 assert.equal(r.ok,false);
 assert.equal(r.results[0].status,"SOURCE_MUTATED");
 assert.equal(r.runsPassed,2);
});
test("old PR930 compiler syntax errors never qualify as semantic match evidence",async()=>{
 let totalRunCalls=0;
 const spawn=(exe,args)=>{
  if(args.includes("--check"))return bad("Oreslang parse error at 2:10: expected expression");
  totalRunCalls++;
  return fixtureMock(exe,args);
 };
 const r=await invoke({spawn});
 assert.equal(r.ok,false);
 assert.equal(r.checksPassed,0);
 assert.equal(r.runsPassed,0);
 assert.equal(totalRunCalls,0);
 assert.ok(r.results.every(x=>x.status==="CHECK_MISMATCH"));
 assert.deepEqual(r.confirmedBackends,[]);
 assert.equal(r.attested,false);
});
