import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const manifestPath=new URL("../contracts/structural/five-backend-current-v1.json",import.meta.url);
const required=["java","llvm","wasm","js","net"];
const facets=["readonly","entry","tuple","generic-method","patterns","nominal","visibility","representation","actors","effects"];
test("structural five-backend current subset is explicitly target-only, never certified",async()=>{
 const c=JSON.parse(await readFile(manifestPath,"utf8"));
 assert.equal(c.schemaVersion,1);
 assert.equal(c.status,"target-only-not-runtime-evidence");
 assert.deepEqual(c.backends,required);
 assert.equal(c.semantics.structuralViews,"explicit-readonly-nonescaping");
 assert.equal(c.semantics.ordinaryNominal,"no-implicit-structural");
 assert.equal(c.semantics.slotRepresentation,"no-implicit-numeric-reinterpretation");
 assert.equal(c.semantics.tuple,"exact-arity-kind");
 assert.equal(c.semantics.optionalTailWidth,"future-proposal-not-enabled");
 assert.equal(c.semantics.artifactOnRejectedCompilerCase,false);
 assert.ok(c.cases.length>=15&&c.cases.length<=128);
 const ids=new Set();
 for(const f of c.cases){
  assert.match(f.id,/^[a-z][a-z0-9-]{0,80}$/);
  assert.ok(!ids.has(f.id));ids.add(f.id);
  assert.ok(facets.includes(f.facet),f.facet);
  assert.ok(["accept","reject"].includes(f.admission));
  assert.ok(typeof f.source==="string"&&f.source.length>12&&f.source.length<8000);
  assert.equal(Object.hasOwn(f,"verified"),false,"target fixtures cannot self-certify");
  assert.equal(Object.hasOwn(f,"compilerPassed"),false,"fixture schema is not test evidence");
  if(Object.hasOwn(f,"expectedMain")){
   assert.equal(f.admission,"accept");
   assert.ok(typeof f.expectedMain==="string");
  }
 }
 for(const facet of facets)assert.ok(c.cases.some(f=>f.facet===facet),"missing "+facet);
 for(const admission of ["accept","reject"])assert.ok(c.cases.some(f=>f.admission===admission));
});
test("structural contract retains explicit negative soundness and metadata boundaries",async()=>{
 const c=JSON.parse(await readFile(manifestPath,"utf8"));
 const byId=new Map(c.cases.map(f=>[f.id,f]));
 for(const id of [
  "nominal-does-not-widen","private-field-cannot-prove","no-numeric-slot-coercion",
  "readonly-nested-no-write","no-actor-structural-erasure","tuple-not-fixed-array",
  "structural-no-suspend","generic-method-wrong-result","empty-shape-not-scalar"
 ]) assert.equal(byId.get(id)?.admission,"reject",id);
 assert.equal(byId.get("generic-method-alpha")?.admission,"accept");
 assert.equal(byId.get("readonly-field-width")?.expectedMain,"11");
 for(const id of ["anonymous-inline-implicit","anonymous-inline-redundant-keyword",
   "anonymous-struct-redundant-keyword","anonymous-struct-implicit",
   "anonymous-record-implicit","anonymous-record-redundant-keyword","named-trait-explicit"]){
  assert.equal(byId.get(id)?.admission,"accept",id);
  assert.equal(byId.get(id)?.expectedMain,"11",id);
 }
 assert.equal(byId.get("named-interface-requires-structural")?.admission,"reject");
});
