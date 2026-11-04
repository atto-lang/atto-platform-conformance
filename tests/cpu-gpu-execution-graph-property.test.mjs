import test from 'node:test';
import assert from 'node:assert/strict';
import {Ast, lower, executeCpuI64} from '../src/cpu-gpu-execution-graph.mjs';

function pseudoRandom(seed) {
  let x = seed | 0;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return x >>> 0;
  };
}

const random = pseudoRandom(0x29_10_2026);

test('256 seeded checked-addition source graph oracle controls', () => {
  for (let run=0; run<256; run++) {
    const inputs = Array.from({length: 1+(random()%24)}, () => BigInt((random()%1000) - 500));
    let ast = Ast.I64(inputs[0]);
    for (let j=1; j<inputs.length; j++) ast = Ast.Add(ast, Ast.I64(inputs[j]));
    const graph = lower(Ast.CpuRegion(ast));
    assert.equal(executeCpuI64(graph), inputs.reduce((a,b)=>a+b, 0n));
  }
});

test('256 seeded graph mutation attempts do not bypass metadata validation', () => {
  for (let run=0; run<256; run++) {
    const graph = structuredClone(lower(Ast.CpuRegion(Ast.Add(Ast.I64(40n),Ast.I64(2n)))));
    const choice=random()%8;
    if(choice === 0) graph.nodes[2].meta.left = 9;
    if(choice === 1) graph.nodes[2].meta.right = -1;
    if(choice === 2) graph.nodes[2].dependencies = [0,0,1];
    if(choice === 3) graph.nodes[1].id = 0;
    if(choice === 4) graph.effects.push('Device');
    if(choice === 5) graph.nodes[0].meta.value = '0x28';
    if(choice === 6) graph.nodes[0].opcode = 'KERNEL';
    if(choice === 7) graph.returnId = 0;
    assert.throws(()=>executeCpuI64(graph), e=>['INVALID_GRAPH','DEVICE_OR_ASYNC_UNAVAILABLE'].includes(e.code));
  }
});

test('cyclic and cross-structure AST attempts fail without executing code', () => {
  const cycle={kind:'CpuRegion',nb:false}; cycle.body=cycle;
  assert.throws(()=>lower(cycle), e=>e.code==='DEPTH_LIMIT');
  const inherited=Object.create({value:1n}); inherited.kind='I64';
  assert.throws(()=>lower(Ast.CpuRegion(inherited)), e=>e.code==='INVALID_AST');
});
