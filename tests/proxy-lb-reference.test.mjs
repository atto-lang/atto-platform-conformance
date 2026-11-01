import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {choose,verifyVectors} from '../src/proxy-lb-reference.mjs';

const vectors=JSON.parse(await readFile(new URL(
  '../contracts/v1/proxy-lb/selection-vectors.json',import.meta.url),'utf8'));

test('all canonical synthetic selection vectors match, without guest claims',()=>{
  const result=verifyVectors(vectors);
  assert.equal(result.vectors,24);
  assert.equal(result.status,'SOURCE_ONLY_REFERENCE_PASS');
  assert.equal(result.guest_execution,'NOT_EXECUTED');
  assert.equal(result.parity_certified,false);
});

test('corrupt vector expectations and duplicate cases fail closed',()=>{
  const corrupt=structuredClone(vectors);
  corrupt.scenarios[0].expected_index=1;
  assert.throws(()=>verifyVectors(corrupt),/mismatch/);
  const duplicate=structuredClone(vectors);
  duplicate.scenarios[1].id=duplicate.scenarios[0].id;
  assert.throws(()=>verifyVectors(duplicate),/duplicated/);
  const malformed=structuredClone(vectors);
  delete malformed.scenarios[0].expected_index;
  assert.throws(()=>verifyVectors(malformed),/expectation/);
});

test('deterministic seed sweep retains only eligible backends',()=>{
  let seed=0x41a571;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let j=0;j<4096;j++){
    const n=1+(random()%16);
    const weights=Array.from({length:n},()=>1+(random()%16));
    const healthy=Array.from({length:n},()=>random()%3!==0);
    const capacity=1+(random()%1024);
    const active=Array.from({length:n},()=>random()%(capacity+1));
    const algorithm=['weighted_round_robin','least_conn'][random()%2];
    const ordinal=random()%256;
    const index=choose({algorithm,weights,healthy,active,capacity,epoch:7,ordinal});
    if(index!==null){
      assert.ok(index>=0&&index<n);
      assert.ok(healthy[index]);
      assert.ok(active[index]<capacity);
    }
  }
});

test('no malformed input yields a backend index',()=>{
  const base={algorithm:'least_conn',weights:[1,3],
     healthy:[true,true],active:[0,0],capacity:16,epoch:7,ordinal:0};
  const bad=[
    {...base,epoch:0},{...base,ordinal:-1},{...base,ordinal:2},
    {...base,weights:[1,0]},{...base,weights:[1,17]},
    {...base,active:[-1,0]},{...base,active:[17,0]},
    {...base,healthy:[true]},{...base,active:[0]},
    {...base,algorithm:'random'}, {...base,capacity:0},
    {...base,weights:[]}, {...base,healthy:[1,true]},
    {...base,weights:[1.5,1]},
    {...base,algorithm:'round_robin',weights:[1,3]}
  ];
  for(const input of bad) assert.equal(choose(input),null);
});
