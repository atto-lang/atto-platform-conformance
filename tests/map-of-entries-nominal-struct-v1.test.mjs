import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const spec=JSON.parse(read("contracts/map-of-entries-nominal-struct-v1.json"));
test("new Map.of_entries and Struct profile is not marked as run",()=>{
 assert.equal(spec.contract,"atto-map-of-entries-nominal-struct-v1");
 assert.equal(spec.status,"TARGET_NOT_EXECUTED");
 assert.equal(Object.keys(spec.backend_status).length,11);
 assert.equal(spec.cases.length,27);
 assert.equal(new Set(spec.cases.map(x=>x.id)).size,spec.cases.length);
 for(const b of Object.keys(spec.backend_status)) assert.equal(spec.backend_status[b],"not_executed");
 for(const c of spec.cases){
  assert.equal(c.status,"not_executed");
  for(const b of Object.keys(spec.backend_status)) assert.equal(c.evidence[b],"not_executed",c.id+"/"+b);
  const src=read(c.fixture);
  assert.ok(src.includes("pub fnc main(): int"),c.id);
  if(c.expect==="accept") assert.ok(Number.isInteger(c.expected_exit));
  else {assert.equal(c.expect,"reject");assert.match(c.expected_error,/^E_[A-Z_]+$/);}
 }
});
test("Entry-only Map factory and nominal Struct cases stay distinct",()=>{
 assert.match(read("fixtures/map-entries-struct/pass/map_entries_explicit_42.atto"),/Map.of_entries<int,bool>/);
 assert.match(read("fixtures/map-entries-struct/pass/map_entries_const_42.atto"),/const m/);
 assert.match(read("fixtures/map-entries-struct/pass/struct_named_42.atto"),/define struct Point as/);
 assert.match(read("fixtures/map-entries-struct/fail/struct_nominal_cross_assign.atto"),/val Point p=q/);
});
