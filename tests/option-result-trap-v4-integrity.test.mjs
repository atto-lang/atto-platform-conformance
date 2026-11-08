import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {lstatSync,readdirSync} from "node:fs";
import {join,resolve,dirname,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {readPinnedRegular,verifyOptionResultTrapReceipt} from "../bin/verify-option-result-trap-receipt.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const dir="fixtures/option-result-trap/v4/";
const names=["trap_ok","trap_err","trap_throw_none","trap_nested_none","trap_ok_none","trap_expr_err","trap_expr_nested","trap_panic_bypass","negative/call_no_implicit_result","negative/expr_no_implicit_result","negative/nested_no_flatten"];
const roster=["java","llvm","wasm","cranelift","net","forge","js","rust","hdl"];
const blob=b=>createHash("sha1").update(Buffer.from("blob "+b.length+"\0")).update(b).digest("hex");
const read=x=>readPinnedRegular(join(root,dir,x));
function validate(m,l){
 assert.equal(m.schema,"oreslang.option-result-trap.scalar/v4");
 assert.equal(m.status,"authored_not_executed");
 assert.deepEqual(m.backends,roster);
 assert.equal(l.schema,"oreslang.option-result-trap.scalar-lock/v4");
 assert.equal(m.cases.length,names.length);assert.equal(l.cases.length,names.length);
 for(let i=0;i<names.length;i++){
  const c=m.cases[i],p=l.cases[i],name=names[i];
  assert.equal(c.id,"ORT4-"+name.replaceAll("/","_").toUpperCase());
  assert.equal(c.path,dir+name+".ores");
  assert.deepEqual(p,{id:c.id,path:c.path,git_blob:p.git_blob});
  assert.match(p.git_blob,/^[a-f0-9]{40}$/);
  if(name==="trap_panic_bypass"){
   assert.equal(c.kind,"guest_panic");assert.equal(c.expected_diagnostic_contains,"Result");
   assert.equal(c.forbidden_stdout,"UNREACHABLE-ORT4");assert.equal(c.requires_guest_execution,true);
  }else if(name.startsWith("negative/")){
   assert.equal(c.kind,"compile_reject");assert.equal(c.expected_diagnostic_category,"type");
   assert.equal(c.must_not_launch_guest,true);
  }else{
   assert.equal(c.kind,"guest_i64");assert.equal(c.expected_return,"0");
   assert.equal(c.return_type,"int");assert.equal(c.requires_guest_execution,true);
  }
 }
}
test("ORT4: manifest, bytes, and guest cases locked to SHA-1 Git blobs",()=>{
 const mb=read("manifest.json"),m=JSON.parse(mb.toString("utf8"));
 const l=JSON.parse(read("fixture-lock-v4.json").toString("utf8"));
 validate(m,l);assert.equal(blob(mb),l.manifest_blob);
 for(let i=0;i<names.length;i++){
  const rel=names[i]+".ores",full=resolve(root,dir,rel);
  assert(full.startsWith(root+sep));
  for(let p=dirname(full);p!==root;p=dirname(p)){const st=lstatSync(p);assert(st.isDirectory()&&!st.isSymbolicLink());}
  const b=read(rel);assert.equal(blob(b),l.cases[i].git_blob);
  assert(b.toString("utf8").includes(m.cases[i].id));
 }
 const list=p=>readdirSync(join(root,dir,p),{withFileTypes:true})
  .filter(x=>x.name.endsWith(".ores")).map(x=>x.name).sort();
 assert.deepEqual(list(""),names.filter(x=>!x.startsWith("negative/")).map(x=>x+".ores").sort());
 assert.deepEqual(list("negative"),names.filter(x=>x.startsWith("negative/")).map(x=>x.slice(9)+".ores").sort());
});
test("ORT4: manifest mutation of semantics/roster rejected",()=>{
 const m=JSON.parse(read("manifest.json").toString("utf8")),l=JSON.parse(read("fixture-lock-v4.json").toString("utf8"));
 for(const mutate of [
  x=>x.cases.pop(),x=>x.cases[0].id=x.cases[1].id,
  x=>x.cases[0].expected_return="1",x=>x.cases[0].kind="compile_reject",
  x=>x.backends.pop(),x=>x.status="certified",x=>x.cases.at(-1).must_not_launch_guest=false
 ]){const n=structuredClone(m);mutate(n);assert.throws(()=>validate(n,l));}
});
const sha="a".repeat(40),digest="c".repeat(64);
const m={schema:"oreslang.option-result-trap.scalar/v4",backends:roster,cases:[
 {id:"ORT4-TRAP_ERR",kind:"guest_i64",expected_return:"0",return_type:"int"},
 {id:"ORT4-TRAP_PANIC_BYPASS",kind:"guest_panic",expected_diagnostic_contains:"Result",forbidden_stdout:"UNREACHABLE-ORT4"},
 {id:"ORT4-NEGATIVE_CALL_NO_IMPLICIT_RESULT",kind:"compile_reject",expected_diagnostic_category:"type"}
]};
const receipt=()=>({schema:"oreslang.option-result-trap.receipt/v1",backend:"java",caseId:"ORT4-TRAP_ERR",sourceCommit:sha,stdlibCommit:sha,
 compilerBinarySha256:"b".repeat(64),fixtureSha256:digest,runtimeVersion:"shape-only",
 evidence:{exactHead:true,sourceCommit:sha,runnerId:1,runAttempt:1,steps:["compile","execute"],
 workflowConclusion:"success",hostReferenceOnly:false,compilerProduced:true,compilerExitCode:0,guestLaunched:true,guestExitCode:0,
 guestStep:"execute",guestReturnType:"int",guestReturnValue:"0",guestResultSource:"compiler_guest",stdout:"",stderr:""}});
const valid=r=>verifyOptionResultTrapReceipt(r,m,digest).ok;
test("ORT4: syntactically valid guest receipt remains only SHAPE_VALID",()=>assert(valid(receipt())));
test("ORT4: scalar receipt fails closed for forged/unexecuted fields",()=>{
 for(const change of [
  r=>r.evidence.steps=[],r=>r.evidence.runnerId=0,r=>r.evidence.hostReferenceOnly=true,
  r=>r.evidence.compilerProduced=false,r=>r.evidence.guestResultSource="shell_exit",
  r=>r.evidence.guestLaunched=false,r=>r.evidence.guestReturnValue="1",
  r=>delete r.evidence.guestReturnValue,r=>r.evidence.guestStep="not-run",
  r=>r.evidence.sourceCommit="0".repeat(40),r=>r.fixtureSha256="0".repeat(64),
  r=>r.evidence.workflowConclusion="failure",r=>r.backend="unknown"
 ]){const r=receipt();change(r);assert(!valid(r),change.toString());}
});
test("ORT4: panic bypass cannot be accepted as normal return",()=>{
 const p=receipt();p.caseId="ORT4-TRAP_PANIC_BYPASS";
 Object.assign(p.evidence,{guestExitCode:1,runtimeControl:"guest_panic",stderr:"Result.unwrap Err",stdout:""});
 assert(valid(p));
 for(const change of [
  r=>r.evidence.guestExitCode=0,r=>r.evidence.runtimeControl="success",
  r=>r.evidence.stdout="UNREACHABLE-ORT4",r=>r.evidence.stderr="not an unwrap"
 ]){const r=structuredClone(p);change(r);assert(!valid(r));}
});
test("ORT4: compile rejection must be semantic type, not parser unsupported",()=>{
 const r=receipt();r.caseId="ORT4-NEGATIVE_CALL_NO_IMPLICIT_RESULT";
 Object.assign(r.evidence,{compilerExitCode:1,guestLaunched:false,guestExitCode:null,
 guestStep:null,diagnosticCategory:"type",stdout:"",stderr:"type mismatch"});
 assert(valid(r));
 for(const change of [
  p=>p.evidence.diagnosticCategory="syntax",p=>p.evidence.guestLaunched=true,
  p=>p.evidence.stderr="",p=>p.evidence.compilerExitCode=0
 ]){const n=structuredClone(r);change(n);assert(!valid(n));}
});
