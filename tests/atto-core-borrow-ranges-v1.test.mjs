// Independent v1 reference oracle. No Atto compiler is invoked by Node.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const c = JSON.parse(readFileSync(
  new URL("../contracts/atto-core-borrow-ranges-v1.json", import.meta.url),"utf8"));
const fits = (region,start,length) =>
  region>=0 && start>=0 && length>=0 && start<=region && length<=region-start;
const overlap = (region,a,alen,b,blen) =>
  !fits(region,a,alen) || !fits(region,b,blen) ? true :
  alen===0 || blen===0 ? false :
  a<=b ? b-a<alen : a-b<blen;
const oracle = {
  range_fits:fits,
  ranges_overlap:overlap,
  mutable_split_admissible:(region,a,alen,b,blen)=>
    fits(region,a,alen)&&fits(region,b,blen)&&!overlap(region,a,alen,b,blen),
  read_loan_slot_admissible:(readers,limit,writer,queued)=>
    limit>=1&&limit<=1024&&readers>=0&&readers<limit&&!writer&&queued===0,
  write_loan_slot_admissible:(readers,writer)=>readers===0&&!writer,
  owner_move_slot_admissible:(live,readers,writer)=>
    live&&readers===0&&!writer
};
const allBackends=["atto","cranelift","forge","hdl","java","js",
  "llvm","net","realtime","rs","wasm"];
function validate(doc) {
  assert.equal(doc.schema,"atto-core-borrow-ranges-v1");
  assert.equal(doc.status,"CANDIDATE_SOURCE_MODEL_ONLY_NOT_COMPILED");
  assert.deepEqual(Object.keys(doc.api).sort(),Object.keys(oracle).sort());
  assert.equal(doc.vectors.length,64);
  assert.equal(doc.vector_count,64);
  assert.deepEqual(doc.backends.map(x=>x.backend).sort(),allBackends);
  assert.equal(doc.invariants.invalid_range_overlap.startsWith("true"),true);
  assert.equal(doc.dependencies.includes("contracts/borrow-checker-v1.tsv"),true);
  const counted=new Set();
  for(const [index,v]of doc.vectors.entries()){
    assert.equal(v.id,"CBR-"+String(index+1).padStart(3,"0"));
    assert.ok(!counted.has(v.id));counted.add(v.id);
    const sig=doc.api[v.fn];assert.ok(sig,"unknown function "+v.id);
    assert.equal(v.args.length,sig.length-1,"arity "+v.id);
    for(let i=0;i<v.args.length;i++){
      assert.equal(typeof v.args[i],sig[i]==="bool"?"boolean":"number",v.id);
      if(sig[i]==="int")assert.ok(Number.isSafeInteger(v.args[i]),v.id);
    }
    assert.equal(typeof v.expected,sig.at(-1)==="bool"?"boolean":"number",v.id);
    assert.equal(oracle[v.fn](...v.args),v.expected,"incorrect oracle "+v.id);
  }
  for(const b of doc.backends){
    assert.equal(b.source,"NOT_EXECUTED");
    assert.equal(b.native_guest,"NOT_EXECUTED");
    assert.equal(b.compiler_borrow,"NOT_EXECUTED");
  }
  return counted.size;
}
test("64 core range/loan cases have independent expected outcomes",()=>{
  assert.equal(validate(c),64);
  console.log("ATTO_CORE_BORROW_REFERENCE_ONLY|vectors=64|guest=NOT_EXECUTED");
});
test("reject forged borrow proof, duplicate case, missing backend and changed boundary",()=>{
  const mutate=callback=>{const copy=structuredClone(c);callback(copy);return copy};
  assert.throws(()=>validate(mutate(x=>x.vectors[0].expected=!x.vectors[0].expected)));
  assert.throws(()=>validate(mutate(x=>x.vectors[1].id=x.vectors[0].id)));
  assert.throws(()=>validate(mutate(x=>{x.backends.pop()})));
  assert.throws(()=>validate(mutate(x=>{x.backends[0].compiler_borrow="PASS"})));
  assert.throws(()=>validate(mutate(x=>{x.vectors[0].args[0]=-99})),
    "negative-range changes must still be checked against oracle");
});
