import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCheckedI64Json} from '../src/checked-i64-oracle.mjs';

// Pure checked-i64 reference oracle; no AttoLang guest or five-backend proof.
test('canonical literal JSON preserves exact signed i64',()=>{
 assert.equal(evaluateCheckedI64Json('{"op":"literal","value":"7"}'),7n);
 assert.equal(evaluateCheckedI64Json('{"op":"literal","value":"-9223372036854775808"}'),-(1n<<63n));
});
test('duplicate keys and noncanonical textual encodings are rejected',()=>{
 for(const source of [
  '{"op":"literal","value":"7","op":"literal"}',
  ' {"op":"literal","value":"7"}',
  '{"op": "literal","value":"7"}',
  '{"value":"7","op":"literal","value":"8"}'
 ])assert.throws(()=>evaluateCheckedI64Json(source),/noncanonical JSON expression/);
});
test('invalid decimal spelling and overflowing integers are refused',()=>{
 assert.throws(()=>evaluateCheckedI64Json('{"op":"literal","value":"07"}'),/noncanonical signed decimal literal/);
 assert.throws(()=>evaluateCheckedI64Json('{"op":"literal","value":"9223372036854775808"}'),/integer_overflow/);
});