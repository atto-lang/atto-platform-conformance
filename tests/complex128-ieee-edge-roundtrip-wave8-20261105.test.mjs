// Source-local Node reference tests only; no compiler, guest or backend parity claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeComplex128Wire, decodeComplex128Wire, isCanonicalComplex128Wire
} from '../src/complex128-wire.mjs';

test('signed infinities preserve IEEE-754 bits and little-endian ordering', () => {
  const wire = encodeComplex128Wire('7ff0000000000000', 'fff0000000000000');
  assert.equal(wire.toString('hex'), '000000000000f07f000000000000f0ff');
  assert.deepEqual(decodeComplex128Wire(wire), {
    realBits: '7ff0000000000000', imaginaryBits: 'fff0000000000000'
  });
  assert.equal(isCanonicalComplex128Wire(wire), true);
});

test('positive and negative minimal subnormals survive without zero normalization', () => {
  const wire = encodeComplex128Wire('0000000000000001', '8000000000000001');
  assert.deepEqual(decodeComplex128Wire(wire), {
    realBits: '0000000000000001', imaginaryBits: '8000000000000001'
  });
  assert.equal(wire.toString('hex'), '01000000000000000100000000000080');
});

test('negative quiet NaNs are normalized when encoding but denied on direct wire input', () => {
  const canonical = encodeComplex128Wire('fff8000000000000', '7ff8000000000001');
  assert.deepEqual(decodeComplex128Wire(canonical), {
    realBits: '7ff8000000000000', imaginaryBits: '7ff8000000000000'
  });
  for (const offset of [0, 8]) {
    const noncanonical = Buffer.alloc(16);
    noncanonical.writeBigUInt64LE(0xfff8000000000000n, offset);
    assert.equal(isCanonicalComplex128Wire(noncanonical), false);
    assert.throws(() => decodeComplex128Wire(noncanonical), /noncanonical complex128 NaN/);
  }
});

test('independent encodes do not retain mutable prior wire storage', () => {
  const one = encodeComplex128Wire('3ff0000000000000', 'bff0000000000000');
  const two = encodeComplex128Wire('3ff0000000000000', 'bff0000000000000');
  assert.notStrictEqual(one, two);
  one.fill(0);
  assert.deepEqual(decodeComplex128Wire(two), {
    realBits: '3ff0000000000000', imaginaryBits: 'bff0000000000000'
  });
});
