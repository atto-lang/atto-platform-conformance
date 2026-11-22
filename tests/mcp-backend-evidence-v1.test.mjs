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
 assert.equal(v.nativeHost.assertionsPerCompiler, 315);
 assert.deepEqual(v.nativeHost.compilers, ["gcc-14.2","clang-17"]);
 assert.deepEqual(v.nativeHost.sanitizers, ["ASan","UBSan"]);
 assert.equal(v.nativeHost.hostedExecutedSteps, 0);
 assert.equal(v.nativeHost.hostedStatus, "NOT_EXECUTED");
 assert.equal(v.m1Descriptor.status, "LOCAL_HOST_HELPER_AND_ELF_LINKER_ONLY");
 assert.equal(v.m1Descriptor.assertionsPerCompiler, 48);
 assert.equal(v.m1Descriptor.localElfLinkerCanary, "PASSED_READ_ONLY_WRITABLE_MUTATION_O0_O2_SOURCE_FREE");
 assert.equal(v.m1Descriptor.embeddedDescriptorProof, "NOT_EXECUTED");
 assert.equal(v.m1Descriptor.hostedExecutedSteps, 0);
 assert.ok(v.m1Descriptor.additionalGates.includes("LLVM verified-codegen before metadata publication"));
 assert.ok(v.m1Descriptor.additionalGates.includes("compiler-backed native guest output O0 and O2 for atto and ores"));
 assert.match(v.nativeHost.currentHead, hex40);
 assert.match(v.nativeHost.currentTree, hex40);
 assert.equal(v.nativeHost.currentSourceSteps, 0);
 assert.equal(v.nativeHost.sourceChangedSinceLocalProof, false);
 assert.match(v.m1Descriptor.currentHead, hex40);
 assert.match(v.m1Descriptor.currentTree, hex40);
 assert.equal(v.m1Descriptor.currentSourceSteps, 0);
 assert.equal(v.m1Descriptor.fullMergedSourceNotExecuted, true);
 assert.notEqual(v.m1Descriptor.currentHead, v.m1Descriptor.head);
 assert.match(v.m1Descriptor.checkedBlobs.emitter,hex40);
 assert.match(v.m1Descriptor.checkedBlobs.nativeGuestTest,hex40);
 assert.equal(v.m1Descriptor.compilerDriverExecution, "NOT_EXECUTED");
 assert.equal(v.m1Descriptor.guestNativeExecution, "NOT_EXECUTED");
 assert.equal(v.guestParity, "NOT_EXECUTED");
 assert.equal(v.aotDescriptorEmbedding, "SOURCE_IMPLEMENTED_NOT_EXECUTED");
 assert.equal(v.liveMcpTransport, "NOT_IMPLEMENTED");
 assert.equal(v.mergeReady, false);
});
test("current LLVM M0/M1 native host proof binds five exact blobs without guest promotion", () => {
 const v=data.backends.llvm;
 const p=v.localCurrentBlobHostProof;
 assert.equal(p.scope,"EXACT_GIT_BLOBS_NATIVE_HOST_ONLY_NOT_COMPILER_NOT_GUEST");
 assert.equal(p.matrixStatus,"LOCAL_EXECUTED_ALL_8_PASS");
 assert.equal(p.m0AssertionsPerMode,315);
 assert.equal(p.m1AssertionsPerMode,48);
 assert.deepEqual(p.compilers,["gcc-14.2","clang-17"]);
 assert.deepEqual(p.modes,["optimized","asan-ubsan"]);
 assert.equal(p.verifiedAtHeads.m0,v.nativeHost.currentHead);
 assert.equal(p.verifiedAtHeads.m1,v.m1Descriptor.currentHead);
 assert.equal(p.verifiedAtTrees.m0,v.nativeHost.currentTree);
 assert.equal(p.verifiedAtTrees.m1,v.m1Descriptor.currentTree);
 assert.equal(Object.keys(p.blobs).length,5);
 for(const sha of Object.values(p.blobs)) assert.match(sha,hex40);
 assert.match(p.hostLogSha256,/^[0-9a-f]{64}$/);
 assert.match(p.receiptSha256,/^[0-9a-f]{64}$/);
 assert.equal(p.fullCompilerBuild,"NOT_EXECUTED");
 assert.equal(p.guestExecution,"NOT_EXECUTED");
 assert.equal(p.hostedCI,"NOT_EXECUTED");
 assert.equal(p.independentSecurityReview,"NOT_OBTAINED");
 assert.equal(v.guestParity,"NOT_EXECUTED");
 assert.equal(v.m1Descriptor.compilerGuestReceipt.status,"NOT_EXECUTED");
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

test("LLVM and JS M0 live ticket authority fences stay aligned",()=>{
 assert.equal(data.backends.llvm.nativeHost.regression,"ticket invalidated on boot rotation and peer verification revocation");
 assert.equal(data.jsReference.admissionAndFrameTests,62);
 assert.deepEqual(data.jsReference.liveTicketRequires,["boot_identity","authenticated_peer","runtime_generation","credential_expiry","monotonic_deadline"]);
 assert.equal(data.backends.llvm.m1Descriptor.m0HeadMerged,data.backends.llvm.nativeHost.head);
});

test("compiler-backed AOT receipt is not promoted without runner-backed guest execution",()=>{
 const v=data.backends.llvm.m1Descriptor;
 const receipt=v.compilerGuestReceipt;
 assert.equal(receipt.status,"NOT_EXECUTED");
 assert.equal(receipt.schema,"atto.mcp.llvm-aot-guest-evidence.v1");
 assert.deepEqual(receipt.requiredCases,["atto:O0","atto:O2","ores:O0","ores:O2"]);
 assert.equal(receipt.descriptorMustMatchCompilerMetadataBytes,true);
 assert.equal(receipt.onlyUploadAfterSuccessfulNativeExecution,true);
 assert.equal(v.currentSourceSteps,0);
 assert.equal(v.guestNativeExecution,"NOT_EXECUTED");
 assert.equal(data.backends.llvm.guestParity,"NOT_EXECUTED");
});

test("LLVM AOT receipt verifier cannot promote source-free tests to guest parity",()=>{
 const m=data.backends.llvm.m1Descriptor;
 const v=m.receiptVerifier;
 assert.equal(v.classification,"LOCAL_SOURCE_FREE_RECEIPT_FORMAT_TEST_ONLY");
 assert.equal(v.assertions,29);
 assert.equal(v.standalonePassed,true);
 assert.equal(v.syntaxAndShapeOnly,true);
 assert.equal(v.hostedVerification,"NOT_EXECUTED");
 assert.equal(m.currentSourceSteps,0);
 assert.equal(m.compilerGuestReceipt.status,"NOT_EXECUTED");
 assert.equal(m.guestNativeExecution,"NOT_EXECUTED");
 assert.match(v.fileBlob,hex40);
 assert.match(v.testBlob,hex40);
 assert.equal(v.expectedHead,m.currentHead);
 assert.equal(v.expectedTree,m.currentTree);
});
