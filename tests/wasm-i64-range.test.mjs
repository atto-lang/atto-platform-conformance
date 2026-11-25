import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const runner=fileURLToPath(new URL("../bin/wasm-core-conformance.mjs",import.meta.url));
function run(expected){return spawnSync(process.execPath,[runner,
 "--wasm=/nonexistent.wasm","--manifest=/nonexistent.json",
 "--browser-module=/nonexistent.mjs","--browser-module-sha256="+"a".repeat(64),
 "--expected-i64="+expected],{encoding:"utf8"});}

test("guest expected value must be canonical signed i64",()=>{
 for(const invalid of ["-0","00","042","+42","1.0"," 42","42 ","0x2a",
  "9223372036854775808","-9223372036854775809","999999999999999999999999999"]){
  const result=run(invalid);
  assert.notEqual(result.status,0,invalid);
  assert.match(result.stderr,/canonical signed 64-bit integer/,invalid);
 }
});

test("minimum, maximum, negative and full-width signed values pass parser",()=>{
 for(const valid of ["0","42","-7","65539","9223372036854775807","-9223372036854775808"]){
  const result=run(valid);
  assert.notEqual(result.status,0); // missing fixture paths, not a guest failure
  assert.doesNotMatch(result.stderr,/canonical signed 64-bit integer/,valid);
  assert.match(result.stderr,/"ok":false/);
 }
});
