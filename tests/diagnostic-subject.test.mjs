import test from "node:test";
import assert from "node:assert/strict";
import {isExpectedCompilerDiagnostic,runSuite} from "../src/harness.mjs";

const symbol="nonexistent_symbol";
const sha="012345678901234567890123456789abcdefabcd";

test("a valid diagnostic must name the requested unresolved identifier",()=>{
 for(const message of [
  "error: unresolved identifier nonexistent_symbol",
  "main.ores:2: error: use of undeclared identifier 'nonexistent_symbol'",
  "error[E0425]: cannot find name nonexistent_symbol",
  "error: nonexistent_symbol not found",
  "ERROR: unknown symbol \"nonexistent_symbol\"",
  "error: cannot resolve reference nonexistent_symbol"
 ])assert.equal(isExpectedCompilerDiagnostic(message,symbol),true,message);
});

test("do not accept expected name from source path or trailing context on same line",()=>{
 for(const message of [
  "/src/nonexistent_symbol.ores:12: error: unresolved identifier other_symbol",
  "error: unresolved identifier other_symbol; source='nonexistent_symbol'",
  "error: cannot find name other_symbol; maybe nonexistent_symbol?",
  "error: nonexistent_symbol is used here but unknown identifier other_symbol",
  "error: unknown symbol different_symbol (at nonexistent_symbol)",
  "error: filesystem missing nonexistent_symbol, unresolved identifier other_symbol",
  "error: missing dependency; the line 'nonexistent_symbol' is invalid"
 ])assert.equal(isExpectedCompilerDiagnostic(message,symbol),false,message);
});

test("do not promote mere warnings, case changes, or arbitrary exit messages",()=>{
 for(const message of [
  "warning: unresolved identifier nonexistent_symbol",
  "error: unresolved identifier Nonexistent_symbol",
  "error: unresolved identifier nonexistent_symbol_extra",
  "error: unresolved identifier other_symbol\n  return nonexistent_symbol;",
  "error: source file nonexistent_symbol.ores cannot be read"
 ])assert.equal(isExpectedCompilerDiagnostic(message,symbol),false,message);
});

test("an unrelated failed compiler does not produce a verified negative fixture",async()=>{
 const results=await runSuite({
  backend:"forge",sourceSha:sha,argv:[process.execPath,"{file}"],
  spawn:(exe,args)=>{
   const negative=args.at(-1).endsWith("unresolved-identifier.ores");
   return negative
    ? {status:1,signal:null,stdout:"",stderr:"/src/nonexistent_symbol.ores: error: unresolved identifier wrong_name"}
    : {status:0,signal:null,stdout:"",stderr:""};
  }
 });
 assert.equal(results.results[1].status,"MISMATCH");
 assert.equal(results.ok,false);
 assert.equal(results.verified,1);
});
