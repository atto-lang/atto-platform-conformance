import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
import {validateEnumFiles} from "../lib/enum-semantics-v1-policy.mjs";

// The six-backend profile is additive: preserve the older five-backend v1
// file unchanged, rather than silently changing its public schema.
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const load=name=>JSON.parse(readFileSync(resolve(root,"contracts",name),"utf8"));
const source=load("enum-semantics-v1.json");
const target=load("enum-semantics-v2.json");
const BACKENDS=Object.freeze(["java","llvm","wasm","net","cranelift","forge"]);

export function validateSixBackendAdt(v1,v2){
 assert.deepEqual(Object.keys(v2).sort(),
  ["schemaVersion","scope","executableParityCertified","backends","cases"].sort());
 assert.equal(v2.schemaVersion,2);
 assert.equal(v2.scope,"nominal-enum-source-v2-six-backend");
 assert.equal(v2.executableParityCertified,false);
 assert.deepEqual(v2.backends,BACKENDS);
 assert.equal(v1.schemaVersion,1);
 assert.deepEqual(v1.backends,["java","llvm","wasm","net","forge"]);
 assert.equal(v1.executableParityCertified,false);
 assert.equal(v1.cases.length,36);
 assert.equal(v2.cases.length,v1.cases.length);
 const names=new Set(),rules=new Set(),hashes=new Set();
 for(let i=0;i<v2.cases.length;i++){
  const old=v1.cases[i],entry=v2.cases[i];
  assert.ok(entry!==null&&typeof entry==="object"&&!Array.isArray(entry));
  assert.deepEqual(Object.keys(entry).sort(),Object.keys(old).sort());
  assert.deepEqual(entry.backends,BACKENDS);
  assert.deepEqual(entry.confirmedBackends,[]);
  const projection={...entry,backends:old.backends,confirmedBackends:old.confirmedBackends};
  assert.deepEqual(projection,old,"six-backend fixture semantics/sha drifted: "+old.id);
  assert.equal(entry.file,entry.id+".ores");
  assert.equal(names.has(entry.id),false);
  assert.equal(rules.has(entry.rule),false);
  assert.equal(hashes.has(entry.sourceGitBlobSha1),false);
  names.add(entry.id);rules.add(entry.rule);hashes.add(entry.sourceGitBlobSha1);
 }
 assert.equal(v2.cases.filter(c=>c.expect==="accept").length,8);
 assert.equal(v2.cases.filter(c=>c.expect==="reject").length,28);
}
test("six-backend ADT fixture manifest is byte- and semantic-equivalent to v1",()=>{
 validateEnumFiles(root,source);
 validateSixBackendAdt(source,target);
});
for(const [label,mutate] of [
 ["fake parity flag",m=>{m.executableParityCertified=true;}],
 ["cranelift removed",m=>{m.backends=m.backends.filter(x=>x!=="cranelift");}],
 ["cranelift duplicated",m=>{m.backends.push("cranelift");}],
 ["unexpected backend",m=>{m.backends.push("other");}],
 ["fake guest pass",m=>{m.cases[0].confirmedBackends=["cranelift"];}],
 ["unknown attestation field",m=>{m.cases[0].guestPass=true;}],
 ["case reordering",m=>{[m.cases[0],m.cases[1]]=[m.cases[1],m.cases[0]];}],
 ["source blob spoof",m=>{m.cases[0].sourceGitBlobSha1="0".repeat(40);}],
 ["stdout spoof",m=>{m.cases[0].expectedStdout="99\\n";}],
 ["negative diagnostic spoof",m=>{m.cases.find(c=>c.expect==="reject").diagnosticCategory="UNKNOWN";}],
 ["case backend downgrade",m=>{m.cases[0].backends=["java","llvm","wasm","net","forge"];}],
 ["extra case",m=>{m.cases.push(structuredClone(m.cases[0]));}],
 ["silent acceptance flip",m=>{m.cases[0].expect="reject";}],
 ["missing expected case",m=>{m.cases.pop();}]
]){
 test("six-backend ADT fail-closed mutation: "+label,()=>{
  const changed=structuredClone(target);mutate(changed);
  assert.throws(()=>validateSixBackendAdt(source,changed));
 });
}
