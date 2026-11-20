import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {Ast,lower,executeCpuI64} from "../src/cpu-gpu-execution-graph.mjs";

const url=new URL("../schemas/execution-region-graph-v1.json",import.meta.url);
test("versioned graph ABI schema matches actual reference graph node vocabulary",async()=>{
 const c=JSON.parse(await readFile(url,"utf8"));
 assert.equal(c.schemaVersion,1);
 assert.equal(c.contract,"oreslang-cpu-gpu-execution-graph-v1");
 assert.equal(c.status,"experimental-typed-ir-only-no-gpu-provider-certified");
 assert.deepEqual(c.domains,["CPU","GPU","HOST","TRANSFER"]);
 assert.deepEqual(c.effects,["Host","Device","Transfer","Suspend"]);
 assert.ok(c.astNodes.includes("CpuRegion")&&c.astNodes.includes("GpuRegion"));
 assert.ok(c.typeConstructors.includes("Future<T>"));
 assert.equal(c.minimumConformance.backendRealExecution,"not_verified");
 const host = Ast.Param("input","HostBuffer<f32>");
 const graph=lower(Ast.CpuRegion(Ast.GpuRegion(
  Ast.Kernel("scale",Ast.CpuRegion(Ast.Upload(host))))),
  {parameters:{input:"HostBuffer<f32>"}});
 for(const n of graph.nodes){
  assert.ok(c.opcodes.includes(n.opcode),"unknown opcode "+n.opcode);
  assert.ok(c.domains.includes(n.domain),"unknown domain "+n.domain);
  assert.ok(n.dependencies.every(dep=>dep<n.id),"cyclic graph node");
 }
 for(const e of graph.effects)assert.ok(c.effects.includes(e),"unknown effect "+e);
 assert.throws(()=>executeCpuI64(graph));
});
test("published specification pins consuming owned args and Future not Stream",async()=>{
 const c=JSON.parse(await readFile(url,"utf8"));
 assert.match(c.semanticRules.defaultOwnedParameterMode,/consume-by-value/);
 assert.match(c.semanticRules.nonblockingRegion,/Future<T>/);
 assert.match(c.semanticRules.nonblockingRegion,/not Channel or Stream/);
 assert.match(c.semanticRules.residency,/explicit upload\/download/);
 assert.match(c.semanticRules.gpuToCpu,/host continuation/);
 assert.match(c.semanticRules.deviceWork,/no implicit CPU fallback/);
});
