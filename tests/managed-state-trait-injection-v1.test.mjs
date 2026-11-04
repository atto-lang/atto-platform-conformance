import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {decide} from "../src/managed-state-trait-injection-v1.mjs";
const data=JSON.parse(await readFile(new URL("../contracts/managed-state-trait-injection-v1.json",import.meta.url),"utf8"));
const clone=x=>structuredClone(x);
test("32 explicit owner/state/loan admission vectors",()=>{
  assert.equal(data.cases.length,32);
  assert.equal(new Set(data.cases.map(x=>x.id)).size,32);
  assert.ok(data.cases.filter(x=>x.expected==="OK").length>=4);
  assert.ok(data.cases.filter(x=>x.expected!=="OK").length>=28);
  for(const c of data.cases)assert.equal(decide(c.input),c.expected,c.id);
});
test("all five backends remain NOT_EXECUTED",()=>{
  assert.equal(data.status,"SOURCE_FREE_NOT_COMPILER_PARITY");
  assert.deepEqual(data.required_backends,["java","llvm","wasm","cranelift","net"]);
  assert.deepEqual(Object.keys(data.execution).sort(),[...data.required_backends].sort());
  assert.ok(Object.values(data.execution).every(x=>x==="NOT_EXECUTED"));
  assert.equal(data.promotion.rejection_counts_as_execution,false);
  assert.equal(data.promotion.host_reference_counts_as_parity,false);
  assert.equal(data.promotion.real_compiler_and_guest_execution_required,true);
});
test("injection source cannot mint authority or change singleton domain",()=>{
  const x=clone(data.cases.find(c=>c.id==="T04_SINGLETON_INJECTED").input);
  assert.equal(decide(x),"OK");
  x.bindings[0].issuer="guest";assert.equal(decide(x),"UNTRUSTED_INJECTION");
  x.bindings[0].issuer="compiler";x.bindings[0].scope="process";
  assert.equal(decide(x),"INJECTION_SCOPE");
});
test("borrows must not escape through heap aliases or suspension",()=>{
  const x=clone(data.cases[0].input);
  x.access.heap_escape=true;assert.equal(decide(x),"STATE_LOAN_ESCAPE");
  delete x.access.heap_escape;x.access.suspends=true;
  assert.equal(decide(x),"STATE_LOAN_SUSPEND");
});
test("actors, supervisors and trait types cannot inherit generic state injection",()=>{
  const x=clone(data.cases[3].input);
  for(const kind of ["actor","supervisor","grain","model","trait","enum"])
    assert.equal(decide({...x,kind}),"UNSUPPORTED_OWNER_KIND",kind);
});
test("malformed and unknown fields reject rather than silently admit",()=>{
  assert.equal(decide(null),"INVALID");
  const x=clone(data.cases[0].input);x.access.new_privilege=true;
  assert.equal(decide(x),"UNKNOWN_FIELD");
  delete x.access.new_privilege;x.bindings=[];
  assert.equal(decide(x),"REQUIRED_STATE_MISSING");
});


test("unknown binding metadata must not smuggle capability claims",()=>{
  const x=clone(data.cases[3].input);
  x.bindings[0].raw_pointer=true;
  assert.equal(decide(x),"UNKNOWN_FIELD");
  delete x.bindings[0].raw_pointer;
  x.bindings[0].scope="application_domain";
  assert.equal(decide(x),"OK");
  const inline=clone(data.cases[0].input);
  inline.bindings[0].issuer="compiler";
  assert.equal(decide(inline),"UNKNOWN_FIELD");
});
test("mutability and guard flags cannot be stringified or undefined to bypass checking",()=>{
  const x=clone(data.cases[3].input);
  x.access.mutates="false";
  assert.equal(decide(x),"INVALID_ACCESS");
  x.access.mutates=true;
  x.access.suspends="false";
  assert.equal(decide(x),"INVALID_ACCESS");
  x.access.suspends=false;
  assert.equal(decide(x),"OK");
});
