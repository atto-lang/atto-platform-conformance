import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const vectorJson = JSON.parse(readFileSync(new URL(
  "../contracts/fixtures/aot-wire-scalar-v1-vectors.json", import.meta.url), "utf8"));
const text = readFileSync(new URL(
  "../contracts/fixtures/aot-wire-scalar-v1-vectors.txt", import.meta.url), "utf8");
const lines = text.trimEnd().split("\n");
const rows = lines.slice(1).map(line => line.split("|"));
const positives = rows.filter(row => row[0] === "P");
const negatives = rows.filter(row => row[0] === "N");
const b64 = s => Buffer.from(s, "utf8").toString("base64");

test("portable text vectors have pinned format and cardinality", () => {
  assert.ok(lines[0].startsWith("# attolang.aot-wire-scalar-fixtures/1;"));
  assert.equal(positives.length, 8);
  assert.equal(negatives.length, 15);
  assert.equal(rows.length, 23);
});

test("all eight positive vectors exactly match canonical JSON fields and wire bytes", () => {
  for (const [i, vector] of vectorJson.positive.entries()) {
    const row = positives[i];
    assert.equal(row.length, 7, vector.id);
    assert.deepEqual(row, ["P", vector.id, vector.expected.i64,
      String(vector.expected.bool), b64(vector.expected.string),
      b64(vector.json), vector.messagePackHex], vector.id);
  }
});

test("all 15 negative vectors exactly match canonical rejection inputs", () => {
  for (const [i, vector] of vectorJson.negative.entries()) {
    const row = negatives[i];
    assert.equal(row.length, 4, vector.id);
    assert.equal(vector.expected, "REJECT");
    assert.deepEqual(row, ["N", vector.id, vector.format,
      vector.format === "json" ? b64(vector.value) : vector.hex], vector.id);
  }
});

test("portable corpus cannot claim execution or introduce unchecked columns", () => {
  assert.equal(vectorJson.executionEvidence, "NOT_EXECUTED");
  assert.ok(rows.every(row => row.length === (row[0] === "P" ? 7 : 4)));
  assert.equal(new Set(rows.map(row => row[1])).size, 23);
  assert.ok(rows.every(row => /^[a-z][a-z0-9_]{1,99}$/.test(row[1])));
});

test("positive i64 decimal strings and MessagePack hex are exact and bounded", () => {
  for (const row of positives) {
    assert.match(row[2], /^-?(0|[1-9][0-9]*)$/);
    const n = BigInt(row[2]);
    assert.ok(n >= -(1n << 63n) && n < 1n << 63n);
    assert.match(row[6], /^[0-9a-f]+$/);
    assert.equal(row[6].length % 2, 0);
    assert.ok(row[6].length / 2 <= 65_536);
    assert.equal(Buffer.from(row[5], "base64").toString("base64"), row[5]);
  }
});

test("negative format is closed and all payloads are canonical byte encodings", () => {
  for (const row of negatives) {
    assert.ok(row[2] === "json" || row[2] === "messagepack");
    if (row[2] === "json") {
      assert.match(row[3], /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
      assert.equal(Buffer.from(row[3], "base64").toString("base64"), row[3]);
    } else {
      assert.match(row[3], /^[0-9a-f]+$/);
      assert.equal(row[3].length % 2, 0);
    }
  }
});
