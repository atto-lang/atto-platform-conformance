import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeComplex128Wire,decodeComplex128Wire,isCanonicalComplex128Wire
} from '../src/complex128-wire.mjs';

test('real and imaginary signed zeros preserve separate exact little-endian bits', () => {
  const bytes=encodeComplex128Wire('8000000000000000','0000000000000000');
  assert.equal(bytes.length,16);
  assert.deepEqual(decodeComplex128Wire(bytes),{
    realBits:'8000000000000000',imaginaryBits:'0000000000000000'
  });
  assert.equal(isCanonicalComplex128Wire(bytes),true);
});

test('all positive and negative NaN input payloads become canonical positive quiet NaN', () => {
  const bytes=encodeComplex128Wire('7ff0000000000001','fff8000000000001');
  assert.deepEqual(decodeComplex128Wire(bytes),{
    realBits:'7ff8000000000000',imaginaryBits:'7ff8000000000000'
  });
  assert.ok(isCanonicalComplex128Wire(new Uint8Array(bytes)));
});

test('noncanonical NaN payloads on either half are denied', () => {
  for (const offset of [0,8]) {
    const bytes=Buffer.alloc(16);
    bytes.writeBigUInt64LE(0x7ff0000000000001n,offset);
    assert.throws(() => decodeComplex128Wire(bytes), /noncanonical complex128 NaN/);
    assert.equal(isCanonicalComplex128Wire(bytes),false);
  }
});

test('malformed hex and wrong-size binary frames never decode', () => {
  for (const bits of ['7FF8000000000000','abc','zzzzzzzzzzzzzzzz']) {
    assert.throws(() => encodeComplex128Wire(bits,'0000000000000000'),TypeError);
  }
  for (const n of [0,15,17]) {
    assert.throws(() => decodeComplex128Wire(Buffer.alloc(n)),RangeError);
  }
});