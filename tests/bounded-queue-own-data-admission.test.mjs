import test from "node:test";
import assert from "node:assert/strict";
import {validateBoundedQueueBackendStatus as validate} from "../src/bounded-queue-v1.mjs";

function pending(){
 return {
  schema:"oreslang.bounded_queue_backend_status.v1",
  contract_id:"bounded-queue-v1",
  source_contract:{repository:"ores-truffle-oreslang/rx-oreslang-channels",
    pull_request:1,head_commit:"a".repeat(40),execution_status:"NOT_EXECUTED"},
  records:["oreslang-source.java","oreslang-source.llvm","oreslang-source.net",
   "oreslang-source.wasm","oreslang-source.forge"].map(backend=>({
      backend,source_lowering:"unsupported",runtime_substrate:"unsupported",
      guest_execution:"NOT_EXECUTED",reference:{},reason:"pending"
   })),
  parity_certified:false,release_ready:false
 };
}

test("bounded queue pending receipts deny getter-bearing schema and nested authority without invoking it",()=>{
 let reads=0;
 const a=pending();
 Object.defineProperty(a,"schema",{enumerable:true,get(){
   reads++;throw Error("untrusted receipt getter");
 }});
 assert.throws(()=>validate(a),/only enumerable own data fields/);
 const b=pending();
 Object.defineProperty(b.records[0],"guest_execution",{enumerable:true,get(){
   reads++;return "NOT_EXECUTED";
 }});
 assert.throws(()=>validate(b),/only enumerable own data fields/);
 const c=pending();
 Object.defineProperty(c.records[0].reference,"revision",{enumerable:true,get(){
   reads++;return 42;
 }});
 assert.throws(()=>validate(c),/only enumerable own data fields/);
 assert.equal(reads,0);
});

test("pending queue evidence rejects inherited and symbol keys but accepts ordinary data",()=>{
 const receipt=pending();
 assert.equal(validate(receipt).releaseReady,false);
 const foreign=Object.assign(Object.create({privileged:true}),receipt);
 assert.throws(()=>validate(foreign),/plain data object/);
 const signed=pending();signed.records[0].reference[Symbol("authority")]="yes";
 assert.throws(()=>validate(signed),/only enumerable own data fields/);
 const hidden=pending();
 Object.defineProperty(hidden,"invisible",{value:"x",enumerable:false});
 assert.throws(()=>validate(hidden),/only enumerable own data fields/);
});
