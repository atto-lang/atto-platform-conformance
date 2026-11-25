import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCheckedI64,renderCheckedI64GuestSource} from '../src/checked-i64-oracle.mjs';

const lit=value=>({op:'literal',value:String(value)});

test('expression operator and literal getters are rejected without invocation',()=>{
 for(const field of ['op','value']){
  const node=lit(42);
  let called=0;
  Object.defineProperty(node,field,{get(){called++;throw Error('unsafe getter executed');}});
  assert.throws(()=>evaluateCheckedI64(node),/invalid expression operator|non-inert expression record field/);
  assert.throws(()=>renderCheckedI64GuestSource(node),/invalid expression operator|non-inert expression record field/);
  assert.equal(called,0,field);
 }
});

test('non-inert args array indices, holes, and extra schema fields fail closed',()=>{
 const good={op:'add',args:[lit(7),lit(3)]};
 assert.equal(evaluateCheckedI64(good),10n);
 let touched=0;
 const withGetter={op:'add',args:[lit(7),lit(3)]};
 Object.defineProperty(withGetter.args,'0',{get(){touched++;throw Error('index getter executed');}});
 assert.throws(()=>evaluateCheckedI64(withGetter),/non-inert expression argument/);
 assert.equal(touched,0);
 for(const args of [[lit(7)], [lit(7),lit(3),lit(2)], [,lit(3)]]){
  assert.throws(()=>evaluateCheckedI64({op:'add',args}),/invalid expression argument array|non-inert expression argument/);
 }
 assert.throws(()=>evaluateCheckedI64({...good,extra:true}),/invalid expression record fields/);
});

test('inherited operator and forged record prototypes never pass exact-shape admission',()=>{
 const inherited=Object.create({op:'literal',value:'42'});
 assert.throws(()=>evaluateCheckedI64(inherited),/expected plain expression record/);
 const nullProto=Object.assign(Object.create(null),lit(42));
 assert.throws(()=>evaluateCheckedI64(nullProto),/expected plain expression record/);
});