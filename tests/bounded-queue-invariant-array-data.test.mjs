import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateBoundedQueueContract as validate} from "../src/bounded-queue-v1.mjs";

const fixture=new URL("../contracts/v1/bounded-queue/bounded-queue-v1.json",import.meta.url);
const fresh=()=>JSON.parse(readFileSync(fixture,"utf8"));

test("required BQ01..BQ15 invariant array never invokes input index getters",()=>{
 let reads=0;
 const contract=fresh(),original=contract.required_invariants[0];
 Object.defineProperty(contract.required_invariants,0,{enumerable:true,get(){
  reads++;return original;
 }});
 assert.throws(()=>validate(contract),/requires own enumerable data slots/);
 assert.equal(reads,0);
 const sparse=fresh();delete sparse.required_invariants[4];
 assert.throws(()=>validate(sparse),/unexpected array metadata|requires own enumerable data slots/);
});
test("invariants reject custom iterator/metadata and preserve genuine canonical contract",()=>{
 let calls=0;
 const record=fresh();
 Object.defineProperty(record.required_invariants,Symbol.iterator,{get(){
  calls++;throw Error("untrusted iterator");
 }});
 assert.throws(()=>validate(record),/unexpected array metadata/);
 assert.equal(calls,0);
 const extra=fresh();extra.required_invariants.credential="secret";
 assert.throws(()=>validate(extra),/unexpected array metadata/);
 const valid=validate(fresh());
 assert.equal(valid.ok,true);
 assert.equal(valid.invariants,15);
 assert.equal(valid.backends,5);
});
