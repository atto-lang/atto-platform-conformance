// Source-free IEEE-754 bit-identity checks, not native compiler parity.
import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeComplex128Wire, decodeComplex128Wire, isCanonicalComplex128Wire}
  from '../src/complex128-wire.mjs';

test('signed zero survives both real/imaginary wire positions and little-endian order', () => {
  for (const real of ['0000000000000000', '8000000000000000']) {
    for (const imaginary of ['0000000000000000', '8000000000000000']) {
      const bytes = encodeComplex128Wire(real, imaginary);
      assert.equal(bytes.readBigUInt64LE(0).toString(16).padStart(16,'0'), real);
      assert.equal(bytes.readBigUInt64LE(8).toString(16).padStart(16,'0'), imaginary);
      assert.deepEqual(decodeComplex128Wire(bytes), {realBits:real, imaginaryBits:imaginary});
      assert.equal(isCanonicalComplex128Wire(bytes), true);
    }
  }
});

test('component subviews decode exactly sixteen owned bytes', () => {
  const bytes = encodeComplex128Wire('3ff0000000000000','bff0000000000000');
  const storage = new Uint8Array(40).fill(0xff);
  storage.set(bytes, 11);
  const subview = storage.subarray(11, 27);
  assert.deepEqual(decodeComplex128Wire(subview),
    {realBits:'3ff0000000000000', imaginaryBits:'bff0000000000000'});
  assert.equal(isCanonicalComplex128Wire(storage), false);
});

test('noncanonical NaN payloads are rejected, encoding canonicalizes both lanes', () => {
  const bytes = encodeComplex128Wire('fff0000000000001','7ff0000000000001');
  assert.deepEqual(decodeComplex128Wire(bytes),
    {realBits:'7ff8000000000000', imaginaryBits:'7ff8000000000000'});
  const hostile = Buffer.from(bytes);
  hostile.writeBigUInt64LE(0xfff0000000000001n,8);
  assert.equal(isCanonicalComplex128Wire(hostile), false);
  assert.throws(() => decodeComplex128Wire(hostile), /noncanonical complex128 NaN/);
});
