import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const script=fileURLToPath(new URL("../bin/wasm-core-conformance.mjs",import.meta.url));
const base=["--wasm=/missing/guest.wasm","--manifest=/missing/artifact.json",
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
test("ambiguous duplicate CLI arguments are refused for every option",()=>{
 for(const [key,first,second] of [
  ["expected-i64","9223372036854775808","42"],
  ["wasm","/missing/guest.wasm","/missing/other.wasm"],
  ["manifest","/missing/artifact.json","/missing/other.json"],
  ["browser-module","/missing/loader.mjs","/missing/other.mjs"]
 ]){
  const command=[...args("42"),"--"+key+"="+first,"--"+key+"="+second];
  const result=spawnSync(process.execPath,[script,...command],{encoding:"utf8"});
  assert.notEqual(result.status,0,key);
  assert.match(result.stderr,new RegExp("duplicate wasm-core conformance argument: "+key),key);
 }
});
