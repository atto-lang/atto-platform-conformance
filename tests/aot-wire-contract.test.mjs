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


test("all 32 oracle IDs retain their reviewed stage classification", () => {
  for (const original of manifest.cases) {
    const altered = clone();
    const item = altered.cases.find(c => c.id === original.id);
    item.kind = item.kind === "negative" ? "codec" : "negative";
    assert.ok(verifyAotWireContract(altered).some(e =>
      e.includes("canonical oracle classification changed")), original.id);
  }
});
test("unsupported wire feature list cannot be weakened or expanded", () => {
  for (const mutate of [
    c => c.unsupported.pop(),
    c => c.unsupported.reverse(),
    c => c.unsupported.push("dynamic code generation"),
    c => c.unsupported.splice(c.unsupported.indexOf("field aliases"), 1)
  ]) {
    const altered = clone();
    mutate(altered);
    assert.ok(verifyAotWireContract(altered).some(e => e.includes("unsupported")));
  }
});
test("closed nominal required-field decoding policy cannot change silently", () => {
  for (const shape of ["open-polymorphic", "optional-missing-fields", "", null]) {
    const altered = clone();
    altered.serializationShape = shape;
    assert.ok(verifyAotWireContract(altered).some(e => e.includes("wire shape")));
  }
});
test("unreviewed top-level permissions are not silently accepted", () => {
  const altered = clone();
  altered.allowDynamicClassLoading = true;
  assert.ok(verifyAotWireContract(altered).some(e => e.includes("top-level")));
});
test("unreviewed oracle runtime and backend status fields reject", () => {
  for (const key of ["nativeArtifactSHA", "runnerSteps", "approved", "runtimeReflectionAllowed"]) {
    const altered = clone();
    altered.cases[0][key] = "PASS";
    assert.ok(verifyAotWireContract(altered).some(e => e.includes("oracle fields")), key);
  }
});
test("cannot delete a rejection policy property", () => {
  for (const key of ["unsupported", "serializationShape", "schemaIdentity",
                     "runtimeReflectionAllowed", "limits"]) {
    const altered = clone();
    delete altered[key];
    assert.ok(verifyAotWireContract(altered).length > 0, key);
  }
});
test("backend order is canonical and cannot swap unreviewed labels", () => {
  const altered = clone();
  [altered.backends[0], altered.backends[4]] = [altered.backends[4], altered.backends[0]];
  assert.ok(verifyAotWireContract(altered).some(e => e.includes("backends")));
});
test("each oracle's backend scope remains exact and complete", () => {
  for (const original of manifest.cases) {
    const altered = clone();
    altered.cases.find(c => c.id === original.id).backends.pop();
    assert.ok(verifyAotWireContract(altered).some(e => e.includes("backend scope")), original.id);
  }
});
test("case count must fail closed on omitted or inserted oracles", () => {
  const fewer = clone(); fewer.cases.pop();
  const extra = clone(); extra.cases.push(structuredClone(extra.cases[0]));
  assert.ok(verifyAotWireContract(fewer).some(e => e.includes("32 oracle")));
  assert.ok(verifyAotWireContract(extra).some(e => e.includes("32 oracle")));
});
test("a new evidence status cannot claim cross-backend native parity", () => {
  for (const status of ["PASS", "HOST_ONLY", "RAN", "INFERRED", null, true]) {
    const altered = clone();
    altered.cases.find(c => c.id === "aot.cross_backend_differential").evidence = status;
    assert.ok(verifyAotWireContract(altered).some(e => e.includes("fabricated")));
  }
});
test("malformed manifest inputs fail closed without throwing", () => {
  for (const invalid of [null, false, true, 7, "", [], {}, { cases: [] },
                         { ...clone(), cases: null }]) {
    assert.doesNotThrow(() => verifyAotWireContract(invalid));
    assert.ok(verifyAotWireContract(invalid).length > 0);
  }
});
test("case order does not invent new proof or relax stage requirements", () => {
  const reversed = clone();
  reversed.cases.reverse();
  assert.deepEqual(verifyAotWireContract(reversed), []);
  reversed.cases.find(c => c.id === "json.malformed_utf8").kind = "codec";
  assert.ok(verifyAotWireContract(reversed).some(e =>
    e.includes("canonical oracle classification changed")));
});
