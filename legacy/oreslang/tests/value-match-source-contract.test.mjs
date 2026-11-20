import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";

const root=new URL("../fixtures/value-match/v1/",import.meta.url);
const manifest=JSON.parse(await readFile(new URL("manifest.json",root),"utf8"));
const expected=new Map([
 ["value-option-braced.ores","accept"],
 ["value-vs-procedural.ores","accept"],
 ["value-guard-over-end.ores","accept"],
 ["reject-nonexhaustive.ores","reject"],
 ["reject-mismatched-types.ores","reject"],
 ["reject-no-value.ores","reject"]
]);
test("value match source inventory is closed and all backend claims pending",()=>{
 assert.equal(manifest.schemaVersion,1);
 assert.equal(manifest.scope,"value-match-expression-v1");
 assert.equal(manifest.cases.length,expected.size);
 const names=new Set();
 for(const entry of manifest.cases){
  assert.equal(names.has(entry.file),false,"duplicate file "+entry.file);
  names.add(entry.file);
  assert.equal(entry.id,entry.file.slice(0,-5));
  assert.equal(entry.expect,expected.get(entry.file));
  assert.match(entry.sourceGitBlobSha1,/^[a-f0-9]{40}$/);
  assert.deepEqual(entry.confirmedBackends,[]);
  assert.deepEqual(entry.pendingBackends,["java-graalvm","llvm","wasm","browser-worker"]);
 }
 assert.deepEqual([...names].sort(),[...expected.keys()].sort());
 assert.equal(manifest.evidence.exactFixtureExecution,false);
});
test("value match fixture Git blob integrity",async()=>{
 for(const entry of manifest.cases){
  const bytes=await readFile(new URL(entry.file,root));
  const sha=createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
  assert.equal(sha,entry.sourceGitBlobSha1,entry.file);
  const source=bytes.toString("utf8");
  assert.ok(source.includes("match "),"match missing "+entry.file);
  assert.ok(source.includes("return"),"explicit return missing "+entry.file);
 }
});
test("value-producing versus procedural source examples remain distinct",async()=>{
 const value=await readFile(new URL("value-option-braced.ores",root),"utf8");
 const both=await readFile(new URL("value-vs-procedural.ores",root),"utf8");
 assert.match(value,/return match value over/);
 assert.match(both,/val int x = match input over/);
 assert.match(both,/do match input over/);
 const missing=await readFile(new URL("reject-no-value.ores",root),"utf8");
 assert.match(missing,/on Some\(n\) \{ return; \}/);
});


const BACKENDS=["java-graalvm","llvm","wasm","browser-worker"];
function strictKeys(value,keys) {
 assert.ok(value!==null&&typeof value==="object"&&!Array.isArray(value));
 assert.deepEqual(Object.keys(value).sort(),keys.slice().sort(),"unexpected or missing metadata keys");
}
function assertStrictManifest(m) {
 strictKeys(m,["schemaVersion","scope","cases","languageContract","evidence"]);
 assert.equal(m.schemaVersion,1);
 assert.equal(m.scope,"value-match-expression-v1");
 assert.ok(Array.isArray(m.cases));
 assert.equal(m.cases.length,expected.size);
 const files=new Set(),blobs=new Set(),ids=new Set();
 for(const e of m.cases){
  strictKeys(e,["id","file","sourceGitBlobSha1","expect","confirmedBackends","pendingBackends"]);
  assert.ok(expected.has(e.file),"unknown fixture "+e.file);
  assert.equal(e.id,e.file.slice(0,-5));
  assert.equal(e.expect,expected.get(e.file));
  assert.match(e.sourceGitBlobSha1,/^[a-f0-9]{40}$/);
  assert.ok(!files.has(e.file),"duplicate fixture");
  assert.ok(!ids.has(e.id),"duplicate fixture id");
  assert.ok(!blobs.has(e.sourceGitBlobSha1),"reused fixture source blob");
  assert.deepEqual(e.confirmedBackends,[],"backend claim requires exact fixture execution");
  assert.deepEqual(e.pendingBackends,BACKENDS);
  files.add(e.file);ids.add(e.id);blobs.add(e.sourceGitBlobSha1);
 }
 assert.deepEqual([...files].sort(),[...expected.keys()].sort());
 strictKeys(m.evidence,["referenceJavaPr","relatedMavenRun","exactFixtureExecution"]);
 assert.equal(m.evidence.exactFixtureExecution,false,"fixture evidence cannot masquerade as compiler execution");
 strictKeys(m.languageContract,["valueMatch","proceduralDoMatch","nominalActorMessages"]);
 for(const field of Object.values(m.languageContract))
  assert.ok(typeof field==="string"&&field.length>0);
 return true;
}
function executableTokens(src){
 assert.ok(typeof src==="string"&&src.length>0&&src.length<=65536);
 const t=[];let i=0;
 while(i<src.length){
  const c=src[i],n=src[i+1];
  if(/\s/.test(c)){i++;continue}
  if(c==="/"&&n==="/"){i+=2;while(i<src.length&&src[i]!=="\n")i++;continue}
  if(c==="/"&&n==="*"){const end=src.indexOf("*/",i+2);assert.ok(end>=0,"unclosed comment");i=end+2;continue}
  if(c==='"'||c==="'"){
   const start=i++;let closed=false;
   while(i<src.length){
    if(src[i]==="\\"){assert.ok(i+1<src.length);i+=2;continue}
    if(src[i]===c){i++;closed=true;break}
    i++;
   }
   assert.ok(closed,"unclosed quote");t.push(src.slice(start,i));continue;
  }
  if(/[A-Za-z_]/.test(c)){const start=i++;while(i<src.length&&/[A-Za-z0-9_]/.test(src[i]))i++;t.push(src.slice(start,i));continue}
  if(/[0-9]/.test(c)){const start=i++;while(i<src.length&&/[0-9]/.test(src[i]))i++;t.push(src.slice(start,i));continue}
  if(c==="-"&&n===">"){t.push("->");i+=2;continue}
  t.push(c);i++;
 }
 const stack=[],closers=new Map([[")","("],["}","{"],["]","["]]);
 for(const token of t){
  if(["(","{","["].includes(token))stack.push(token);
  else if(closers.has(token))assert.equal(stack.pop(),closers.get(token),"unbalanced delimiters");
 }
 assert.equal(stack.length,0,"unclosed delimiter");
 return t;
}
function has(t,...pattern){return t.some((_,i)=>pattern.every((v,j)=>t[i+j]===v))}
function assertSourceShape(file,src){
 assert.ok(expected.has(file));
 const t=executableTokens(src);
 // A token-level inventory is not a compiler, but it must never accept
 // fixtures with missing "over", changed match operands or injected matches.
 const introductions={
  "value-option-braced.ores":[["return","match","value","over","{"]],
  "value-vs-procedural.ores":[["val","int","x","=","match","input","over","{"],["do","match","input","over","{"]],
  "value-guard-over-end.ores":[["return","match","value","over"]],
  "reject-nonexhaustive.ores":[["return","match","input","over","{"]],
  "reject-mismatched-types.ores":[["return","match","input","over","{"]],
  "reject-no-value.ores":[["return","match","input","over","{"]]
 };
 assert.equal(t.filter(x=>x==="match").length,introductions[file].length,
  "unexpected extra or missing executable match construct");
 for(const intro of introductions[file]){
  assert.ok(has(t,...intro),"invalid or spoofed match introduction: "+file);
 }
 assert.ok(has(t,"match")&&has(t,"return"),"missing executable match or return");
 if(file!=="value-vs-procedural.ores")assert.ok(has(t,"return","match"),"missing return match");
 switch(file){
  case "value-option-braced.ores":
   assert.ok(has(t,"on","Some","(")&&has(t,"on","None","{"));break;
  case "value-vs-procedural.ores":
   assert.ok(has(t,"=","match")&&has(t,"do","match"),"missing executable expression or procedure");break;
  case "value-guard-over-end.ores":
   assert.ok(has(t,"on","int","n","when")&&has(t,"on","_","->")&&has(t,"end",";"));break;
  case "reject-nonexhaustive.ores":
   assert.ok(has(t,"on","Some","(")&&!has(t,"on","None")&&!has(t,"on","_"));break;
  case "reject-mismatched-types.ores":
   assert.ok(has(t,"on","true","{")&&has(t,"on","false","{")&&has(t,"return",'"wrong"',";"));break;
  case "reject-no-value.ores":
   assert.ok(has(t,"on","Some","(","n",")","{","return",";","}")&&has(t,"on","None","{","return","0",";","}"));break;
 }
 return true;
}
test("closed manifest rejects forged backend proof, duplicate blobs and mislabeled fixtures",()=>{
 assert.equal(assertStrictManifest(manifest),true);
 const clone=()=>structuredClone(manifest);
 const mutations=[
  m=>{m.evidence.exactFixtureExecution=true},
  m=>{m.cases[0].confirmedBackends=["java-graalvm"]},
  m=>{m.cases[0].pendingBackends=[]},
  m=>{m.cases[0].sourceGitBlobSha1=m.cases[1].sourceGitBlobSha1},
  m=>{m.cases[0].file="../external.ores"},
  m=>{m.cases[0].expect="reject"},
  m=>{m.cases[0].unreviewed=true},
  m=>{m.cases.push({...m.cases[0]})},
  m=>{m.evidence.unverifiedBackend="llvm"},
  m=>{delete m.cases[0].sourceGitBlobSha1}
 ];
 for(const mutate of mutations){const m=clone();mutate(m);assert.throws(()=>assertStrictManifest(m))}
});
test("executable fixture syntax cannot be spoofed by comments or string literals",async()=>{
 const read=async file=>readFile(new URL(file,root),"utf8");
 for(const file of expected.keys())assert.equal(assertSourceShape(file,await read(file)),true);
 const mutations=[
  ["value-option-braced.ores",s=>s.replace("return match value over","/* return match value over */ return value")],
  ["value-vs-procedural.ores",s=>s.replace("do match input over",'"do match input over"')],
  ["value-guard-over-end.ores",s=>s.replace("on int n when","/* on int n when */ on _ when")],
  ["reject-nonexhaustive.ores",s=>s.replace("on Some(n)", "on None")],
  ["reject-mismatched-types.ores",s=>s.replace('"wrong"','"valid"')],
  ["reject-no-value.ores",s=>s.replace("return;", "/* return; */")],
  ["value-option-braced.ores",s=>s+" /* unterminated"],
  ["value-option-braced.ores",s=>s+" {"],
  // Previously undetected false positives: missing over, changed operands,
  // an extra executable match and a procedural arm targeting another value.
  ["value-option-braced.ores",s=>s.replace("return match value over","return match value")],
  ["value-option-braced.ores",s=>s.replace("return match value over","return match other over")],
  ["value-option-braced.ores",s=>s.replace("return match value over","return match value over /* decoy */ match")],
  ["value-vs-procedural.ores",s=>s.replace("do match input over","do match other over")],
  ["value-vs-procedural.ores",s=>s.replace("val int x = match input over","val int x = match input")],
  ["value-guard-over-end.ores",s=>s.replace("return match value over","return match other over")],
  ["reject-nonexhaustive.ores",s=>s.replace("return match input over","return match input")],
  ["reject-no-value.ores",s=>s.replace("return match input over","return match other over")]
 ];
 for(const [file,mutate] of mutations){
  const src=await read(file),altered=mutate(src);
  assert.notEqual(altered,src);
  assert.throws(()=>assertSourceShape(file,altered),"escaped mutation "+file);
 }
});
