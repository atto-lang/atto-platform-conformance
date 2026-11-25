import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCheckedI64,renderCheckedI64GuestSource,CheckedI64ContractError,I64_MIN} from '../src/checked-i64-oracle.mjs';

const lit=value=>({op:'literal',value:String(value)});
const binary=(op,a,b)=>({op,args:[lit(a),lit(b)]});
const err=code=>e=>e instanceof CheckedI64ContractError&&e.code===code;

test('signed reference quotient truncates toward zero, never floor',()=>{
 for(const [a,b,q,r] of [
  [-7n,3n,-2n,-1n],[7n,-3n,-2n,1n],
  [-7n,-3n,2n,-1n],[7n,3n,2n,1n],
  [I64_MIN,1n,I64_MIN,0n],[I64_MIN,-3n,3074457345618258602n,-2n]
 ]){
  assert.equal(evaluateCheckedI64(binary('div_trunc',a,b)),q);
  assert.equal(evaluateCheckedI64(binary('rem',a,b)),r);
 }
});

test('divide-by-zero, signed MIN/-1 overflow, and MIN remainder have distinct outcomes',()=>{
 for(const op of ['div_trunc','rem'])
  assert.throws(()=>evaluateCheckedI64(binary(op,7n,0n)),err('division_by_zero'));
 assert.throws(()=>evaluateCheckedI64(binary('div_trunc',I64_MIN,-1n)),err('integer_overflow'));
 assert.equal(evaluateCheckedI64(binary('rem',I64_MIN,-1n)),0n);
});

test('the abstract div_trunc operator never masquerades as executable guest division',()=>{
 assert.equal(renderCheckedI64GuestSource(binary('div_trunc',-7n,3n)),null);
});