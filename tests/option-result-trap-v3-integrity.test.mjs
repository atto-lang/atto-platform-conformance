import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {lstatSync, readdirSync} from "node:fs";
import {resolve,join,dirname,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {readPinnedRegular,verifyOptionResultTrapReceipt} from "../bin/verify-option-result-trap-receipt.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const prefix="fixtures/option-result-trap/v3/";
const names=["option_present","option_absent","option_nested_absent","result_success",
 "result_error","trap_success","trap_nested","trap_err_data","trap_cast_failure"];
const sha40=/^[a-f0-9]{40}$/;
const gitBlob=bytes=>createHash("sha1")
 .update(Buffer.from("blob "+bytes.length+"\0")).update(bytes).digest("hex");
function ensurePath(path) {
 assert.match(path,/^fixtures\/option-result-trap\/v3\/[a-z_]+\.ores$/);
 const abs=resolve(root,path);
 assert(abs.startsWith(root+sep));
 for(let parent=dirname(abs);parent!==root;parent=dirname(parent)){
   const st=lstatSync(parent);
   assert(st.isDirectory()&&!st.isSymbolicLink(),"parent symlink");
 }
 return abs;
}
function checkManifest(m,lock) {
 assert.equal(m?.schema,"oreslang.option-result-trap.scalar/v3");
 assert.equal(m?.status,"authored_not_executed");
 assert.deepEqual(m?.backends,["java","llvm","wasm","cranelift","net"]);
 assert.equal(lock?.schema,"oreslang.option-result-trap.scalar-lock/v3");
 assert.match(lock?.manifest_blob??"",sha40);
 assert.equal(m.cases?.length,9);
 assert.equal(lock.cases?.length,9);
 const ids=new Set(), paths=new Set(), pins=new Map();
 for(const pin of lock.cases){
   assert.deepEqual(Object.keys(pin).sort(),["git_blob","id","path"]);
   assert.match(pin.git_blob,sha40);
   assert(!pins.has(pin.id));
   pins.set(pin.id,pin);
 }
 for(let i=0;i<names.length;i++){
   const c=m.cases[i],name=names[i];
   assert.equal(c?.id,"ORT3-"+name.toUpperCase());
   assert.equal(c.path,prefix+name+".ores");
   assert(!ids.has(c.id)&&!paths.has(c.path));
   ids.add(c.id);paths.add(c.path);
   assert.equal(c.kind,"guest_i64");
   assert.equal(c.expected_return,"0");
   assert.equal(c.return_type,"int");
   assert.equal(c.requires_guest_execution,true);
   assert.deepEqual(pins.get(c.id),{id:c.id,path:c.path,git_blob:pins.get(c.id)?.git_blob});
 }
}
test("ORT v3 nine scalar observations and Git blobs pinned",()=>{
 const manifestBytes=readPinnedRegular(join(root,prefix+"manifest.json"));
 const m=JSON.parse(manifestBytes.toString("utf8"));
 const lock=JSON.parse(readPinnedRegular(join(root,prefix+"fixture-lock-v3.json")).toString("utf8"));
 checkManifest(m,lock);
 assert.equal(gitBlob(manifestBytes),lock.manifest_blob);
 for(const c of m.cases){
   const bytes=readPinnedRegular(ensurePath(c.path));
   assert.equal(gitBlob(bytes),lock.cases.find(x=>x.id===c.id)?.git_blob);
   const source=bytes.toString("utf8");
   assert(source.includes("pub fnc main(): int"),c.id);
   assert(source.includes("return 0;")||source.includes("return ")&&source.includes(" - "),c.id);
 }
 const entries=readdirSync(join(root,prefix),{withFileTypes:true})
   .filter(x=>x.name.endsWith(".ores"));
 assert.equal(entries.length,9);
 assert(entries.every(e=>e.isFile()&&names.includes(e.name.slice(0,-5))));
});
test("ORT v3 manifest mutations fail source inventory admission",()=>{
 const manifestBytes=readPinnedRegular(join(root,prefix+"manifest.json"));
 const m=JSON.parse(manifestBytes.toString("utf8"));
 const l=JSON.parse(readPinnedRegular(join(root,prefix+"fixture-lock-v3.json")).toString("utf8"));
 const mutations=[
   x=>x.cases.pop(),
   x=>x.cases[0].id=x.cases[1].id,
   x=>x.cases[0].expected_return="1",
   x=>x.cases[0].kind="guest_stdout",
   x=>x.cases[0].return_type="float",
   x=>x.backends[4]="forge"
 ];
 for(const mutate of mutations){
   const t=structuredClone(m);mutate(t);
   assert.throws(()=>checkManifest(t,l));
 }
});
const source="a".repeat(40),binary="b".repeat(64),digest="c".repeat(64);
const m={schema:"oreslang.option-result-trap.scalar/v3",backends:["java","llvm","wasm","cranelift","net"],
 cases:[{id:"ORT3-OPTION_PRESENT",kind:"guest_i64",return_type:"int",expected_return:"0"}]};
function receipt(){
 return {schema:"oreslang.option-result-trap.receipt/v1",backend:"llvm",
  caseId:"ORT3-OPTION_PRESENT",sourceCommit:source,stdlibCommit:source,
  compilerBinarySha256:binary,fixtureSha256:digest,runtimeVersion:"test-only",
  evidence:{exactHead:true,sourceCommit:source,runnerId:31,runAttempt:1,
   steps:["compile Oreslang guest","run Oreslang guest"],
   workflowConclusion:"success",hostReferenceOnly:false,compilerProduced:true,
   compilerExitCode:0,guestLaunched:true,guestExitCode:0,
   guestStep:"run Oreslang guest",guestReturnType:"int",guestReturnValue:"0",
   guestResultSource:"compiler_guest",stdout:"",stderr:""}};
}
const valid=r=>verifyOptionResultTrapReceipt(r,m,digest).ok;
test("ORT v3 receipt accepts structurally complete scalar guest result only",()=>{
 assert.equal(valid(receipt()),true);
});
test("ORT v3 rejects process exit without compiler guest return",()=>{
 for(const mutation of [
  r=>delete r.evidence.guestReturnValue,
  r=>r.evidence.guestReturnValue="1",
  r=>r.evidence.guestReturnValue=0,
  r=>r.evidence.guestReturnType="void",
  r=>r.evidence.guestResultSource="shell_exit",
  r=>r.evidence.guestLaunched=false,
  r=>r.evidence.guestStep="not-an-executed-step",
  r=>r.evidence.runnerId=0,
  r=>r.evidence.steps=[],
  r=>r.evidence.hostReferenceOnly=true,
  r=>r.evidence.workflowConclusion="failure",
 ]){
   const r=receipt();mutation(r);
   assert.equal(valid(r),false);
 }
});