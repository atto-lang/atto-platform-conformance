import test from "node:test";
import assert from "node:assert/strict";
import {Ast, lower, executeCpuI64} from "../src/cpu-gpu-execution-graph.mjs";

const {CpuRegion:cpu, I64:i64, Add:add, Seq:seq, Await:awaitNode} = Ast;
const original = () => lower(cpu(add(i64(40n), i64(2n))));
const copy = () => structuredClone(original());
const rejects = (code, run) => assert.throws(run, error => error?.code === code);

test("CPU reference runs canonical checked scalar graph", () => {
  assert.equal(executeCpuI64(original()), 42n);
  assert.equal(executeCpuI64(lower(cpu(seq(i64(900n), add(i64(40n), i64(2n)))))), 42n);
});

test("CPU-only evaluator rejects forged headers and result identity", () => {
  let g = copy(); g.returnId = 0;
  rejects("INVALID_GRAPH", () => executeCpuI64(g));
  g = copy(); g.resultType = "Future<i64>";
  rejects("INVALID_GRAPH", () => executeCpuI64(g));
  g = copy(); g.nodes[0].extra = "untrusted";
  rejects("INVALID_GRAPH", () => executeCpuI64(g));
  g = copy(); g.extra = true;
  rejects("INVALID_GRAPH", () => executeCpuI64(g));
  g = copy(); delete g.nodes[0].domain;
  rejects("INVALID_GRAPH", () => executeCpuI64(g));
});

test("CPU-only evaluator checks all operands and canonical dependency edges", () => {
  let g = copy(); g.nodes[2].dependencies = [1];
  rejects("INVALID_GRAPH", () => executeCpuI64(g));
  g = copy(); g.nodes[2].dependencies = [0, 0, 1];
  rejects("INVALID_GRAPH", () => executeCpuI64(g));
  g = copy(); g.nodes[2].dependencies = [1, 0];
  rejects("INVALID_GRAPH", () => executeCpuI64(g));
  g = copy(); g.nodes[2].meta.left = -1;
  rejects("INVALID_GRAPH", () => executeCpuI64(g));
  g = copy(); g.nodes[2].meta.right = 3;
  rejects("INVALID_GRAPH", () => executeCpuI64(g));
  g = copy(); g.nodes[2].meta.extra = "false-proof";
  rejects("INVALID_GRAPH", () => executeCpuI64(g));
});

test("CPU-only evaluator rejects noncanonical or oversized i64 constants", () => {
  for (const value of ["0x28", "00", "-0", "+40", " 40", "9".repeat(10000)]) {
    const g = copy(); g.nodes[0].meta.value = value;
    rejects("INVALID_GRAPH", () => executeCpuI64(g));
  }
  rejects("INVALID_I64", () =>
    executeCpuI64(lower(cpu(add(i64(9223372036854775807n), i64(1n))))));
});

test("device, transfer and asynchronous graphs cannot pretend to be CPU execution", () => {
  let g = copy(); g.deviceKernels = 1;
  rejects("DEVICE_OR_ASYNC_UNAVAILABLE", () => executeCpuI64(g));
  g = copy(); g.effects = ["Host", "Suspend"];
  rejects("DEVICE_OR_ASYNC_UNAVAILABLE", () => executeCpuI64(g));
  g = copy(); g.nodes[2].opcode = "DEVICE_KERNEL";
  rejects("DEVICE_OR_ASYNC_UNAVAILABLE", () => executeCpuI64(g));
  const pending = lower(cpu(awaitNode(cpu(i64(42n), true))));
  rejects("DEVICE_OR_ASYNC_UNAVAILABLE", () => executeCpuI64(pending));
});

test("bounded AST snapshot accounts for nested trees, not only single Seq width", () => {
  const left = Array.from({length:1024}, () => i64(1n));
  const right = Array.from({length:1024}, () => i64(2n));
  rejects("NODE_LIMIT", () => lower(cpu(seq(seq(...left), seq(...right)))));
});

test("parameter admission requires an own declared type, never prototype inheritance", () => {
  const inherited = Object.create({device:"GpuBuffer<f32>"});
  rejects("PARAM_TYPE", () =>
    lower(Ast.GpuRegion(Ast.Kernel("scale", Ast.Param("device", "GpuBuffer<f32>"))),
      {parameters:inherited}));
});

test("AST admission rejects inherited fields and Object prototype property names", () => {
  for (const kind of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    rejects("INVALID_AST", () => lower({kind, value:i64(1n)}));
  }
  const missing = Object.create({value:40n});
  missing.kind = "I64";
  rejects("INVALID_AST", () => lower(cpu(missing)));
  const inheritedKind = Object.create({kind:"I64"});
  inheritedKind.value = 40n;
  rejects("INVALID_AST", () => lower(cpu(inheritedKind)));
  rejects("INVALID_AST", () => lower(cpu({kind:"I64",value:40n,ignored:1})));
});
