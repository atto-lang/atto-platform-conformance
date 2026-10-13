import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const script=fileURLToPath(new URL("../bin/wasm-core-conformance.mjs",import.meta.url));
const base=["--wasm=/missing/guest.wasm","--manifest=/missing/artifact.json",
 "--browser-module-sha256="+"a".repeat(64),
 "--browser-module=/missing/loader.mjs"];
const args=x=>[...base,"--expected-i64="+x];
test("signed Wasm oracle enforces strict canonical signed 64-bit range",()=>{
 for(const x of ["9223372036854775808","-9223372036854775809","00042","-0","+42","0x2a"]){
  const r=spawnSync(process.execPath,[script,...args(x)],{encoding:"utf8"});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/canonical signed 64-bit integer/);
 }
});
test("min/max signed i64 and full-width decimal values pass argument admission",()=>{
 for(const x of ["9223372036854775807","-9223372036854775808","42","65539","0"]){
  const r=spawnSync(process.execPath,[script,...args(x)],{encoding:"utf8"});
  assert.notEqual(r.status,0);
  assert.doesNotMatch(r.stderr,/canonical signed 64-bit integer/);
 }
});
test("ambiguous duplicate CLI arguments are refused for every pinned option",()=>{
 for(const [key,value] of [
  ["expected-i64","43"],["wasm","/other.wasm"],
  ["manifest","/other.json"],["browser-module","/other.mjs"],
  ["browser-module-sha256","b".repeat(64)]
 ]){
  const r=spawnSync(process.execPath,[script,...args("42"),"--"+key+"="+value],{encoding:"utf8"});
  assert.notEqual(r.status,0,key);
  assert.match(r.stderr,new RegExp("duplicate wasm-core conformance argument: "+key),key);
 }
});
