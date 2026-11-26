// Harness self-test only. No mock output is counted as compiler conformance.
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
const dir=mkdtempSync(join(tmpdir(),"atto-strict-oracle-selftest-"));
try {
 const cases=JSON.parse(readFileSync(new URL("../fixtures/verified-core-strict-i64-v1/cases.json",import.meta.url),"utf8")).cases.filter(c=>c.tier==="arithmetic");
 assert.equal(cases.length,8);
 mkdirSync(join(dir,"src"));
 // Simulate a faulty first value, correct later values, and expected denials.
 // The oracle must report the failed case, continue, and return nonzero.
 const fixtures=cases.map((c,i)=>[c.source,c.expected.kind==="value"?{value:i===0?"41":c.expected.decimal}:{diagnostic:c.expected.category}]);
 writeFileSync(join(dir,"src/program-v2.mjs"),
   "const cases=new Map("+JSON.stringify(fixtures)+");\n"+
   "export function compileVerifiedStrict(source){const c=cases.get(source);if(!c)throw Error('unexpected fixture');if(c.diagnostic)throw Error(c.diagnostic+': injected denial');return 'export function main(){return '+c.value+'n;}';}\n");
 const out=spawnSync(process.execPath,[fileURLToPath(new URL("./verify-verified-core-strict-i64.mjs",import.meta.url)),"js",dir,"arithmetic"],{encoding:"utf8",timeout:20000});
 if(out.error)throw out.error;
 assert.equal(out.signal,null);
 assert.equal(out.status,1,out.stdout+out.stderr);
 assert.match(out.stderr,/CASE_FAIL js bounded-add /);
 assert.match(out.stdout,/PASS js unknown-cast /);
 assert.match(out.stdout,/STRICT_CENSUS js arithmetic total 8 passed 7 failed 1/);
 assert.doesNotMatch(out.stdout,/VERIFIED_STRICT_I64 js arithmetic/);
 console.log("PASS strict census failure isolation (oracle self-test; not guest evidence)");
} finally {rmSync(dir,{recursive:true,force:true});}
