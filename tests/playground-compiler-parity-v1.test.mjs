import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validatePlaygroundReceipt} from "../bin/verify-playground-compiler-parity.mjs";
const c=JSON.parse(readFileSync(new URL("../contracts/playground-compiler-parity-v1.json",import.meta.url),"utf8"));
const mk=()=>({schema:"oreslang.playground-compiler-receipt/1",backend:"java",repository:"ores-truffle-oreslang/oreslang-source.java",sourceCommit:"a".repeat(40),sourceTree:"b".repeat(40),compilerBinarySha256:"c".repeat(64),upstreamManifestBlobSha:c.upstream.manifestBlobSha,runner:{kind:"local",executedSteps:1,compilerArgv:["compiler"]},cases:c.cases.map(x=>({id:x.id,stage:"NOT_EXECUTED"}))});
test("all 42 exact sources, eight negative cases, nine backends are explicit",()=>{
 assert.equal(c.cases.filter(x=>x.kind==="positive").length,42);
 assert.equal(c.cases.filter(x=>x.kind==="semantic-rejection").length,8);
 assert.equal(new Set(c.cases.map(x=>x.id)).size,50);
 assert.deepEqual(c.backends.map(x=>x.id),["java","llvm","wasm","forge","net","cranelift","rs","js","hdl"]);
 assert.ok(c.cases.filter(x=>x.kind==="positive").every(x=>/^[a-f0-9]{40}$/.test(x.reference.gitBlobSha)));
});
test("valid unexecuted report is not parity certification",()=>{
 const x=validatePlaygroundReceipt(mk(),c);
 assert.equal(x.valid,true);assert.equal(x.fullEvidenceShape,false);assert.equal(x.parityCertified,false);assert.equal(x.evidenceAuthenticated,false);
});
test("omitted, duplicated, unknown cases cannot pass",()=>{
 const a=mk();a.cases.pop();assert.equal(validatePlaygroundReceipt(a,c).valid,false);
 const b=mk();b.cases.push({...b.cases[0]});assert.equal(validatePlaygroundReceipt(b,c).valid,false);
 const d=mk();d.cases[0].id="preview/not-real";assert.equal(validatePlaygroundReceipt(d,c).valid,false);
});
test("zero step, mismatched source and mismatched backend fail",()=>{
 const a=mk();a.runner.executedSteps=0;assert.equal(validatePlaygroundReceipt(a,c).valid,false);
 const b=mk();b.upstreamManifestBlobSha="0".repeat(40);assert.equal(validatePlaygroundReceipt(b,c).valid,false);
 const d=mk();d.repository="wrong/repo";assert.equal(validatePlaygroundReceipt(d,c).valid,false);
});
test("guest without artifact or genuine runtime and semantic rejection without diagnostic fail",()=>{
 const a=mk();a.cases[0]={id:a.cases[0].id,stage:"GUEST_EXECUTED"};assert.equal(validatePlaygroundReceipt(a,c).valid,false);
 const b=mk();b.cases[b.cases.length-1]={id:b.cases[b.cases.length-1].id,stage:"SEMANTIC_REJECTED",guestSourcePath:"fixtures/bad.ores",guestSourceBlobSha:"d".repeat(40),execution:{executedSteps:1,assertions:1,compileArgv:["compiler"],compilerExitCode:1,diagnostic:"E_UNSUPPORTED",diagnosticCategory:"parser"}};assert.equal(validatePlaygroundReceipt(b,c).valid,false);
});
test("Java AOT and WASM Worker cannot be replaced by host-only success",()=>{
 const a=mk();a.cases[0]={id:a.cases[0].id,stage:"GUEST_EXECUTED",guestSourcePath:"fixtures/good.ores",guestSourceBlobSha:"d".repeat(40),execution:{executedSteps:1,assertions:1,compileArgv:["compiler"],compilerExitCode:0,guestExitCode:0,executedGuest:true,oracleMatched:true,artifactSha256:"f".repeat(64),guestArgv:["guest"]}};
 assert.equal(validatePlaygroundReceipt(a,c).valid,false);
 const b=mk();b.backend="wasm";b.repository="ores-truffle-oreslang/oreslang-source.wasm";b.cases[0]=a.cases[0];
 assert.equal(validatePlaygroundReceipt(b,c).valid,false);
});
