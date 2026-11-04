import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const data = JSON.parse(readFileSync(new URL("../contracts/mcp-backend-evidence-v1.json", import.meta.url), "utf8"));
const m0 = JSON.parse(readFileSync(new URL("../contracts/mcp-dev-control-m0-v1.json", import.meta.url), "utf8"));
const hex40 = /^[0-9a-f]{40}$/;
test("MCP LLVM native evidence references the same versioned source contract", () => {
 assert.equal(data.schema, "atto.mcp.backend-evidence.v1");
 assert.equal(data.contract, m0.schema);
 assert.equal(data.protocolVersion, m0.protocolVersion);
 assert.equal(data.sourceExportPermitted, false);
});
test("LLVM local host evidence does not promote compiler-backed guest parity", () => {
 const v = data.backends.llvm;
 assert.equal(v.nativeHost.status, "LOCAL_EXECUTED");
 assert.equal(v.nativeHost.assertionsPerCompiler, 310);
 assert.deepEqual(v.nativeHost.compilers, ["gcc-14.2","clang-17"]);
 assert.deepEqual(v.nativeHost.sanitizers, ["ASan","UBSan"]);
 assert.equal(v.nativeHost.hostedExecutedSteps, 0);
 assert.equal(v.nativeHost.hostedStatus, "NOT_EXECUTED");
 assert.equal(v.m1Descriptor.status, "LOCAL_HOST_HELPER_ONLY");
 assert.equal(v.m1Descriptor.assertionsPerCompiler, 29);
 assert.equal(v.m1Descriptor.hostedExecutedSteps, 0);
 assert.equal(v.m1Descriptor.compilerDriverExecution, "NOT_EXECUTED");
 assert.equal(v.m1Descriptor.guestNativeExecution, "NOT_EXECUTED");
 assert.equal(v.guestParity, "NOT_EXECUTED");
 assert.equal(v.aotDescriptorEmbedding, "NOT_IMPLEMENTED");
 assert.equal(v.liveMcpTransport, "NOT_IMPLEMENTED");
 assert.equal(v.mergeReady, false);
});
test("cross-backend evidence never silently infers native guest execution", () => {
 assert.deepEqual(Object.keys(data.backends).sort(), ["forge","java","llvm","net","wasm"]);
 for (const [backend,status] of Object.entries(data.backends)) {
  assert.equal(status.guestParity,"NOT_EXECUTED",backend);
  assert.equal(status.mergeReady,false,backend);
  assert.equal(status.liveMcpTransport,"NOT_IMPLEMENTED",backend);
 }
});
test("exact heads, trees and independent security gate remain mandatory", () => {
 for (const path of [data.backends.llvm.nativeHost, data.backends.llvm.m1Descriptor]) {
  assert.match(path.head,hex40);
  assert.match(path.tree,hex40);
  assert.equal(path.hostedExecutedSteps,0);
 }
 assert.ok(data.blockingGates.some(x=>x.includes("independent security review")));
 assert.ok(data.blockingGates.some(x=>x.includes("nonzero exact-head hosted steps")));
});
