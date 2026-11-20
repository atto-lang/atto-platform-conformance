import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCheckedI64Json,CheckedI64ContractError} from '../src/checked-i64-oracle.mjs';

const lit=value=>({op:'literal',value:String(value)});

test('the exact canonical JSON expression evaluates and preserves checked signed results',()=>{
 const expr={op:'sub',args:[lit(-7),lit(5)]};
 const raw=JSON.stringify(expr);
 assert.equal(evaluateCheckedI64Json(raw),-12n);
 assert.equal(evaluateCheckedI64Json(JSON.stringify(lit(0))),0n);
});

test('duplicate fields, trailing spaces and escaped aliases are noncanonical',()=>{
 const wrong=[
  '{"op":"literal","value":"1","value":"2"}',
  '{"op":"literal","value":"1"} ',
  '{"op":"literal","value":"\\u0037"}',
  '{"op":"literal","value":"7", "extra":1}'
 ];
 for(const value of wrong)
  assert.throws(()=>evaluateCheckedI64Json(value),/noncanonical JSON expression|invalid expression record fields/);
});

test('JSON foreign entry rejects malformed values before arithmetic',()=>{
 for(const value of [null,undefined,1,false,{},'','{','['])
  assert.throws(()=>evaluateCheckedI64Json(value),/missing or oversized canonical JSON expression|invalid JSON expression/);
});

test('canonical JSON still rejects negative zero and beyond-i64 signed literal',()=>{
 assert.throws(()=>evaluateCheckedI64Json(JSON.stringify(lit('-0'))),/noncanonical signed decimal literal/);
 assert.throws(()=>evaluateCheckedI64Json(JSON.stringify(lit('9223372036854775808'))),
  err=>err instanceof CheckedI64ContractError&&err.code==='integer_overflow');
});
