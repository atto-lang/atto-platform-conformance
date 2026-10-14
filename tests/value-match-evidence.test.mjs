import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {basename} from "node:path";
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
