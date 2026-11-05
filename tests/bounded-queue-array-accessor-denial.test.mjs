import test from "node:test";
import assert from "node:assert/strict";
import {validateBoundedQueueBackendStatus as validate} from "../src/bounded-queue-v1.mjs";

function pending(){
 const backends=["oreslang-source.java","oreslang-source.llvm","oreslang-source.net",
   "oreslang-source.wasm","oreslang-source.forge"];
 return {
  schema:"oreslang.bounded_queue_backend_status.v1",contract_id:"bounded-queue-v1",
  source_contract:{repository:"ores-truffle-oreslang/rx-oreslang-channels",
   pull_request:1,head_commit:"a".repeat(40),execution_status:"NOT_EXECUTED"},
  records:backends.map(backend=>({backend,source_lowering:"unsupported",
   runtime_substrate:"unsupported",guest_execution:"NOT_EXECUTED",
   reference:{},reason:"unexecuted"})),
  parity_certified:false,release_ready:false
 };
}

test("status array getters cannot execute during five-backend evidence classification",()=>{
 let invoked=0;
 const sample=pending();const first=sample.records[0];
 Object.defineProperty(sample.records,0,{enumerable:true,get(){
  invoked++;return first;
 }});
 assert.throws(()=>validate(sample),/requires own enumerable data slots/);
 assert.equal(invoked,0);
 const sparse=pending();delete sparse.records[2];
 assert.throws(()=>validate(sparse),/unexpected array metadata|requires own enumerable data slots/);
});

test("hostile array iterators and extra metadata fail while ordinary pending records remain blocked",()=>{
 let invoked=0;
 const malicious=pending();
 Object.defineProperty(malicious.records,Symbol.iterator,{get(){
  invoked++;throw Error("untrusted array iterator");
 }});
 assert.throws(()=>validate(malicious),/unexpected array metadata/);
 assert.equal(invoked,0);
 const extra=pending();extra.records.secret="skip-review";
 assert.throws(()=>validate(extra),/unexpected array metadata/);
 const valid=validate(pending());
 assert.equal(valid.parityCertified,false);
 assert.equal(valid.releaseReady,false);
 assert.equal(valid.backendCount,5);
 assert.equal(valid.blocked.length,5);
});
