import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNestedType,formatNestedType,equalNestedType,checkNestedAssignment,explicitFlattenOne} from '../src/random-five-nested-types-v1.mjs';
test('canonical nested Option and Future parse',()=>{
 assert.equal(formatNestedType(parseNestedType(' Future < Option < int > > ')),'Future<Option<int>>');
 assert.equal(formatNestedType(parseNestedType('Result<Option<int>,Future<bool>>')),'Result<Option<int>,Future<bool>>');
});
for(const [expected,actual] of [
 ['Option<int>','Option<Option<int>>'],['Future<int>','Future<Future<int>>'],
 ['Option<int>','Future<int>'],['Future<Option<int>>','Option<Future<int>>'],
 ['Result<int,bool>','Result<Option<int>,bool>'],['int','Option<int>'],
 ['Future<Option<int>>','Future<Future<Option<int>>>']
])test('no implicit conversion '+actual+' to '+expected,()=>{
 const r=checkNestedAssignment(expected,actual);
 assert.equal(r.ok,false);assert.equal(r.diagnostic,'E_NO_IMPLICIT_NESTED_CONVERSION');
});
test('exact nested type is legal without flattening',()=>{
 for(const t of ['int','Option<int>','Future<Future<Option<int>>>','Result<Option<int>,Future<bool>>'])
  assert.equal(checkNestedAssignment(t,t).ok,true);
});
test('explicitly flatten one layer only',()=>{
 assert.equal(explicitFlattenOne('Future<Future<Option<int>>>','Future'),'Future<Option<int>>');
 assert.equal(explicitFlattenOne('Option<Option<Future<int>>>','Option'),'Option<Future<int>>');
 assert.throws(()=>explicitFlattenOne('Future<Option<int>>','Future'),/MISMATCH/);
});
test('generic arity and malformed syntax reject',()=>{
 for(const t of ['Option','Option<>','Result<int>','Future<int,bool>','Option<int','Option<int>>','Foo<int>','Option<int>,int','','<int>'])
  assert.throws(()=>parseNestedType(t),/TYPE|GENERIC|INVALID|TRAILING/);
});
test('depth and input bounds reject adversarial types',()=>{
 const deep='Option<'.repeat(35)+'int' + '>'.repeat(35);
 assert.throws(()=>parseNestedType(deep),/LIMIT/);
 assert.throws(()=>parseNestedType('x'.repeat(513)),/INVALID_TYPE_INPUT/);
});
test('oracle never claims compiled guest parity',()=>{
 const r=checkNestedAssignment('Option<int>','Option<int>');
 assert.equal(r.evidence,'TYPE_ORACLE_ONLY');assert.equal('guestExecuted' in r,false);
});
