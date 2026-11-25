import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectTypedPlaceIdentity,inspectTypedPlacePair}
  from '../src/ownership-typed-origin-ids-v1.mjs';

const owned=()=>({bindingId:1,originId:0,root:'owner',mode:'owned',fields:[]});
const valid=(value)=>{
  const r=inspectTypedPlaceIdentity(value);
  assert.equal(r.ok,false);
  assert.equal(r.verified,false);
  assert.equal(r.independentStorageVerified,false);
  assert.equal(r.candidateValid,true,JSON.stringify(r.errors));
  return r;
};
const reject=(input,reason)=>{
  const r=inspectTypedPlaceIdentity(input);
  assert.equal(r.ok,false);
  assert.equal(r.verified,false);
  assert.equal(r.candidateValid,false);
  assert.ok(r.errors.includes(reason),JSON.stringify(r.errors));
};
const mutate=(key,value)=>({...owned(),[key]:value});

test('id01 owned binding is candidate shape only',()=>{
  const r=valid(owned());
  assert.equal(r.status,'CANDIDATE_TYPED_PLACE_UNATTESTED');
  assert.equal(r.originId,0);
});
test('id02 shared loan has no owner authority',()=>{valid(mutate('mode','shared-loan'));});
test('id03 exclusive loan is tracked without owning root',()=>{valid(mutate('mode','exclusive-loan'));});
test('id04 positive origin ID is STILL unauthenticated',()=>{
  const r=valid(mutate('originId',17));
  assert.equal(r.independentStorageVerified,false);
});
test('id05 eight fields remain bounded and candidate',()=>{
  assert.equal(valid(mutate('fields',Array(8).fill('field'))).fields.length,8);
});
test('id06 unminted zero binding rejected',()=>reject(mutate('bindingId',0),'UNMINTED_BINDING_ID'));
test('id07 negative binding rejected',()=>reject(mutate('bindingId',-1),'UNMINTED_BINDING_ID'));
test('id08 fractional binding rejected',()=>reject(mutate('bindingId',1.3),'UNMINTED_BINDING_ID'));
test('id09 string binding rejected',()=>reject(mutate('bindingId','1'),'UNMINTED_BINDING_ID'));
test('id10 unsafe large binding rejected',()=>reject(mutate('bindingId',2**53),'UNMINTED_BINDING_ID'));
test('id11 negative allocation origin rejected',()=>reject(mutate('originId',-2),'INVALID_ORIGIN_ID'));
test('id12 fractional allocation origin rejected',()=>reject(mutate('originId',1.5),'INVALID_ORIGIN_ID'));
test('id13 string allocation origin rejected',()=>reject(mutate('originId','1'),'INVALID_ORIGIN_ID'));
test('id14 NaN allocation origin rejected',()=>reject(mutate('originId',NaN),'INVALID_ORIGIN_ID'));
test('id15 null allocation origin rejected',()=>reject(mutate('originId',null),'INVALID_ORIGIN_ID'));
test('id16 unsafe field projection rejected',()=>reject(mutate('fields',['__proto__']),'INVALID_FIELD_PATH'));
test('id17 ninth projection fails closed',()=>reject(mutate('fields',Array(9).fill('field')),'INVALID_FIELD_PATH'));
test('id18 forged verified flag fails schema admission',()=>reject({...owned(),verified:true},'INVALID_PLACE_ID_SCHEMA'));
test('id19 two distinct BindingIds do not prove independence',()=>{
  const r=inspectTypedPlacePair(owned(),mutate('bindingId',2));
  assert.equal(r.candidateMayAlias,true);
  assert.equal(r.independentStorageVerified,false);
  assert.equal(r.ok,false);
});
test('id20 distinct positive OriginIds do not prove independence',()=>{
  const r=inspectTypedPlacePair(mutate('originId',1),{...owned(),bindingId:2,originId:2});
  assert.equal(r.candidateMayAlias,true);
  assert.equal(r.independentStorageVerified,false);
});
test('id21 borrowed vs owner roots may still alias',()=>{
  const r=inspectTypedPlacePair(owned(),{...owned(),bindingId:2,mode:'shared-loan'});
  assert.equal(r.candidateMayAlias,true);
  assert.equal(r.verified,false);
});
test('id22 one malformed claim poisons the pair',()=>{
  const r=inspectTypedPlacePair(owned(),mutate('bindingId',0));
  assert.equal(r.candidateValid,false);
  assert.ok(r.errors.includes('PAIR_HAS_INVALID_ORIGIN'));
});
