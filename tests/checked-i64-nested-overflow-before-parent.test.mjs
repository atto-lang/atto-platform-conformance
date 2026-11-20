import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCheckedI64,renderCheckedI64GuestSource,I64_MAX,I64_MIN,CheckedI64ContractError} from '../src/checked-i64-oracle.mjs';

const literal=value=>({op:'literal',value:String(value)});
const binary=(op,left,right)=>({op,args:[left,right]});
const failOverflow=expr=>assert.throws(()=>evaluateCheckedI64(expr),err=>err instanceof CheckedI64ContractError&&err.code==='integer_overflow');

test('out-of-range intermediate results are not rescued by a later subtraction',()=>{
 const expression=binary('sub',binary('add',literal(I64_MAX),literal(1)),literal(1));
 failOverflow(expression);
 assert.match(renderCheckedI64GuestSource(expression),/return \(\(9223372036854775807 \+ 1\) - 1\);/);
});

test('nested negation of i64 minimum traps before a zero multiplier',()=>{
 const expression=binary('mul',{op:'neg',args:[literal(I64_MIN)]},literal(0));
 failOverflow(expression);
 assert.equal(evaluateCheckedI64(binary('mul',literal(I64_MIN),literal(0))),0n);
});

test('left-side overflow precedes any right-side invalid expression and no side effects execute',()=>{
 let invoked=0;
 const getterRight={op:'literal'};
 Object.defineProperty(getterRight,'value',{enumerable:true,get(){invoked++;throw Error('right accessor');}});
 const expression=binary('add',binary('add',literal(I64_MAX),literal(1)),getterRight);
 failOverflow(expression);
 assert.equal(invoked,0);
});
