import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateCheckedI64,evaluateCheckedI64Json,renderCheckedI64GuestSource,
  CheckedI64ContractError,I64_MIN,I64_MAX
} from '../src/checked-i64-oracle.mjs';

const literal=x=>({op:'literal',value:String(x)});
const binary=(op,a,b)=>({op,args:[literal(a),literal(b)]});
const failsWith=(expr,code)=>assert.throws(()=>evaluateCheckedI64(expr),
  err=>err instanceof CheckedI64ContractError && err.code===code);

test('signed quotient truncates toward zero and remainder retains dividend sign',()=>{
  for(const [a,b,q,r] of [
    [-5n,2n,-2n,-1n],[5n,-2n,-2n,1n],
    [-5n,-2n,2n,-1n],[5n,2n,2n,1n],
    [I64_MIN,1n,I64_MIN,0n],[I64_MAX,-1n,-I64_MAX,0n]
  ]){
    assert.equal(evaluateCheckedI64(binary('div_trunc',a,b)),q);
    assert.equal(evaluateCheckedI64(binary('rem',a,b)),r);
    assert.equal(evaluateCheckedI64Json(JSON.stringify(binary('div_trunc',a,b))),q);
  }
});

test('minimum divided by -1 overflows while remainder and zero-divisor errors stay distinct',()=>{
  failsWith(binary('div_trunc',I64_MIN,-1n),'integer_overflow');
  assert.equal(evaluateCheckedI64(binary('rem',I64_MIN,-1n)),0n);
  failsWith(binary('div_trunc',7n,0n),'division_by_zero');
  failsWith(binary('rem',7n,0n),'division_by_zero');
});

test('abstract integer quotient never renders as guest integer slash semantics',()=>{
  const quotient=binary('div_trunc',7n,2n);
  for(const profile of ['portable-default','checked-i64-v1'])
    assert.equal(renderCheckedI64GuestSource(quotient,profile),null);
  const wrapped={op:'add',args:[literal(1),quotient]};
  assert.equal(renderCheckedI64GuestSource(wrapped),null);
  assert.equal(renderCheckedI64GuestSource(wrapped,'checked-i64-v1'),null);
});
