import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,delimiter} from "node:path";
import {buildEvidence,verifyBuildEvidence,validatePins} from "../src/build-evidence.mjs";
import {fileURLToPath} from "node:url";
const pins=JSON.parse(await readFile(fileURLToPath(new URL("../fixtures/compiler-pins.json",import.meta.url))));
async function fixture(fn) {
 const dir=await mkdtemp(join(tmpdir(),"ores-build-artifacts-"));
 const write=async(name,value)=>{const p=join(dir,name);await writeFile(p,value);return p};
 try {
  const jar=await write("compiler.jar","compiler-bytecode"),dependency=await write("dependency.jar","runtime-dependency");
  const launcher=await write("launcher","#!/bin/sh\\nexit 0\\n");
  const runner=await write("runner","#!/bin/sh\\necho 42\\n");
  const classpath=await write("classpath.txt",dependency+"\\n");
  const native=await write("llvmc","native-compiler-binary");
  return await fn({write,jar,dependency,launcher,runner,classpath,native});
 } finally {await rm(dir,{recursive:true,force:true})}
}
const javaPaths=x=>({backend:"java",pins,toolchain:"GraalVM 25",classpathFile:x.classpath,
 paths:{"compiler-jar":x.jar,launcher:x.launcher,"runtime-runner":x.runner}});
const llvmPaths=x=>({backend:"llvm",pins,toolchain:"LLVM 19",
 paths:{"compiler-native":x.native,"runtime-runner":x.runner}});
test("pinned Java evidence hashes actual compiler jar, launcher and every runtime dependency",async()=>{
 await fixture(async x=>{
  const r=await buildEvidence(javaPaths(x));
  assert.equal(r.artifacts.length,5);
  assert.deepEqual(new Set(r.artifacts.map(x=>x.role)),
   new Set(["compiler-jar","launcher","runtime-runner","classpath-file","runtime-dependency"]));
  const proof=await verifyBuildEvidence(r,pins);
  assert.equal(proof.status,"PINNED_ARTIFACT_DIGESTS_VERIFIED");
  assert.equal(proof.certifiesIndependentAttestation,false);
 });
});
test("LLVM native compiler binary is hashed, not just its test wrapper",async()=>{
 await fixture(async x=>{const r=await buildEvidence(llvmPaths(x));
  assert.equal(r.artifacts.length,2);
  assert.equal((await verifyBuildEvidence(r,pins)).artifacts,2);
 });
});
test("substituted bytecode or dependency fails the same-run verifier",async()=>{
 await fixture(async x=>{const r=await buildEvidence(javaPaths(x));
  await writeFile(x.jar,"changed compiler bytecode");
  await assert.rejects(verifyBuildEvidence(r,pins),/hash mismatch/);
 });
 await fixture(async x=>{const r=await buildEvidence(javaPaths(x));
  await writeFile(x.dependency,"substituted runtime dependency");
  await assert.rejects(verifyBuildEvidence(r,pins),/hash mismatch/);
 });
});
test("source identity cannot be replaced by declared arbitrary SHA",async()=>{
 await fixture(async x=>{const r=await buildEvidence(llvmPaths(x));
  r.sourceCommit="a".repeat(40);
  await assert.rejects(verifyBuildEvidence(r,pins),/unpinned/);
  r.sourceCommit=pins.backends.llvm.sourceCommit;
  r.sourceInputTree="b".repeat(40);
  await assert.rejects(verifyBuildEvidence(r,pins),/unpinned/);
 });
});
test("reject missing native artifact, duplicate role, and fake attestation",async()=>{
 await fixture(async x=>{const r=await buildEvidence(llvmPaths(x));
  const absent=structuredClone(r);absent.artifacts.shift();
  await assert.rejects(verifyBuildEvidence(absent,pins),/missing required/);
  const repeated=structuredClone(r);repeated.artifacts.push({...r.artifacts[0],path:x.jar});
  await assert.rejects(verifyBuildEvidence(repeated,pins),/duplicate singleton/);
  r.claimsIndependentAttestation=true;
  await assert.rejects(verifyBuildEvidence(r,pins),/unpinned/);
 });
});
test("mismatched classpath membership and duplicate classpath members fail closed",async()=>{
 await fixture(async x=>{const r=await buildEvidence(javaPaths(x));
  const mismatch=structuredClone(r);mismatch.artifacts.find(a=>a.role==="runtime-dependency").path=x.jar;
  await assert.rejects(verifyBuildEvidence(mismatch,pins),/membership/);
  await writeFile(x.classpath,[x.dependency,x.dependency].join(delimiter));
  await assert.rejects(verifyBuildEvidence(r,pins),/hash mismatch/);
 });
});
test("validate pins rejects missing backend input trees",()=>{
 const bad=structuredClone(pins);bad.backends.llvm.sourceInputTree="";
 assert.throws(()=>validatePins(bad),/source identity/);
});
