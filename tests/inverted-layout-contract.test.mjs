import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const contract = JSON.parse(readFileSync(
  new URL("../contracts/v1/inverted-layout/cases.json", import.meta.url), "utf8"));
const fixtureDir = new URL("../fixtures/inverted-layout/", import.meta.url);
const expected = [
  ["declaration/inverted-struct", "accept", "source"],
  ["declaration/inverted-class", "accept", "source"],
  ["collection/ordinary-struct-explicit-soa", "accept", "source"],
  ["collection/ordinary-class-explicit-soa", "accept", "source"],
  ["collection/no-implicit-array-conversion", "reject", "source"],
  ["nesting/ordinary-struct-packed-column", "accept", "guest"],
  ["nesting/inverted-struct-no-implicit-recursion", "reject", "source"],
  ["nesting/inverted-class-no-implicit-recursion", "reject", "source"],
  ["ownership/foreign-stale-forged-handle", "reject", "guest"],
  ["ownership/swap-delete-identity", "accept", "guest"],
  ["ownership/close-with-active-loan", "reject", "guest"],
  ["ownership/row-snapshot-detached", "accept", "guest"],
  ["admission/pointer-member", "reject", "source"],
  ["admission/recursive-member", "reject", "source"],
  ["admission/failed-atomic-push", "accept", "guest"],
  ["loan/disjoint-field-writes", "accept", "guest"],
  ["loan/overlapping-field-writes", "reject", "guest"],
  ["loan/await-escape", "reject", "source"]
];

test("exact normative one-level inversion contract and no false backend certification", () => {
  assert.deepEqual(Object.keys(contract).sort(), [
    "cases", "contract", "reference", "rules", "scope", "target_status", "version"].sort());
  assert.equal(contract.contract, "oreslang.explicit-inverted-layout");
  assert.equal(contract.version, 1);
  assert.equal(contract.scope, "PROPOSED_SOURCES_AND_EXECUTABLE_HOST_REFERENCE_ONLY");
  assert.equal(contract.reference, "src/inverted-layout-reference.mjs");
  assert.deepEqual(Object.keys(contract.target_status).sort(),
    ["java", "llvm", "wasm", "net", "forge", "js"].sort());
  for (const state of Object.values(contract.target_status))
    assert.equal(state, "NOT_EXECUTED");
  assert.deepEqual(contract.cases.map(c => [c.id, c.expected, c.requires]), expected);
  for (const c of contract.cases)
    assert.deepEqual(Object.keys(c).sort(), ["expected", "id", "requires"]);
  assert.equal(new Set(contract.cases.map(c => c.id)).size, expected.length);
  assert.equal(contract.rules.length, 9);
  assert.match(contract.rules[3], /nested ordinary struct stays one packed field/);
  assert.match(contract.rules[4], /nested inverted class or struct is rejected/);
});

test("source fixtures distinguish expected compile success from targeted rejections", () => {
  const cases = [
    ["positive_inverted_struct.ores", true, /define inverted struct Position/],
    ["positive_ordinary_struct_explicit_collection.ores", true, /InvertedArray<Point>/],
    ["positive_packed_nested_struct.ores", true, /Vec3 position/],
    ["negative_nested_inverted_struct.ores", false, /Inner inner/],
    ["negative_implicit_collection.ores", false, /Array<Row>/],
    ["negative_recursive_struct.ores", false, /Recursive child/]
  ];
  for (const [name, positive, match] of cases) {
    const source = readFileSync(new URL(name, fixtureDir), "utf8");
    assert.match(source, match);
    assert.match(source, /fnc main\(\): int/);
    if (positive) assert.match(source, /PROPOSED guest-source positive/);
    else assert.match(source, /EXPECT-COMPILE-ERROR:/);
  }
});
