import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeComplex128Wire,decodeComplex128Wire,isCanonicalComplex128Wire
} from '../src/complex128-wire.mjs';

test('complex128 round-trip preserves distinct IEEE-754 signed zero bits',()=>{
  const bytes=encodeComplex128Wire('8000000000000000','0000000000000000');
  assert.equal(bytes.length,16);
  assert.deepEqual(decodeComplex128Wire(bytes),{
    realBits:'8000000000000000',
    imaginaryBits:'0000000000000000'
  });
  assert.equal(isCanonicalComplex128Wire(bytes),true);
  assert.equal(bytes[7],0x80,'real component is little-endian');
});

test('each positive or negative signalling NaN normalizes to one canonical quiet NaN',()=>{
  const bytes=encodeComplex128Wire('7ff0000000000001','fff0000000000001');
  assert.deepEqual(decodeComplex128Wire(bytes),{
    realBits:'7ff8000000000000',
    imaginaryBits:'7ff8000000000000'
  });
  assert.equal(isCanonicalComplex128Wire(bytes),true);
});

test('noncanonical NaN payloads cannot enter through decoder aliases',()=>{
  for(const offset of [0,8]){
    const invalid=Buffer.alloc(16);
    invalid.writeBigUInt64LE(0x7ff0000000000001n,offset);
    assert.equal(isCanonicalComplex128Wire(invalid),false);
    assert.throws(()=>decodeComplex128Wire(invalid),/noncanonical complex128 NaN/);
  }
});

test('canonical bit grammar and exact 16-byte width are required',()=>{
  for(const hex of ['7FF8000000000000','7ff800000000000','gff8000000000000'])
    assert.throws(()=>encodeComplex128Wire(hex,'0000000000000000'),
      /16 lowercase hex digits/);
  for(const length of [0,15,17]){
    assert.equal(isCanonicalComplex128Wire(new Uint8Array(length)),false);
    assert.throws(()=>decodeComplex128Wire(new Uint8Array(length)),
      /exactly 16 bytes/);
  }
});
