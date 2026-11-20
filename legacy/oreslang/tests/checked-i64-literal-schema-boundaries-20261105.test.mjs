import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCheckedI64,I64_MIN,I64_MAX} from '../src/checked-i64-oracle.mjs';

const lit=value=>({op:'literal',value});
// Pure host BigInt oracle: not a compiled .atto guest or AOT proof.
test('canonical signed i64 endpoints survive exact string admission',()=>{
 assert.equal(evaluateCheckedI64(lit(String(I64_MIN))),I64_MIN);
 assert.equal(evaluateCheckedI64(lit(String(I64_MAX))),I64_MAX);
 assert.equal(evaluateCheckedI64(lit('0')),0n);
 assert.equal(evaluateCheckedI64(lit('-1')),-1n);
});
test('noncanonical literals do not reach BigInt arithmetic',()=>{
 for(const value of ['','00','-0','+1',' 1','1 ','1.0','1e0','1_000']){
  assert.throws(()=>evaluateCheckedI64(lit(value)),/noncanonical signed decimal literal/,String(value));
 }
});
test('out-of-range canonical integers have a typed overflow',()=>{
 for(const value of ['9223372036854775808','-9223372036854775809']){
  assert.throws(()=>evaluateCheckedI64(lit(value)),error=>error?.code==='integer_overflow',value);
 }
});
test('non-inert field accessors and inherited authority are denied without invocation',()=>{
 let calls=0;
 const poisoned={op:'literal'};
 Object.defineProperty(poisoned,'value',{enumerable:true,get(){calls++;return '42';}});
 assert.throws(()=>evaluateCheckedI64(poisoned),/non-inert expression record field/);
 assert.equal(calls,0);
 const inherited=Object.create({op:'literal',value:'42'});
 assert.throws(()=>evaluateCheckedI64(inherited),/expected plain expression record/);
});
