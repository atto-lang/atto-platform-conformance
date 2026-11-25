import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(p)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const reg=JSON.parse(read("contracts/typed-map-of-entries-nominal-struct-v1.json"));
test("entry-only Map and nominal Struct fixtures have no fabricated execution evidence",()=>{
  assert.equal(reg.contract,"atto-typed-map-of-entries-nominal-struct-v1");
  assert.equal(reg.status,"TARGET_NOT_EXECUTED");
  assert.equal(reg.cases.length,25);
  assert.equal(new Set(reg.cases.map(c=>c.id)).size,reg.cases.length);
  assert.equal(Object.keys(reg.backend_status).length,11);
  for(const [b,status] of Object.entries(reg.backend_status))assert.equal(status,"not_executed",b);
  for(const c of reg.cases){
    assert.equal(c.status,"not_executed",c.id);
    const s=read(c.fixture);
    assert.ok(s.includes("pub fnc main(): int"),c.id);
    assert.match(s, /Map\.of_entries|define struct/);
    for(const b of Object.keys(reg.backend_status))assert.equal(c.evidence[b],"not_executed",c.id+"/"+b);
    if(c.expect==="accept")assert.ok(Number.isInteger(c.expected_exit));
    else{assert.equal(c.expect,"reject");assert.match(c.expected_error,/^E_[A-Z_]+$/);}
  }
});
test("typed Entry and nominal Struct syntax survives fixture ingestion",()=>{
  const map=read("fixtures/map-entries-struct/pass/map_of_entries_bool_42.atto");
  assert.match(map,/const m = Map\.of_entries<int,bool>/);
  assert.match(map,/5 => true/);
  const nominal=read("fixtures/map-entries-struct/pass/nominal_struct_fields_reordered_42.atto");
  assert.match(nominal,/define struct Point as/);
  assert.match(nominal,/Point\{y:2,x:40\}/);
});
