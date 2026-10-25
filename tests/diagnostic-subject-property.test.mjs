import test from "node:test";
import assert from "node:assert/strict";
import {isExpectedCompilerDiagnostic} from "../src/harness.mjs";

test("10,000 deterministic error-path/source-echo spoof cases never verify wrong symbol",()=>{
 const expected="nonexistent_symbol";
 let state=0x0E5A1A;
 function next(){
  state=(Math.imul(state,1664525)+1013904223)>>>0;
  return state;
 }
 for(let i=0;i<10000;i++){
  const wrong="other_"+next().toString(16);
  const path="/work/"+expected+".ores:"+(next()%1000+1)+":";
  const message=path+" error: unresolved identifier "+wrong+
    "; source return "+expected+"; hint: "+expected;
  assert.equal(isExpectedCompilerDiagnostic(message,expected),false,
    "false promotion at generated case "+i);
  assert.equal(isExpectedCompilerDiagnostic("error: unresolved identifier "+expected,expected),
    true,"rejected real diagnostic at generated case "+i);
 }
});
