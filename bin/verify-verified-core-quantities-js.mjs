import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { expandQuantityCases } from "../lib/verified-core-quantity-expansion.mjs";
const [checkout] = process.argv.slice(2);
if (!checkout || process.argv.length !== 3) throw Error("Usage: node bin/verify-verified-core-quantities-js.mjs <atto-source.js checkout>");
const {compileProgramV2} = await import(pathToFileURL(join(resolve(checkout),"src/program-v2.mjs")).href);
const profile="verified-core-quantities-v1";
const original=fileURLToPath(new URL("../fixtures/"+profile+"/",import.meta.url));
const manifest=JSON.parse(readFileSync(join(original,"cases.json"),"utf8"));
assert.equal(manifest.schemaVersion,1);
assert.equal(manifest.profile,profile);
const work=mkdtempSync(join(tmpdir(),"atto-quantity-js-"));
const errors={divisionByZero:"division_by_zero",integerOverflow:"integer_overflow"};
try{
 const {fixtures,cases}=expandQuantityCases(original,work,manifest);
 for(const {source,expected} of cases){
  assert.match(source,/^[a-z0-9-]+\.atto$/);
  const input=readFileSync(join(fixtures,source),"utf8");
  if(expected.kind==="diagnostic"){
   assert.throws(()=>compileProgramV2(input),err=>String(err.message).includes(expected.category+":"),source);
  }else{
   const emitted=compileProgramV2(input);
   const m=await import("data:text/javascript;base64,"+Buffer.from(emitted).toString("base64"));
   assert.deepEqual(Object.keys(m),["main"],source);
   if(expected.kind==="arithmeticFailure"){
    assert.ok(errors[expected.category],source);
    assert.throws(()=>m.main(),err=>err.code===errors[expected.category],source);
   }else{
    assert.equal(expected.kind,"value",source);
    assert.equal(m.main(),BigInt(expected.decimal),source);
   }
  }
  console.log("PASS js "+source+" "+expected.kind);
 }
 console.log("verified "+cases.length+" cases through actual JS transpilation and ESM guest execution");
}finally{rmSync(work,{recursive:true,force:true});}
