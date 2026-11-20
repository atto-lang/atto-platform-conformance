import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCheckedI64,renderCheckedI64GuestSource,I64_MIN} from '../src/checked-i64-oracle.mjs';

const lit=n=>({op:'literal',value:String(n)});
const expr=(op,a,b)=>({op,args:[lit(a),lit(b)]});

test('signed truncating quotient and remainder retain dividend-sign semantics',()=>{
 for(const [a,b,quotient,remainder] of [
  [-7n,3n,-2n,-1n],[7n,-3n,-2n,1n],
  [-7n,-3n,2n,-1n],[I64_MIN,3n,-3074457345618258602n,-2n]
 ]){
  assert.equal(evaluateCheckedI64(expr('div_trunc',a,b)),quotient);
  assert.equal(evaluateCheckedI64(expr('rem',a,b)),remainder);
  // Abstract integer quotient is NOT AttoLang source '/' (floating division).
  assert.equal(renderCheckedI64GuestSource(expr('div_trunc',a,b)),null);
 }
});

test('division overflow and division by zero remain distinct rejected outcomes',()=>{
 for(const [a,b,code] of [[I64_MIN,-1n,'integer_overflow'],[5n,0n,'division_by_zero']])
  assert.throws(()=>evaluateCheckedI64(expr('div_trunc',a,b)),err=>err?.code===code);
});
