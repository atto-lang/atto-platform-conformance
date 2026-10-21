import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  encodeComplex128Wire,
  decodeComplex128Wire,
  isCanonicalComplex128Wire
} from "../src/complex128-wire.mjs";

const contract = JSON.parse(await readFile(
  new URL("../contracts/v1/numeric-complex/complex128-wire-v1.json", import.meta.url),
  "utf8"));

const BACKENDS = ["java", "llvm", "net", "wasm", "forge"];

function strictKeys(value, keys) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}

test("complex128 wire contract is closed, canonical and explicitly unverified", () => {
  strictKeys(contract, [
    "schemaVersion","scope","byteLength","endianness","fields",
    "canonicalization","cases","evidence"
  ]);
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.scope, "complex128-wire-v1");
  assert.equal(contract.byteLength, 16);
  assert.equal(contract.endianness, "little");
  assert.deepEqual(contract.fields, [
    {name:"real",offset:0,bytes:8,encoding:"ieee754-binary64-raw-le"},
    {name:"imaginary",offset:8,bytes:8,encoding:"ieee754-binary64-raw-le"}
  ]);
  strictKeys(contract.canonicalization,
    ["finite","signedZero","infinity","nan"]);
  assert.equal(contract.canonicalization.finite, "preserve-all-bits");
  assert.equal(contract.canonicalization.signedZero, "preserve-sign-bit");
  assert.equal(contract.canonicalization.infinity, "preserve-sign-bit");
  assert.match(contract.canonicalization.nan, /7ff8000000000000/);

  strictKeys(contract.evidence,
    ["sourceFreeContractOnly","exactBackendCodecExecution","backendStatus"]);
  assert.equal(contract.evidence.sourceFreeContractOnly, true);
  assert.equal(contract.evidence.exactBackendCodecExecution, false);
  assert.deepEqual(Object.keys(contract.evidence.backendStatus).sort(),
    [...BACKENDS].sort());
  for (const backend of BACKENDS)
    assert.equal(contract.evidence.backendStatus[backend], "unverified");

  const ids = new Set();
  for (const c of contract.cases) {
    strictKeys(c, [
      "id","inputRealBits","inputImaginaryBits","wireHex",
      "decodedRealBits","decodedImaginaryBits"
    ]);
    assert.match(c.id, /^[a-z0-9-]+$/);
    assert.equal(ids.has(c.id), false, "duplicate case " + c.id);
    ids.add(c.id);
    for (const key of [
      "inputRealBits","inputImaginaryBits",
      "decodedRealBits","decodedImaginaryBits"
    ]) assert.match(c[key], /^[0-9a-f]{16}$/);
    assert.match(c.wireHex, /^[0-9a-f]{32}$/);
  }
});

test("reference encoder/decoder matches all frozen vectors", () => {
  for (const c of contract.cases) {
    const encoded = encodeComplex128Wire(
      c.inputRealBits, c.inputImaginaryBits);
    assert.equal(encoded.toString("hex"), c.wireHex, c.id);
    const decoded = decodeComplex128Wire(encoded);
    assert.deepEqual(decoded, {
      realBits:c.decodedRealBits,
      imaginaryBits:c.decodedImaginaryBits
    }, c.id);
    assert.equal(isCanonicalComplex128Wire(encoded), true, c.id);
  }
});

test("decoder rejects noncanonical NaN payloads, signs and lengths", () => {
  const variants = [
    "420000000000f87f0000000000000000",
    "000000000000f8ff0000000000000000",
    "0000000000000000341200000000f8ff"
  ];
  for (const hex of variants) {
    const bytes = Buffer.from(hex, "hex");
    assert.equal(bytes.length, 16);
    assert.throws(() => decodeComplex128Wire(bytes), /noncanonical/);
    assert.equal(isCanonicalComplex128Wire(bytes), false);
  }
  for (const length of [0, 1, 15, 17, 32])
    assert.throws(() => decodeComplex128Wire(Buffer.alloc(length)),
      /exactly 16 bytes/);
});

test("wire is real-first little-endian and preserves signed zero", () => {
  const encoded = encodeComplex128Wire(
    "8000000000000000", "0000000000000001");
  assert.equal(encoded.subarray(0,8).toString("hex"),
    "0000000000000080");
  assert.equal(encoded.subarray(8,16).toString("hex"),
    "0100000000000000");
});

test("NaN encoder canonicalizes payload, sign and signaling variants", () => {
  const inputs = [
    "7ff0000000000001",
    "7ff8000000000042",
    "fff0000000000001",
    "fff8000000001234"
  ];
  for (const bits of inputs) {
    const wire = encodeComplex128Wire(bits, "0000000000000000");
    assert.equal(wire.subarray(0,8).toString("hex"),
      "000000000000f87f");
    assert.deepEqual(decodeComplex128Wire(wire), {
      realBits:"7ff8000000000000",
      imaginaryBits:"0000000000000000"
    });
  }
});
