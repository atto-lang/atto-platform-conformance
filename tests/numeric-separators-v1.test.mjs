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
  assert.ok(cases.cases.length>=15);
  const ids=new Set();
  let positive=0,negative=0;
  for(const item of cases.cases){
    assert.match(item.id,/^[a-z][a-z0-9-]*$/);
    assert.ok(!ids.has(item.id),"duplicate case: "+item.id);
    ids.add(item.id);
    assert.ok(["accept","reject"].includes(item.expect));
    assert.match(item.expression,/^[A-Za-z0-9_+*\-()\s"]+$/);
    assert.equal(item.guestSource,
      "pub fnc main():int{return "+item.expression+";}\n");
    assert.ok(!item.guestSource.includes("\0"));
    if(item.expect==="accept"){
      ++positive;
      assert.match(item.expectedI64,/^-?(0|[1-9][0-9]*)$/);
      assert.equal(item.category,undefined);
    }else{
      ++negative;
      assert.ok(["separator","i64-overflow","type","syntax"].includes(item.category));
      assert.equal(item.expectedI64,undefined);
    }
  }
  assert.ok(positive>=6);
  assert.ok(negative>=9);
});
