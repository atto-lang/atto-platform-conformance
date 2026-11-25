import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCheckedI64Json,I64_MIN,I64_MAX} from '../src/checked-i64-oracle.mjs';

const literal=value=>JSON.stringify({op:'literal',value:String(value)});

test('canonical JSON admits exact signed 64-bit endpoints and zero',()=>{
 for(const value of [I64_MIN,0n,I64_MAX])
  assert.equal(evaluateCheckedI64Json(literal(value)),value);
});

test('noncanonical JSON aliases, invalid decimals and overflow cannot become oracle evidence',()=>{
 for(const text of [
  ' '+literal(1n),literal(1n)+' ',
  '{"op":"literal","value":"01"}',
  '{"op":"literal","value":"1","value":"1"}'
 ])assert.throws(()=>evaluateCheckedI64Json(text));
 assert.throws(()=>evaluateCheckedI64Json(literal(I64_MAX+1n)),
               err=>err?.code==='integer_overflow');
});
