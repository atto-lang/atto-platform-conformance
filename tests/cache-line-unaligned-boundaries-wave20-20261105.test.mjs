import test from 'node:test';
import assert from 'node:assert/strict';
import {mayShareCacheLine as share} from '../src/cache-locality-oracle.mjs';

const range=(start,length,baseRemainder,allocation='same')=>
  ({start,length,baseRemainder,allocation});

test('unaligned bases make one-byte adjacency a nonoverlap boundary',()=>{
  let checked=0;
  for(const line of [16,32,64,128,256])for(const base of [0,1,line-1]){
    const untilNext=line-base;
    assert.equal(share(range(0,untilNext,base),range(untilNext,1,base),line),false);
    assert.equal(share(range(0,untilNext+1,base),range(untilNext,1,base),line),true);
    checked++;
  }
  assert.equal(checked,15);
});

test('half-open empty ranges do not share even across unknown physical identities',()=>{
  assert.equal(share(range(0,0,0),range(0,1,0)),false);
  assert.equal(share(range(0,1,0),range(0,0,0)),false);
  assert.equal(share(range(0,0,null,'unknown-a'),range(0,7,null,'unknown-b')),false);
});

test('unknown alignment and distinct allocation labels cannot certify isolation',()=>{
  assert.equal(share(range(0,1,null),range(4096,1,null)),true);
  assert.equal(share(range(0,1,0,'a'),range(4096,1,0,'b')),true);
  assert.equal(share(range(0,8,0),range(64,8,0)),false);
});

test('conflicting base evidence and overflows fail closed before cache classification',()=>{
  assert.throws(()=>share(range(0,2,1),range(3,2,2)),/INVALID_BYTE_RANGE/);
  assert.throws(()=>share(range(Number.MAX_SAFE_INTEGER,2,0),range(0,1,0)),/INVALID_BYTE_RANGE/);
  for(const size of [0,17,48,4097]){
    assert.throws(()=>share(range(0,1,0),range(0,1,0),size),/INVALID_CACHE_LINE/);
  }
});
