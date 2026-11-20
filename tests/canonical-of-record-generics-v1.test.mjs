import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const spec = JSON.parse(read("contracts/canonical-of-record-generics-v1.json"));
const backs = Object.keys(spec.backend_status);
test("canonical factories registry is explicitly NOT_EXECUTED for all 11 compilers", () => {
  assert.equal(spec.contract, "atto-canonical-of-record-generics-v1");
  assert.equal(spec.status, "TARGET_NOT_EXECUTED");
  assert.equal(backs.length, 11);
  assert.equal(spec.cases.length, 21);
  assert.equal(new Set(spec.cases.map(x => x.id)).size, spec.cases.length);
  for (const b of backs) assert.equal(spec.backend_status[b], "not_executed");
  for (const c of spec.cases) {
    assert.equal(c.status,"not_executed");
    const src=read(c.fixture);
    assert.ok(src.includes("pub fnc main(): int"), c.id);
    assert.ok(c.fixture.startsWith("fixtures/factories/"),c.id);
    for(const b of backs) assert.equal(c.evidence[b],"not_executed",c.id+"/"+b);
    if(c.expect==="accept") assert.ok(Number.isInteger(c.expected_exit),c.id);
    else { assert.equal(c.expect,"reject"); assert.match(c.expected_error,/^E_[A-Z_]+$/); }
  }
});
test("user factory example is preserved as compiled guest target 21", () => {
  const s=read("fixtures/factories/pass/canonical_of_21.atto");
  for(const frag of ["Tuple.of(10, 20)","Array.of(1, 2, 3)","List.of(\"Atto\", \"Lima\")","Map.of(\"a\", 10, \"b\", 20)","Record.of(name=\"Atto\", count=3)","return values[0] + pair[1]"]) assert.ok(s.includes(frag),frag);
});
