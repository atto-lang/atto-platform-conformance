// Host-only IEEE-754 wire reference; not an AttoLang compiler/guest parity test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeComplex128Wire, decodeComplex128Wire, isCanonicalComplex128Wire}
  from '../src/complex128-wire.mjs';

const U64=(1n<<64n)-1n;
const SIGN=1n<<63n;
const EXP=0x7ffn<<52n;
const hex=x=>(x&U64).toString(16).padStart(16,'0');

test('finite exponent, fraction and sign partitions round-trip without numeric coercion',()=>{
  const exponents=[0n,1n,2n,1022n,1023n,1024n,2045n,2046n];
  const fractions=[0n,1n,1n<<51n,(1n<<52n)-1n];
  let probes=0;
  for(const exp of exponents)for(const fraction of fractions)for(const sign of [0n,SIGN]){
    const bits=sign|(exp<<52n)|fraction;
    const other=bits^SIGN;
    const bytes=encodeComplex128Wire(hex(bits),hex(other));
    assert.equal(bytes.readBigUInt64LE(0),bits);
    assert.equal(bytes.readBigUInt64LE(8),other);
    assert.deepEqual(decodeComplex128Wire(bytes),{realBits:hex(bits),imaginaryBits:hex(other)});
    assert.equal(isCanonicalComplex128Wire(bytes),true);
    probes++;
  }
  assert.equal(probes,64);
});

test('deterministic 1024-bit-pattern corpus preserves exact finite wire identities',()=>{
  let seed=0x123456789abcdef0n;
  for(let i=0;i<1024;i++){
    seed=(seed*6364136223846793005n+1442695040888963407n)&U64;
    const real=(seed&EXP)===EXP ? seed^(1n<<52n) : seed;
    const imaginary=real^SIGN;
    const wire=encodeComplex128Wire(hex(real),hex(imaginary));
    assert.deepEqual(decodeComplex128Wire(new Uint8Array(wire)),{
      realBits:hex(real),imaginaryBits:hex(imaginary)
    });
  }
});

test('all NaN sign and payload classes canonicalize only at encoding',()=>{
  const payloads=[1n,2n,1n<<51n,(1n<<52n)-1n];
  for(const sign of [0n,SIGN])for(const payload of payloads){
    const bits=sign|EXP|payload;
    const wire=encodeComplex128Wire(hex(bits),'0000000000000000');
    assert.equal(wire.readBigUInt64LE(0),0x7ff8000000000000n);
    assert.equal(isCanonicalComplex128Wire(wire),true);
    if(bits!==0x7ff8000000000000n){
      const noncanonical=Buffer.from(wire);
      noncanonical.writeBigUInt64LE(bits,0);
      assert.equal(isCanonicalComplex128Wire(noncanonical),false);
      assert.throws(()=>decodeComplex128Wire(noncanonical),/noncanonical complex128 NaN/);
    }
  }
});

test('malformed bit text and binary lengths fail closed without partial values',()=>{
  for(const bits of ['', '0'.repeat(15),'0'.repeat(17),'0'.repeat(15)+'G','F'.repeat(16)]){
    assert.throws(()=>encodeComplex128Wire(bits,'0000000000000000'),TypeError);
  }
  for(const length of [0,1,8,15,17,32]){
    const bytes=Buffer.alloc(length);
    assert.equal(isCanonicalComplex128Wire(bytes),false);
    assert.throws(()=>decodeComplex128Wire(bytes),RangeError);
  }
});
