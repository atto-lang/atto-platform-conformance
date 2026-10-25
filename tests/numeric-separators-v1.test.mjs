import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

const path=fileURLToPath(new URL("../fixtures/numeric-separators-source-v1.json",import.meta.url));
const cases=JSON.parse(await readFile(path,"utf8"));

test("numeric source fixture contract is unique, byte-for-byte reproducible and unattested",()=>{
  assert.equal(cases.schemaVersion,1);
  assert.equal(cases.contract,"oreslang.numeric-separators/source-v1");
  assert.equal(cases.status,"candidate-unattested");
  assert.deepEqual(cases.targetBackends,["java","llvm","net","wasm-via-llvm"]);
  assert.equal(cases.cases.length,26);
  const ids=new Set();
  const expressions=new Set();
  let positive=0,negative=0;
  const i64Min=-(1n<<63n);
  const i64Max=(1n<<63n)-1n;
  for(const item of cases.cases){
    assert.match(item.id,/^[a-z][a-z0-9-]*$/);
    assert.ok(!ids.has(item.id),"duplicate case: "+item.id);
    ids.add(item.id);
    assert.ok(!expressions.has(item.expression),"duplicate expression: "+item.expression);
    expressions.add(item.expression);
    assert.ok(["accept","reject"].includes(item.expect));
    assert.match(item.expression,/^[A-Za-z0-9_+*()" \t-]+$/);
    assert.equal(item.guestSource,
      "pub fnc main():int{return "+item.expression+";}\n");
    assert.ok(!item.guestSource.includes("\0"));
    if(item.expect==="accept"){
      ++positive;
      assert.equal(typeof item.expectedI64,"string");
      assert.match(item.expectedI64,/^-?(0|[1-9][0-9]*)$/);
      const expected=BigInt(item.expectedI64);
      assert.ok(expected>=i64Min && expected<=i64Max,"out-of-range accepted result: "+item.id);
      assert.equal(item.category,undefined);
    }else{
      ++negative;
      assert.ok(["separator","i64-overflow","type","syntax"].includes(item.category));
      assert.equal(item.expectedI64,undefined);
    }
  }
  assert.equal(positive,12);
  assert.equal(negative,14);
  const byId=new Map(cases.cases.map(item=>[item.id,item]));
  for(const [id,expression,expected] of [
    ["int-i64-max","9_223_372_036_854_775_807","9223372036854775807"],
    ["int-i64-min","-9_223_372_036_854_775_808","-9223372036854775808"],
    ["int-leading-zero-i64-min","-0_9223372036854775808","-9223372036854775808"],
    ["int-leading-zero-i64-max","0_9223372036854775807","9223372036854775807"],
    ["int-leading-zero-run","0_0_0","0"]
  ]){
    const item=byId.get(id);
    assert.ok(item,"missing boundary accept: "+id);
    assert.equal(item.expect,"accept");
    assert.equal(item.expression,expression);
    assert.equal(item.expectedI64,expected);
    assert.equal(BigInt(expression.replaceAll("_","")),BigInt(expected));
  }
  for(const [id,category] of [
    ["bad-negative-underflow","i64-overflow"],
    ["bad-leading-zero-underflow","i64-overflow"],
    ["bad-triple-separator","separator"],
    ["bad-minus-boundary","separator"]
  ]){
    const item=byId.get(id);
    assert.ok(item,"missing boundary rejection: "+id);
    assert.equal(item.expect,"reject");
    assert.equal(item.category,category);
  }
});
