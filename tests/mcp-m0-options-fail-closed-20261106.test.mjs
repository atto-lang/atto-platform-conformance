import test from 'node:test';
import assert from 'node:assert/strict';
import {parseM0Frame, M0FrameError} from '../bin/mcp-m0-frame-guard.mjs';

// A stable reason must be returned even when option getters are untrusted.
const frame=new TextEncoder().encode('{"x":1}');
const reject=(options)=>assert.throws(
  ()=>parseM0Frame(frame,options),
  e=>e instanceof M0FrameError && e.reason==='MALFORMED'
);
test('null option object denied with stable MALFORMED reason',()=>reject(null));
test('primitive option value denied without throwing native TypeError',()=>reject(7));
test('array options denied instead of coercing to default object',()=>reject([]));
test('throwing frame-byte getter does not leak caller exception',()=>{
  reject(Object.defineProperty({},'maxBytes',{get(){throw Error('private-blob-value')}}));
});
test('throwing depth getter does not leak caller exception',()=>{
  reject(Object.defineProperty({},'maxDepth',{get(){throw Error('sensitive-key')}}));
});
test('revoked options Proxy denied with stable reason',()=>{
  const {proxy,revoke}=Proxy.revocable({},{});revoke();reject(proxy);
});
test('option getter is observed only once',()=>{
  let reads=0;
  const options={get maxBytes(){reads++;if(reads>1)throw Error('second-read');return 32768;}};
  assert.equal(parseM0Frame(frame,options).x,1);
  assert.equal(reads,1);
});
test('default options preserve valid envelope parsing',()=>assert.equal(parseM0Frame(frame).x,1));
