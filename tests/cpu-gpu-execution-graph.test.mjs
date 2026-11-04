import test from "node:test";
import assert from "node:assert/strict";
import {Ast,lower,executeCpuI64} from "../src/cpu-gpu-execution-graph.mjs";

const {CpuRegion:cpu,GpuRegion:gpu,I64:i,Add:add,Param:p,Upload:upload,
       Download:download,Kernel:kernel,Await:awaitNode,Seq:seq}=Ast;
const reject=(code,run)=>assert.throws(run,e=>e?.code===code);

test("typed CPU region executes real checked i64 arithmetic in reference oracle",()=>{
 const g=lower(cpu(add(i(40n),i(2n))));
 assert.equal(g.resultType,"i64");
 assert.equal(executeCpuI64(g),42n);
 assert.deepEqual(g.effects,["Host"]);
 assert.equal(g.deviceKernels,0);
});
test("explicit SSA operands survive preceding unrelated host computations",()=>{
 const g=lower(cpu(seq(i(400n),add(i(40n),i(2n)))));
 assert.equal(executeCpuI64(g),42n);
 assert.deepEqual(g.nodes.at(-1).meta,{left:1,right:2});
});
test("CPU checked overflow never silently wraps",()=>{
 const g=lower(cpu(add(i(9223372036854775807n),i(1n))));
 reject("INVALID_I64",()=>executeCpuI64(g));
});
test("nb cpu returns Future<i64> and is not an implicit Stream or Channel",()=>{
 const g=lower(cpu(i(42n),true));
 assert.equal(g.resultType,"Future<i64>");
 reject("NESTED_FUTURE",()=>lower(cpu(cpu(i(42n),true),true)));
 assert.equal(g.nodes.at(-1).opcode,"SUBMIT");
 assert.ok(g.effects.includes("Suspend"));
 reject("INVALID_GRAPH",()=>executeCpuI64(g));
});
test("await unwraps Future<T> as a host continuation, but is not executed by CPU oracle",()=>{
 const g=lower(cpu(awaitNode(cpu(i(42n),true))));
 assert.equal(g.resultType,"i64");
 assert.equal(g.nodes.at(-1).opcode,"AWAIT");
 reject("DEVICE_OR_ASYNC_UNAVAILABLE",()=>executeCpuI64(g));
});
test("gpu kernel constructs typed launch graph and cannot fall back to CPU",()=>{
 const host=p("input","HostBuffer<f32>");
 const g=lower(cpu(gpu(kernel("scale",cpu(upload(host))))),
  {parameters:{input:"HostBuffer<f32>"}});
 assert.equal(g.resultType,"GpuBuffer<f32>");
 assert.equal(g.deviceKernels,1);
 assert.ok(g.nodes.some(n=>n.opcode==="UPLOAD"));
 assert.ok(g.nodes.some(n=>n.opcode==="DEVICE_KERNEL"));
 reject("INVALID_GRAPH",()=>executeCpuI64(g));
});
test("gpu cpu gpu syntactic nesting splits into host fence and another GPU admission",()=>{
 const first=p("first","GpuBuffer<f32>");
 const host=p("forDownload","GpuBuffer<f32>");
 const second=p("second","GpuBuffer<f32>");
 const g=lower(gpu(seq(kernel("kernelA",first),
     cpu(seq(download(host),gpu(kernel("kernelB",second)))))),
    {parameters:{first:"GpuBuffer<f32>",forDownload:"GpuBuffer<f32>",second:"GpuBuffer<f32>"}});
 assert.equal(g.deviceKernels,2);
 assert.equal(g.resultType,"GpuBuffer<f32>");
 assert.equal(g.nodes.filter(n=>n.opcode==="DEVICE_FENCE").length,1);
 assert.equal(g.nodes.filter(n=>n.opcode==="DEVICE_ADMISSION").length,2);
 assert.ok(g.nodes.every(n=>n.dependencies.every(dep=>dep<n.id)));
});
test("move-only buffer owner cannot be consumed twice, even with implicit take",()=>{
 const input=p("device","GpuBuffer<f32>");
 reject("USE_AFTER_MOVE",()=>lower(gpu(seq(kernel("first",input),kernel("second",input))),
   {parameters:{device:"GpuBuffer<f32>"}}));
});
test("no implicit device migration, host invocation in GPU or missing kernel work",()=>{
 const host=p("host","HostBuffer<f32>");
 reject("RESIDENCY_MISMATCH",()=>lower(gpu(kernel("bad",host)),
  {parameters:{host:"HostBuffer<f32>"}}));
 reject("RESIDENCY_MISMATCH",()=>lower(cpu(download(host)),
  {parameters:{host:"HostBuffer<f32>"}}));
 reject("DEVICE_EFFECT",()=>lower(gpu(upload(host)),
  {parameters:{host:"HostBuffer<f32>"}}));
 reject("DEVICE_EFFECT",()=>lower(gpu(add(i(1n),i(2n)))));
 reject("EMPTY_GPU_REGION",()=>lower(gpu(seq())));
 reject("NOT_FUTURE",()=>lower(cpu(awaitNode(i(2n)))));
});
test("conservative graph limits and typed AST snapshot reject unknown members",()=>{
 reject("INVALID_AST",()=>lower({kind:"CpuRegion",body:{kind:"I64",value:4n,evil:true},nb:false}));
 let node=i(7n);for(let n=0;n<90;n++)node=cpu(node);
 reject("DEPTH_LIMIT",()=>lower(node));
 reject("INVALID_I64",()=>i(9223372036854775808n));
});
