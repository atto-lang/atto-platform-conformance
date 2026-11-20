import test from "node:test";
import assert from "node:assert/strict";
import {runSuite,isExpectedCompilerDiagnostic} from "../src/harness.mjs";

const sha="012345678901234567890123456789abcdefabcd";
const argv=[process.execPath,"{file}"];
const symbol="nonexistent_symbol";

test("positive literal unresolved-name errors match on a single diagnostic line",()=>{
 for(const line of [
  "error: unresolved identifier nonexistent_symbol",
  "source.ores:2: error: use of undeclared identifier 'nonexistent_symbol'",
  "Error: cannot find name nonexistent_symbol",
  "error: nonexistent_symbol not found"
 ])assert.equal(isExpectedCompilerDiagnostic(line,symbol),true,line);
});

test("non-compiler errors, source echoes, warnings and substring matches never count",()=>{
 for(const text of [
  "error: permission denied\n  return nonexistent_symbol;",
  "error: failed reading compiler config\nwarning: unresolved identifier nonexistent_symbol",
  "error: unresolved identifier other_symbol\n  return nonexistent_symbol;",
  "warning: unresolved identifier nonexistent_symbol",
  "error: I/O failure, nonexistent_symbol",
  "error: unknown identifier other_nonexistent_symbol",
  "error: unresolved identifier nonexistent_symbol_extra",
  "error: resolved identifier nonexistent_symbol",
  "error: unresolved identifier Nonexistent_symbol"
 ])assert.equal(isExpectedCompilerDiagnostic(text,symbol),false,text);
});

test("manifest diagnostic is a bounded literal symbol, not an injectable regex",()=>{
 for(const bad of ["", ".*", "^nonexistent_symbol$", "(a+)+$", "not found", "x".repeat(200), null]) {
  assert.equal(isExpectedCompilerDiagnostic("error: unresolved identifier nonexistent_symbol",bad),false);
 }
});

test("nonzero process with an unrelated error and echoed source cannot verify negative fixture",async()=>{
 const spawn=(file,args)=>{
  const negative=args.at(-1).endsWith("unresolved-identifier.ores");
  return negative
   ? {status:1,signal:null,stdout:"  return nonexistent_symbol;\n",stderr:"error: compiler configuration missing"}
   : {status:0,signal:null,stdout:"",stderr:""};
 };
 const result=await runSuite({backend:"java",argv,sourceSha:sha,spawn});
 assert.equal(result.ok,false);
 assert.equal(result.verified,1);
 assert.equal(result.failed,1);
 assert.equal(result.results[1].status,"MISMATCH");
});

test("explicit unresolved-name diagnostic verifies negative but unrelated failure never does",async()=>{
 const spawn=(file,args)=>{
  const negative=args.at(-1).endsWith("unresolved-identifier.ores");
  return negative
   ? {status:1,signal:null,stdout:"",stderr:"error: unresolved identifier nonexistent_symbol"}
   : {status:0,signal:null,stdout:"",stderr:""};
 };
 const result=await runSuite({backend:"llvm",argv,sourceSha:sha,spawn});
 assert.equal(result.ok,true);
 assert.equal(result.verified,2);
 assert.equal(result.failed,0);
});
