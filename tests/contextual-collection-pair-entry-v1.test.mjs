import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const spec=JSON.parse(read("contracts/contextual-collection-pair-entry-v1.json"));
test("all contextual collection contract cases are NOT_EXECUTED until real guest evidence",()=>{
 assert.equal(spec.contract,"atto-contextual-collection-pair-entry-v1");
 assert.equal(spec.status,"TARGET_NOT_EXECUTED");
 const backs=Object.keys(spec.backend_status);
 assert.equal(backs.length,11);
 assert.equal(spec.cases.length,23);
 assert.equal(new Set(spec.cases.map(c=>c.id)).size,spec.cases.length);
 for(const b of backs)assert.equal(spec.backend_status[b],"not_executed");
 for(const c of spec.cases){
  assert.equal(c.status,"not_executed",c.id);
  const src=read(c.fixture);
  assert.ok(src.includes("pub fnc main(): int"),c.id);
  for(const b of backs)assert.equal(c.evidence[b],"not_executed",c.id+"/"+b);
  if(c.expect==="accept")assert.ok(Number.isInteger(c.expected_exit),c.id);
  else{assert.equal(c.expect,"reject");assert.match(c.expected_error,/^E_[A-Z_]+$/);}
 }
});
test("contextual special forms remain distinct in normative fixtures",()=>{
 assert.ok(read("fixtures/contextual-collections/pass/optional_tuple_none_42.atto").includes("Tuple[int?,string?,bool?]"));
 assert.ok(read("fixtures/contextual-collections/pass/named_record_tuple_42.atto").includes('(abc="foo", xyz=true, foo=42)'));
 assert.ok(read("fixtures/contextual-collections/pass/pair_arrow_42.atto").includes("40 => true"));
 assert.ok(read("fixtures/contextual-collections/pass/entry_arrow_42.atto").includes("Entry<int,bool>"));
 assert.ok(read("fixtures/contextual-collections/pass/typed_empty_list_42.atto").includes("List<int> items = []"));
 assert.ok(read("fixtures/contextual-collections/pass/typed_empty_map_42.atto").includes("Map<int,string> items = {}"));
});
