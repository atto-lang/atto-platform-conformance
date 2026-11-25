import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOP_I64_SHARED_V1, verifySharedI64Summary
} from '../verification/dop-i64-shared-source-envelope-v1.mjs';

// Standalone source-free reference; compiler-backed execution must be
// independently qualified by the exact shared Java/LLVM .atto source files.
const columns=[
  {name:'value',type:'int',mutable:true},
  {name:'token',type:'int',mutable:false}
];
const push=(first=42n,second=7n)=>({kind:'push',first,second});
const read=(index=0,field='value')=>({kind:'return_read',index,field});
const erase=(index=0)=>({kind:'erase_swap',index});
const write=(index=0,field='value',value=42n)=>({kind:'write',index,field,value});
const summary=(capacity,operations=[push(),read()])=>({
  capacity,columns,operations
});

test('shared source capacity boundary is exactly [1,256]',()=>{
  assert.deepEqual(
    [DOP_I64_SHARED_V1.minCapacity,DOP_I64_SHARED_V1.maxCapacity,
      DOP_I64_SHARED_V1.maxOperations],[1,256,1024]);
  for(const capacity of [1,2,3,255,256]) {
    assert.equal(verifySharedI64Summary(summary(capacity)).capacity,capacity);
  }
  for(const capacity of [0,-1,257,4096,NaN,1.25,Infinity,"3",3n]) {
    assert.throws(()=>verifySharedI64Summary(summary(capacity)),
      /DOP_INVERTED_V1_REJECTED/);
  }
});

test('exactly 1024 operations accepted, 1025 rejected pre-execution',()=>{
  const ops=[];
  for(let i=0;i<511;i++) ops.push(push(1n,2n),erase());
  ops.push(push(),read());
  assert.equal(ops.length,1024);
  const accepted=verifySharedI64Summary(summary(1,ops));
  assert.equal(accepted.operationCount,1024);
  assert.equal(accepted.remainingRows,1);
  assert.ok(Object.isFrozen(accepted));
  const overflow=[...ops.slice(0,-1),write(),read()];
  assert.equal(overflow.length,1025);
  assert.throws(()=>verifySharedI64Summary(summary(1,overflow)),
    /invalid operation count/);
  assert.throws(()=>verifySharedI64Summary(summary(1,[])),
    /invalid operation count/);
});

test('negative mutation cases fail-closed before any executable plan',()=>{
  const bad=[
    [push(1n<<63n,0n),read()],
    [push(-(1n<<63n)-1n,0n),read()],
    [push(0n,(1n<<63n)),read()],
    [push(42,7n),read()],
    [push(),write(0,'token',99n),read()],
    [push(),write(0,'unknown',99n),read()],
    [push(),erase(1),read()],
    [push(),{kind:'channel',field:'value'},read()],
    [push(),read(),write()],
    [push()],
  ];
  for(const operations of bad) {
    assert.throws(()=>verifySharedI64Summary(summary(3,operations)),
      /DOP_INVERTED_V1_REJECTED/);
  }
});

test('dynamic index checks are required for accepted runtime reads and writes',()=>{
  const candidate=summary(2,[push(),write(999,'value',0n),read(999,'value')]);
  const certificate=verifySharedI64Summary(candidate);
  assert.equal(certificate.runtimeIndexChecksRequired,true);
  assert.equal(certificate.remainingRows,1);
  assert.equal(certificate.operationCount,3);
  assert.throws(()=>verifySharedI64Summary(
    summary(2,[push(),write(-1,'value',0n),read()])),
    /invalid write operand/);
  assert.throws(()=>verifySharedI64Summary(
    summary(2,[push(),read(-1,'value')])),
    /invalid return read/);
});

test('disjoint nominal columns must be canonical int and mutable-labeled',()=>{
  const mutations=[
    [{name:'value',type:'f64',mutable:true},columns[1]],
    [columns[0],{name:'value',type:'int',mutable:false}],
    [columns[0],{name:'token',type:'int',mutable:0}],
    [columns[0],{name:'token',type:'int',get mutable(){throw Error('accessor ran')}}],
  ];
  for(const fields of mutations) {
    assert.throws(()=>verifySharedI64Summary({
      capacity:3,columns:fields,operations:[push(),read()]
    }),/DOP_INVERTED_V1_REJECTED/);
  }
});

test('sparse operations, accessor-backed descriptors and illegal arity reject',()=>{
  const sparse=new Array(2);
  sparse[0]=push();
  assert.throws(()=>verifySharedI64Summary(summary(1,sparse)),/own data required/);
  const hazardous={kind:'push',get first(){throw Error('wrong getter executed')},second:7n};
  assert.throws(()=>verifySharedI64Summary(summary(1,[hazardous,read()])),
    /own data required/);
  assert.throws(()=>verifySharedI64Summary(summary(1,[{kind:'return_read',index:0}])),
    /own data required/);
});

test('bounded capacity can be reclaimed after swap-delete without row aliasing',()=>{
  assert.equal(verifySharedI64Summary(summary(1,[
    push(1n,2n),erase(0),push(42n,7n),read()
  ])).remainingRows,1);
  assert.throws(()=>verifySharedI64Summary(summary(1,[
    push(1n,2n),push(42n,7n),read()
  ])),/capacity overflow/);
});
