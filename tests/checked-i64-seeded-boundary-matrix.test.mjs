import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCheckedI64,evaluateCheckedI64Json,renderCheckedI64GuestSource,CheckedI64ContractError,I64_MIN,I64_MAX} from '../src/checked-i64-oracle.mjs';

const literal=n=>({op:'literal',value:String(n)});
const binary=(op,a,b)=>({op,args:[literal(a),literal(b)]});

test('deterministic bounded arithmetic oracle agrees with 256 independent bigint cases',()=>{
 let state=0xc0ffee12;
 const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
 for(let i=0;i<256;i++){
  const a=BigInt(next()%2000000001)-1000000000n;
  const b=BigInt(next()%2000000001)-1000000000n;
  for(const [op,want] of [['add',a+b],['sub',a-b],['mul',a*b]]){
   const expr=binary(op,a,b);
   assert.equal(evaluateCheckedI64(expr),want,op+' #'+i);
   assert.equal(evaluateCheckedI64Json(JSON.stringify(expr)),want,op+' JSON #'+i);
  }
 }
});

test('overflow boundaries always fail rather than wrap intermediate values',()=>{
 for(const expr of [binary('add',I64_MAX,1n),binary('sub',I64_MIN,1n),binary('mul',I64_MAX,2n),binary('mul',I64_MIN,-1n)])
  assert.throws(()=>evaluateCheckedI64(expr),err=>err instanceof CheckedI64ContractError&&err.code==='integer_overflow');
 assert.equal(evaluateCheckedI64(literal(I64_MIN)),I64_MIN);
 assert.equal(evaluateCheckedI64(literal(I64_MAX)),I64_MAX);
});

test('literals cannot bypass signed admission with aliases or implicit conversions',()=>{
 for(const text of ['+1','-0','01',' 1','1 ','1.0','1e0','--1',''])
  assert.throws(()=>evaluateCheckedI64(literal(text)),/noncanonical signed decimal literal/);
 for(const text of [String(I64_MAX+1n),String(I64_MIN-1n)])
  assert.throws(()=>evaluateCheckedI64(literal(text)),err=>err instanceof CheckedI64ContractError&&err.code==='integer_overflow');
 const expr=binary('add',-7n,2n);
 assert.equal(renderCheckedI64GuestSource(expr),'pub fnc main(): int { return (-7 + 2); }\n');
});
