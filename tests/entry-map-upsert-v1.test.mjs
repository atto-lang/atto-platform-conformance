import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const registry = JSON.parse(read("contracts/entry-map-upsert-v1.json"));
const states = new Set(["passed", "failed", "unsupported", "not_executed"]);
test("Entry/Map registry is source-only and has explicit per-backend uncertainty", () => {
  assert.equal(registry.schema_version, 1);
  assert.equal(registry.contract, "atto-entry-map-upsert-v1");
  assert.equal(registry.status, "TARGET_NOT_EXECUTED");
  assert.equal(new Set(registry.cases.map(c => c.id)).size, registry.cases.length);
  assert.equal(registry.cases.length, 5);
  const backs = Object.keys(registry.backend_status);
  assert.ok(backs.length >= 9);
  for (const backend of backs) assert.equal(registry.backend_status[backend], "not_executed");
  for (const c of registry.cases) {
    assert.ok(states.has(c.status));
    assert.equal(c.status, "not_executed");
    assert.ok(c.fixture.endsWith(".atto"));
    assert.ok(read(c.fixture).includes("pub fnc main(): int"), c.id);
    for (const backend of backs) assert.equal(c.evidence[backend], "not_executed", backend + "/" + c.id);
    if (c.expect === "accept") assert.equal(c.expected_exit, 5);
    else {
      assert.equal(c.expect, "reject");
      assert.match(c.expected_error, /^E_[A-Z_]+$/);
    }
  }
});
test("the executable target is precisely the Entry plus Map mutation regression", () => {
  const source = read("fixtures/collections/pass/entry_map_upsert.atto");
  for (const text of ['let Entry<string, int> entry = "foo" => 5;', "let mut Map<string, int> x",
    'x.set("foo", 6);', 'x["foo"] = 3;', "x.add(entry);", 'x.get("foo").unwrap()']) {
    assert.ok(source.includes(text), text);
  }
});
