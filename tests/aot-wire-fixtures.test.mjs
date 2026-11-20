import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fixtures = JSON.parse(readFileSync(
  new URL("../contracts/fixtures/aot-wire-scalar-v1-vectors.json", import.meta.url),
  "utf8"));

test("portable codec vectors are candidate-only, never execution receipts", () => {
  assert.equal(fixtures.contract, "attolang.aot-wire-scalar-fixtures/1");
  assert.equal(fixtures.executionEvidence, "NOT_EXECUTED");
  assert.equal(fixtures.sourceNominal, "__root__.MatrixPayload");
  assert.equal(fixtures.sourcePackageIdentityClaim, "matrix-fixture@1");
});
test("all 23 golden vectors have unique reviewable IDs", () => {
  assert.equal(fixtures.positive.length, 8);
  assert.equal(fixtures.negative.length, 15);
  const ids = [...fixtures.positive, ...fixtures.negative].map(v => v.id);
  assert.equal(new Set(ids).size, 23);
  assert.ok(ids.every(id => /^[a-z][a-z0-9_]+$/.test(id)));
});
test("positive JSON vectors preserve exact i64 decimal syntax", () => {
  for (const vector of fixtures.positive) {
    const decimal = vector.expected.i64;
    assert.match(decimal, /^-?(0|[1-9][0-9]*)$/);
    const integer = BigInt(decimal);
    assert.ok(integer >= -(1n << 63n) && integer <= ((1n << 63n) - 1n));
    assert.ok(vector.json.includes('"number":' + decimal + ','));
    const parsed = JSON.parse(vector.json);
    assert.equal(parsed.text, vector.expected.string);
    assert.equal(parsed.active, vector.expected.bool);
    assert.deepEqual(Object.keys(parsed), ["number", "text", "active"]);
  }
});
test("positive MessagePack vectors are bounded three-field maps", () => {
  for (const vector of fixtures.positive) {
    assert.match(vector.messagePackHex, /^[0-9a-f]+$/);
    assert.equal(vector.messagePackHex.length % 2, 0);
    assert.ok(vector.messagePackHex.startsWith("83"));
    assert.ok(vector.messagePackHex.length / 2 <= 65536);
    assert.ok(vector.messagePackHex.includes("a66e756d626572")); // number key
    assert.ok(vector.messagePackHex.includes("a474657874")); // text key
    assert.ok(vector.messagePackHex.includes("a6616374697665")); // active key
  }
});
test("UTF-8 and MessagePack str8/str16 transition vectors are explicit", () => {
  const byId = Object.fromEntries(fixtures.positive.map(v => [v.id, v]));
  assert.ok(byId.utf8_rocket.messagePackHex.includes("f09f9a80"));
  assert.ok(byId.str8_boundary.messagePackHex.includes("d920"));
  assert.ok(byId.str16_boundary.messagePackHex.includes("da0100"));
  assert.equal(byId.str8_boundary.expected.string.length, 32);
  assert.equal(byId.str16_boundary.expected.string.length, 256);
});
test("negative vectors state denial, not executable proof", () => {
  for (const vector of fixtures.negative) {
    assert.equal(vector.expected, "REJECT");
    assert.ok(vector.format === "json" || vector.format === "messagepack");
    if (vector.format === "json") {
      assert.equal(typeof vector.value, "string");
      assert.equal(vector.hex, undefined);
    } else {
      assert.match(vector.hex, /^[0-9a-f]+$/);
      assert.equal(vector.hex.length % 2, 0);
      assert.ok(vector.hex.length / 2 <= 65536);
      assert.equal(vector.value, undefined);
    }
  }
});
test("portable negative corpus includes identity, integer and structural denials", () => {
  const ids = new Set(fixtures.negative.map(v => v.id));
  for (const required of [
    "json_missing", "json_duplicate", "json_unknown", "json_fraction",
    "json_overflow", "msgpack_duplicate", "msgpack_unknown",
    "msgpack_float64", "msgpack_uint64", "msgpack_truncated",
    "msgpack_trailing", "msgpack_map32", "msgpack_bad_utf8"
  ]) assert.ok(ids.has(required), required);
});
test("fixture cardinalities cannot masquerade as backend coverage", () => {
  assert.equal(fixtures.executionEvidence, "NOT_EXECUTED");
  assert.ok(!Object.hasOwn(fixtures, "nativeExecutableSHA256"));
  assert.ok(!Object.hasOwn(fixtures, "backendReceipts"));
});
