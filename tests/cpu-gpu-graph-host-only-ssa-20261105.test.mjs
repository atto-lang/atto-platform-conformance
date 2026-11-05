import test from 'node:test';
import assert from 'node:assert/strict';
import {Ast,lower,executeCpuI64} from '../src/cpu-gpu-execution-graph.mjs';

test('host-only CPU SSA graph evaluates signed i64 expression 20+22',()=>{
 const graph=lower(Ast.CpuRegion(Ast.Add(Ast.I64(20n),Ast.I64(22n))));
 assert.equal(graph.resultType,'i64');assert.equal(graph.deviceKernels,0);
 assert.deepEqual(graph.effects,['Host']);
 assert.equal(graph.nodes.length,3);assert.equal(executeCpuI64(graph),42n);
});
test('forged SSA dependency and sequencing receipts fail closed',()=>{
 const graph=lower(Ast.Add(Ast.I64(20n),Ast.I64(22n)));
 const forged={...graph,nodes:graph.nodes.map(n=>({
  ...n,dependencies:[...n.dependencies],meta:{...n.meta}
 }))};
 forged.nodes[2].dependencies=[];
 assert.throws(()=>executeCpuI64(forged),/INVALID_GRAPH/);
 forged.nodes[2].dependencies=[0,1,2];
 assert.throws(()=>executeCpuI64(forged),/INVALID_GRAPH/);
});
test('GPU block refuses host integer work or a kernel-free region',()=>{
 assert.throws(()=>lower(Ast.GpuRegion(Ast.I64(1n))),/DEVICE_EFFECT/);
 assert.throws(()=>lower(Ast.GpuRegion(Ast.Seq())),/EMPTY_GPU_REGION/);
});
test('ownership rules reject moving the same host buffer twice',()=>{
 const twice=Ast.Seq(
  Ast.Param('host_buffer','HostBuffer<f32>'),
  Ast.Param('host_buffer','HostBuffer<f32>')
 );
 assert.throws(()=>lower(twice,{parameters:{host_buffer:'HostBuffer<f32>'}}),
  /USE_AFTER_MOVE/);
 assert.throws(()=>Ast.I64(1n<<63n),/INVALID_I64/);
});
