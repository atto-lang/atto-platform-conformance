import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
const script=fileURLToPath(new URL("../bin/wasm-core-conformance.mjs",import.meta.url));
test("cross-repo Wasm gate requires every exact artifact input",()=>{
 for(const argv of [
  [],
  ["--wasm=x","--manifest=x","--browser-module=x","--expected-i64=42"],
  ["--wasm=/missing","--manifest=/missing","--browser-module=/missing","--expected-i64=notanumber"]
 ]){
  const r=spawnSync(process.execPath,[script,...argv],{encoding:"utf8"});
  assert.notEqual(r.status,0);
 }
});
test("real Oreslang LLVM-to-Wasm-to-browser guest gate, opt-in and not faked",{
 skip:!(process.env.ORESLANG_GUEST_WASM&&process.env.ORESLANG_BROWSER_ADAPTER&&process.env.ORESLANG_BROWSER_ADAPTER_SHA256)
},()=>{
 const wasm=process.env.ORESLANG_GUEST_WASM;
 const manifest=wasm+".artifact.json";
 const browser=process.env.ORESLANG_BROWSER_ADAPTER;
 assert.ok(isAbsolute(wasm)&&isAbsolute(browser));
 const r=spawnSync(process.execPath,[script,"--wasm="+wasm,
  "--manifest="+manifest,"--browser-module="+browser,
  "--browser-module-sha256="+process.env.ORESLANG_BROWSER_ADAPTER_SHA256,"--expected-i64=42"],{encoding:"utf8",timeout:10000});
 assert.equal(r.status,0,r.stderr);
 const report=JSON.parse(r.stdout);
 assert.equal(report.ok,true);
 assert.equal(report.observedI64,"42");
 assert.equal(report.browserModuleSha256,process.env.ORESLANG_BROWSER_ADAPTER_SHA256);
 assert.match(report.artifactSha256,/^[a-f0-9]{64}$/);
});


test("duplicate CLI flags cannot replace a pinned artifact or adapter",()=>{
 for(const extra of ["--wasm=/other","--manifest=/other",
  "--browser-module=/other","--browser-module-sha256="+"b".repeat(64),
  "--expected-i64=7"]){
  const args=["--wasm=/missing.wasm","--manifest=/missing.json",
   "--browser-module=/missing.mjs","--browser-module-sha256="+"a".repeat(64),
   "--expected-i64=42",extra];
  const run=spawnSync(process.execPath,[script,...args],{encoding:"utf8"});
  assert.notEqual(run.status,0);
  assert.match(run.stderr,/duplicate wasm-core conformance argument/);
 }
});
test("browser adapter content identity is mandatory and fails before dynamic import",async()=>{
 const {mkdtemp,writeFile,rm}=await import("node:fs/promises");
 const {tmpdir}=await import("node:os");
 const {join}=await import("node:path");
 const dir=await mkdtemp(join(tmpdir(),"ores-conformance-adapter-"));
 try{
  const wasm=join(dir,"app.wasm"),manifest=join(dir,"app.json"),adapter=join(dir,"browser.mjs");
  await writeFile(wasm,Uint8Array.of(0,97,115,109,1,0,0,0));
  await writeFile(manifest,"{}");
  await writeFile(adapter,"throw Error('unverified module must not import');");
  const prefix=["--wasm="+wasm,"--manifest="+manifest,
   "--browser-module="+adapter,"--expected-i64=42"];
  const noPin=spawnSync(process.execPath,[script,...prefix],{encoding:"utf8"});
  assert.notEqual(noPin.status,0);
  assert.match(noPin.stderr,/pinned lowercase SHA-256/);
  const wrongPin=spawnSync(process.execPath,[script,...prefix,
   "--browser-module-sha256="+"0".repeat(64)],{encoding:"utf8"});
  assert.notEqual(wrongPin.status,0);
  assert.match(wrongPin.stderr,/browser adapter SHA-256 mismatch/);
  assert.doesNotMatch(wrongPin.stderr,/unverified module must not import/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
