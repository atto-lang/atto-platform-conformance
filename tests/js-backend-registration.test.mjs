import test from "node:test";
import assert from "node:assert/strict";
import {runSuite,loadManifest,validateManifestSchema} from "../src/harness.mjs";

test("js compiler is admitted only with both canonical fixture classes",async()=>{
 const m=await loadManifest();
 assert.deepEqual(m.cases.map(x=>[x.id,x.expect,x.backends.includes("js")]),[
  ["int-arithmetic","accept",true],
  ["unresolved-identifier","reject",true],
 ]);
 const noPositive=structuredClone(m);
 noPositive.cases[0].backends=noPositive.cases[0].backends.filter(x=>x!=="js");
 assert.throws(()=>validateManifestSchema(noPositive),/coverage/);
 const noNegative=structuredClone(m);
 noNegative.cases[1].backends=noNegative.cases[1].backends.filter(x=>x!=="js");
 assert.throws(()=>validateManifestSchema(noNegative),/coverage/);
});
test("js without a compiler command stays unconfigured and cannot claim runtime parity",async()=>{
 const r=await runSuite({backend:"js",requireConfigured:true});
 assert.equal(r.configured,false);
 assert.equal(r.ok,false);
 assert.equal(r.verified,0);
 assert.equal(r.skipped,2);
 assert.equal(r.runtimeVerified,false);
 assert.equal(r.verificationScope,"compiler-source-check-only");
});
test("source-check-only JS result never claims ESM execution, even for a fake checker",async()=>{
 const argv=[process.execPath,new URL("./fake-checker.mjs",import.meta.url).pathname,"{file}"];
 const r=await runSuite({backend:"js",argv,sourceSha:"012345678901234567890123456789abcdefabcd"});
 assert.equal(r.ok,true); // HARNESS contract only, not an actual JS compiler run.
 assert.equal(r.verified,2);
 assert.equal(r.runtimeVerified,false);
 assert.equal(r.verificationScope,"compiler-source-check-only");
 assert.match(r.provenanceNote,/does not attest/);
});
