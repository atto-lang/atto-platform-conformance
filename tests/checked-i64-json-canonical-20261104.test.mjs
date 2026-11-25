import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCheckedI64Json,I64_MIN,I64_MAX} from '../src/checked-i64-oracle.mjs';

const literal=value=>JSON.stringify({op:'literal',value});
test('canonical signed i64 min and max are admitted without precision loss',()=>{
 assert.equal(evaluateCheckedI64Json(literal('-9223372036854775808')),I64_MIN);
 assert.equal(evaluateCheckedI64Json(literal('9223372036854775807')),I64_MAX);
});
test('immediately out-of-bounds literals signal integer overflow',()=>{
 assert.throws(()=>evaluateCheckedI64Json(literal('-9223372036854775809')),/integer_overflow/);
 assert.throws(()=>evaluateCheckedI64Json(literal('9223372036854775808')),/integer_overflow/);
});
test('duplicate fields and noncanonical whitespace or escaping are rejected',()=>{
 assert.throws(()=>evaluateCheckedI64Json('{"op":"literal","value":"1","value":"2"}'),/noncanonical JSON expression/);
 assert.throws(()=>evaluateCheckedI64Json(' '+literal('1')),/noncanonical JSON expression/);
 assert.throws(()=>evaluateCheckedI64Json('{"op":"literal","value":"\\u0031"}'),/noncanonical JSON expression/);
});
