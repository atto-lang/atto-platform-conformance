import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateCheckedI64,evaluateCheckedI64Json,renderCheckedI64GuestSource} from '../src/checked-i64-oracle.mjs';

const lit=n=>({op:'literal',value:String(n)});
const add=args=>({op:'add',args});

test('plain inert operand arrays evaluate and render deterministically',()=>{
 const expr=add([lit(2),lit(3)]);
 assert.equal(evaluateCheckedI64(expr),5n);
 assert.equal(evaluateCheckedI64Json(JSON.stringify(expr)),5n);
 assert.equal(renderCheckedI64GuestSource(expr),'pub fnc main(): int { return (2 + 3); }\n');
});

test('sparse operands and injected array keys cannot alter checked-i64 arity',()=>{
 const sparse=[lit(2),lit(3)];delete sparse[1];
 assert.throws(()=>evaluateCheckedI64(add(sparse)),/invalid expression argument array/);
 const extra=[lit(2),lit(3)];extra.metadata='ignored';
 assert.throws(()=>evaluateCheckedI64(add(extra)),/invalid expression argument array/);
 const tooMany=[lit(2),lit(3),lit(4)];
 assert.throws(()=>evaluateCheckedI64(add(tooMany)),/invalid expression argument array/);
});

test('hostile array element and literal descriptors are refused without getter calls',()=>{
 let calls=0;
 const access=[lit(2),lit(3)];
 Object.defineProperty(access,'0',{get(){calls++;throw Error('executed');},enumerable:true});
 assert.throws(()=>evaluateCheckedI64(add(access)),/non-inert expression argument/);
 const hostile=lit(2);
 Object.defineProperty(hostile,'value',{get(){calls++;throw Error('executed');},enumerable:true});
 assert.throws(()=>renderCheckedI64GuestSource(add([hostile,lit(3)])),/non-inert expression record field/);
 assert.equal(calls,0);
});

test('symbol and hidden array properties fail before arithmetic',()=>{
 const extra=[lit(2),lit(3)];Object.defineProperty(extra,'hidden',{value:42});
 assert.throws(()=>evaluateCheckedI64(add(extra)),/invalid expression argument array/);
 const symbol=[lit(2),lit(3)];symbol[Symbol('hidden')]=42;
 assert.throws(()=>evaluateCheckedI64(add(symbol)),/invalid expression argument array/);
});
