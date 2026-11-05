// Host-only IEEE-754 complex wire model; not native or AttoLang guest parity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeComplex128Wire, decodeComplex128Wire, isCanonicalComplex128Wire } from '../src/complex128-wire.mjs';

test('positive and negative zeros preserve distinct component bits and order', () => {
  for (const [real, imag] of [
    ['0000000000000000','8000000000000000'],
    ['8000000000000000','0000000000000000'],
    ['8000000000000000','8000000000000000'],
    ['0000000000000000','0000000000000000']
  ]) {
    const raw=encodeComplex128Wire(real,imag);
    assert.equal(raw.length,16);
    assert.deepEqual(decodeComplex128Wire(raw),{realBits:real, imaginaryBits:imag});
    assert.equal(isCanonicalComplex128Wire(raw),true);
  }
});

test('subnormal and maximum finite components round-trip across sliced byte views', () => {
  const pairs=[
    ['0000000000000001','8000000000000001'],
    ['000fffffffffffff','800fffffffffffff'],
    ['7fefffffffffffff','ffefffffffffffff']
  ];
  for (const [real,imag] of pairs) {
    const encoded=encodeComplex128Wire(real,imag);
    const framing=Buffer.alloc(25,0x7d);
    encoded.copy(framing,5);
    const subview=new Uint8Array(framing.buffer,framing.byteOffset+5,16);
    assert.deepEqual(decodeComplex128Wire(subview),{realBits:real,imaginaryBits:imag});
    assert.equal(isCanonicalComplex128Wire(subview),true);
    assert.equal(framing[4],0x7d);
    assert.equal(framing[21],0x7d);
  }
});

test('noncanonical NaN in imaginary component is rejected without damaging real bits', () => {
  const canonical=encodeComplex128Wire('3ff0000000000000','7ff8000000000000');
  const tampered=Buffer.from(canonical);
  tampered.writeBigUInt64LE(0xfff0000000000001n,8);
  assert.equal(isCanonicalComplex128Wire(tampered),false);
  assert.throws(()=>decodeComplex128Wire(tampered),/noncanonical complex128 NaN encoding in imaginary/);
  assert.equal(canonical.readBigUInt64LE(0),0x3ff0000000000000n);
  assert.equal(canonical.readBigUInt64LE(8),0x7ff8000000000000n);
});

test('malformed component widths and non-string encodings fail closed',()=>{
  for(const bits of [null,0,0n,{},'000000000000000','00000000000000000','0'.repeat(15)+'A']){
    assert.throws(()=>encodeComplex128Wire(bits,'0000000000000000'),TypeError);
  }
  for(const n of [0,1,15,17,32]){
    assert.equal(isCanonicalComplex128Wire(Buffer.alloc(n)),false);
    assert.throws(()=>decodeComplex128Wire(Buffer.alloc(n)),RangeError);
  }
});
