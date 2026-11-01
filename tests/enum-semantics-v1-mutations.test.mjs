import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {validateEnumManifest,validateEnumFiles} from "../lib/enum-semantics-v1-policy.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const m=JSON.parse(readFileSync(resolve(root,"contracts/enum-semantics-v1.json"),"utf8"));
const mutations=[
 ["duplicate contract rule",x=>{x.cases[1].rule=x.cases[0].rule;}],
 ["duplicate source blob",x=>{x.cases[1].sourceGitBlobSha1=x.cases[0].sourceGitBlobSha1;}],
 ["fabricated confirmed backend",x=>{x.cases[0].confirmedBackends=["java"];}],
 ["fabricated global parity",x=>{x.executableParityCertified=true;}],
 ["unknown backend",x=>{x.cases[0].backends=["java","llvm","wasm","net","phantom"];}],
 ["path traversal",x=>{x.cases[0].file="../escape.ores";}],
 ["case-to-file identity spoof",x=>{x.cases[0].file=x.cases[1].file;}],
 ["duplicate id",x=>{x.cases[1].id=x.cases[0].id;}],
 ["out-of-band case attestation",x=>{x.cases[0].attested=true;}],
 ["out-of-band top-level metadata",x=>{x.attested=true;}],
 ["unexpected diagnostic on success",x=>{x.cases[0].diagnosticCategory="NONE";}],
 ["unexpected output on rejection",x=>{x.cases[3].expectedStdout="1\n";}],
 ["invalid expected stdout",x=>{x.cases[0].expectedStdout="success";}],
 ["missing fixture case",x=>{x.cases.pop();}],
 ["malformed non-boolean certification",x=>{x.executableParityCertified="false";}]
];
for(const [name,mutate] of mutations) {
 test("enum inventory fail-closed mutation: "+name,()=>{
  const copy=structuredClone(m);mutate(copy);
  assert.throws(()=>validateEnumManifest(copy));
 });
}
test("enum inventory detects added, uninventoried fixture",()=>{
 const dir=mkdtempSync(join(tmpdir(),"ores-enum-"));
 try {
  const dest=resolve(dir,"fixtures/enum/v1");mkdirSync(dest,{recursive:true});
  for(const c of m.cases)copyFileSync(resolve(root,"fixtures/enum/v1",c.file),resolve(dest,c.file));
  writeFileSync(resolve(dest,"untracked.ores"),"define enum Fake as Case end\n");
  assert.throws(()=>validateEnumFiles(dir,m));
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test("enum inventory rejects forged Git-blob commitment",()=>{
 const copy=structuredClone(m);copy.cases[0].sourceGitBlobSha1="0".repeat(40);
 assert.throws(()=>validateEnumFiles(root,copy));
});
