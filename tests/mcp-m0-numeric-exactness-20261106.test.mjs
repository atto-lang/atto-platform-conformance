import test from 'node:test';
import assert from 'node:assert/strict';
import {parseM0Frame,M0FrameError} from '../bin/mcp-m0-frame-guard.mjs';
const encode = new TextEncoder();
const reject = s => assert.throws(() => parseM0Frame(encode.encode(s)), e => e instanceof M0FrameError && e.reason==='MALFORMED');
test('unsafe 53-bit-plus positive integers denied before lossy parse', () => {
  for(const n of ['9007199254740992','9007199254740993','999999999999999999999'])reject('{"id":'+n+'}');
});
test('unsafe 53-bit-plus negative integer denied',()=>{
  for(const n of ['-9007199254740992','-9007199254740993'])reject('{"id":'+n+'}');
});
test('max safe 53-bit positive and negative integers still accepted',()=>{
  assert.equal(parseM0Frame(encode.encode('{"id":9007199254740991}')).id,9007199254740991);
  assert.equal(parseM0Frame(encode.encode('{"id":-9007199254740991}')).id,-9007199254740991);
});
test('integral large exponent denied to preserve cross-language ID',()=>reject('{"id":1e16}'));
test('nonzero positive and negative underflow denied',()=>{
  reject('{"x":1e-9999}');reject('{"x":-1e-9999}');reject('{"x":0.01e-9999}');
});
test('deep nested unsafe integer denied before JSON parse',()=>reject('{"params":{"items":[1,9007199254740993]}}'));
test('zero mantissa with huge negative exponent accepted',()=>{
  assert.equal(parseM0Frame(encode.encode('{"x":0e-9999}')).x,0);
  assert.equal(parseM0Frame(encode.encode('{"x":-0.00e-9999}')).x,-0);
});
test('ordinary fractions and representable tiny exponent accepted',()=>{
  assert.equal(parseM0Frame(encode.encode('{"x":0.1}')).x,0.1);
  assert.equal(parseM0Frame(encode.encode('{"x":1e-100}')).x,1e-100);
});
