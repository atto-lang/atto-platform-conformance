import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCheckedI64} from '../src/checked-i64-oracle.mjs';

const literal=n=>({op:'literal',value:String(n)});
const add=args=>({op:'add',args});

test('accessor-valued operands reject without executing untrusted getter code',()=>{
  const args=[literal(20),literal(22)];
  let invoked=0;
  Object.defineProperty(args,'0',{get(){invoked++;throw Error('guest getter ran');},
                                  configurable:true,enumerable:true});
  assert.throws(()=>evaluateCheckedI64(add(args)),/non-inert expression argument/);
  assert.equal(invoked,0);
  const hidden=[literal(20),literal(22)];
  Object.defineProperty(hidden,'1',{value:literal(22),enumerable:false});
  assert.throws(()=>evaluateCheckedI64(add(hidden)),/non-inert expression argument/);
});

test('symbol metadata, sparse operands and subclassed arrays are not canonical expressions',()=>{
  const symbolArgs=[literal(20),literal(22)];
  symbolArgs[Symbol('hidden')]='out-of-band';
  assert.throws(()=>evaluateCheckedI64(add(symbolArgs)),/invalid expression argument array/);
  const sparse=[literal(20),,];
  assert.throws(()=>evaluateCheckedI64(add(sparse)),/invalid expression argument array/);
  class CustomArgs extends Array {}
  assert.throws(()=>evaluateCheckedI64(add(new CustomArgs(literal(20),literal(22)))),
                /invalid expression argument array/);
});

test('array element Proxy get traps cannot rewrite the observed checked operands',()=>{
  let trapCalls=0;
  const args=new Proxy([literal(20),literal(22)],{
    get(target,key,receiver){
      if(key==='0'||key==='1'||key==='length'){trapCalls++;throw Error('untrusted get trap');}
      return Reflect.get(target,key,receiver);
    }
  });
  assert.equal(evaluateCheckedI64(add(args)),42n);
  assert.equal(trapCalls,0);
});
