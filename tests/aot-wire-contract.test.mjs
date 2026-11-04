import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyAotWireContract } from "../bin/verify-aot-wire-contract.mjs";

const manifest = JSON.parse(readFileSync(
  new URL("../contracts/aot-wire-json-msgpack-v1.json", import.meta.url), "utf8"));
const clone = () => structuredClone(manifest);

test("wire manifest pins all 32 candidate cases without claiming execution", () => {
  assert.deepEqual(verifyAotWireContract(manifest), []);
  assert.equal(manifest.cases.length, 32);
  assert.ok(manifest.cases.every(c => c.evidence === "NOT_EXECUTED"));
});
test("cannot expand wire scalars or reflection authority", () => {
  const changed = clone();
  changed.supportedScalarTypes.push("any");
  assert.ok(verifyAotWireContract(changed).length);
  changed.supportedScalarTypes.pop();
  changed.runtimeReflectionAllowed = true;
  assert.ok(verifyAotWireContract(changed).length);
});
test("cannot claim native guest execution from authored tests", () => {
  const changed = clone();
  changed.cases.find(c => c.id === "aot.native_guest_execution").evidence = "PASS";
  assert.ok(verifyAotWireContract(changed).some(e => e.includes("fabricated")));
});
test("required negative witness cannot be silently replaced", () => {
  const changed = clone();
  changed.cases.find(c => c.id === "json.malformed_utf8").id = "json.fake_positive";
  assert.ok(verifyAotWireContract(changed).some(e => e.includes("required")));
});
test("duplicate witness IDs are not enough to retain 32-case coverage", () => {
  const changed = clone();
  changed.cases[1].id = changed.cases[0].id;
  assert.ok(verifyAotWireContract(changed).some(e => e.includes("duplicated")));
});
test("new backends cannot acquire unreviewed parity status", () => {
  const changed = clone();
  changed.backends.push("unknown");
  assert.ok(verifyAotWireContract(changed).some(e => e.includes("backend")));
  const scope = clone();
  scope.cases[0].backends = ["java"];
  assert.ok(verifyAotWireContract(scope).some(e => e.includes("scope")));
});
test("wire byte budgets remain bounded and depth is closed", () => {
  const changed = clone();
  changed.limits.maxDepth = 8;
  assert.ok(verifyAotWireContract(changed).some(e => e.includes("budget")));
  const large = clone();
  large.limits.inputBytes = 1 << 29;
  assert.ok(verifyAotWireContract(large).some(e => e.includes("budget")));
});
test("JSON and MessagePack must be explicit, separate codecs", () => {
  const changed = clone();
  changed.codecs = ["json"];
  assert.ok(verifyAotWireContract(changed).some(e => e.includes("codecs")));
});
test("schema fingerprint requirement cannot be replaced by nominal type ID", () => {
  const changed = clone();
  changed.schemaIdentity = "nominal-type-id-only";
  assert.ok(verifyAotWireContract(changed).some(e => e.includes("schema identity")));
});
test("wire cases must remain backend-scoped and structurally valid", () => {
  for (const bad of [null, [], 7, {id:"aot.unknown", evidence:"NOT_EXECUTED"}]) {
    const changed = clone();
    changed.cases[0] = bad;
    assert.ok(verifyAotWireContract(changed).length);
  }
});
