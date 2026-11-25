import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {verifyTenantIsolateReceipt as verify} from "../bin/verify-tenant-isolate-receipt.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const contract=JSON.parse(fs.readFileSync(path.join(root,"contracts/tenant-isolate-parity-v1.json"),"utf8"));
function fixture(backend="wasm") {
  const b=contract.backends[backend];
  return {
    schema:"oreslang.tenant-isolate-parity/1", backend,repository:b.repository,
    stage:"tenant-isolation",
    provenance:{sourceCommit:"a".repeat(40),treeSha:"b".repeat(40),
      compilerCommit:"c".repeat(40),runHead:"a".repeat(40),
      artifactSha256:"d".repeat(64),compilerSha256:"e".repeat(64),exactHead:true},
    execution:{executedSteps:8,workflowConclusion:"success",
      workflowRunUrl:`https://github.com/ores-truffle-oreslang/oreslang-source.${backend}/actions/runs/12345`,
      realOresGuest:true,compilerGenerated:true,targetExecuted:true,
      hostReferenceOnly:false,fullAot:true,jitOrInterpreterFallback:false,
      positiveCases:2,negativeCases:2},
    isolation:{mechanism:b.isolate,guestMemory:b.memory,
      perTenantMutableGlobals:true,actorTurnExclusive:true,generationFence:true,
      crossTenantLeakRejected:true,quiescentRetirement:true,boundedQuotas:true,
      hostileTenantExecution:false,osBoundary:"none"}
  };
}
function rejects(mutate,pattern) {
  const r=fixture();
  mutate(r);
  const v=verify(r,contract);
  assert.equal(v.ok,false,"incorrectly admitted a false evidence receipt");
  assert.match(v.errors.join(" | "),pattern);
}
test("structural tenant receipt valid only; never proves backend behavior",()=>{
  const v=verify(fixture(),contract);
  assert.equal(v.ok,true,v.errors.join(" | "));
});
test("all four canonical backend/memory/isolate bindings accepted structurally",()=>{
  for(const backend of ["java","llvm","wasm","net"]) {
    const r=fixture(backend);
    r.execution.workflowRunUrl=`https://github.com/ores-truffle-oreslang/oreslang-source.${backend}/actions/runs/12345`;
    assert.equal(verify(r,contract).ok,true,backend);
  }
});
test("zero-step CI must fail closed",()=>rejects(r=>r.execution.executedSteps=0,/zero-step/));
test("failed workflow must fail closed",()=>rejects(r=>r.execution.workflowConclusion="failure",/successful/));
test("mismatched exact HEAD must fail",()=>rejects(r=>r.provenance.runHead="f".repeat(40),/HEAD/));
test("source-only test is not compiled guest",()=>rejects(r=>r.execution.realOresGuest=false,/real compiled/));
test("host-only reference is not compiled guest",()=>rejects(r=>r.execution.hostReferenceOnly=true,/real compiled/));
test("interpreter or JIT is not strict AOT",()=>rejects(r=>r.execution.jitOrInterpreterFallback=true,/strict AOT/));
test("compiled positives without executed negatives are insufficient",()=>rejects(r=>r.execution.negativeCases=0,/positive and negative/));
test("tenant process boundary cannot be forged using Wasmtime Store",()=>rejects(r=>{
  r.isolation.hostileTenantExecution=true;
  r.isolation.osBoundary="wasmtime-store";
},/OS sandbox/));
test("tenant process boundary cannot be forged using ALC",()=>rejects(r=>{
  r.isolation.osBoundary="alc";
},/not OS sandbox/));
test("tenant mutable shared state must be proven isolated",()=>rejects(r=>r.isolation.crossTenantLeakRejected=false,/crossTenantLeakRejected/));
test("reused actor generation must be fenced",()=>rejects(r=>r.isolation.generationFence=false,/generationFence/));
test("stopped tenant must be fully quiesced",()=>rejects(r=>r.isolation.quiescentRetirement=false,/quiescentRetirement/));
test("backend-specific native heap accounting cannot be misreported",()=>rejects(r=>r.isolation.guestMemory="actor-owned-no-tracing-gc",/memory model/));
test("no inherited prototype can name a backend",()=>{
  const r=fixture();
  r.backend="__proto__";
  assert.match(verify(r,contract).errors.join(" | "),/unknown backend/);
});
test("contract substitution is rejected",()=>{
  const c=structuredClone(contract);
  c.backends.net.repository="unapproved-org/mirror";
  assert.match(verify(fixture(),c).errors.join(" | "),/backend binding: net/);
});
test("hard-rt claim cannot be made by WASM or .NET",()=>{
  for(const backend of ["wasm","net","java"]) {
    const r=fixture(backend);r.stage="hard-rt";
    assert.match(verify(r,contract).errors.join(" | "),/only LLVM/);
  }
});
function llvmRt() {
  const r=fixture("llvm");
  r.stage="hard-rt";
  r.realTime={profile:"strict-hard-rt",hardware:"Cortex-M7 revision X",
    osConfig:"Zephyr named locked configuration",
    closedAotGraph:true,noTracingGC:true,noHotPathAllocation:true,noUnknownBlocking:true,
    boundedStack:true,boundedLoops:true,boundedMailbox:true,boundedCleanup:true,
    preemptionBounded:true,wcetProofSha256:"f".repeat(64),
    deadlineNs:1000000,wcetBoundNs:900000};
  return r;
}
test("LLVM hard-RT proof metadata admits structurally, not as certification",()=>{
  assert.equal(verify(llvmRt(),contract).ok,true);
});
test("LLVM RT deadline overrun fails closed",()=>{
  const r=llvmRt();r.realTime.wcetBoundNs=1000001;
  assert.match(verify(r,contract).errors.join(" | "),/WCET/);
});
test("LLVM RT requires no hot path allocation",()=>{
  const r=llvmRt();r.realTime.noHotPathAllocation=false;
  assert.match(verify(r,contract).errors.join(" | "),/noHotPathAllocation/);
});
test("LLVM RT requires proof digest, not jitter alone",()=>{
  const r=llvmRt();delete r.realTime.wcetProofSha256;
  assert.match(verify(r,contract).errors.join(" | "),/WCET proof digest/);
});

test("cross-backend workflow substitution fails closed",()=>rejects(r=>{
  r.execution.workflowRunUrl="https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/12345";
},/exact source backend/));
test("external, zero, padded, or job-suffixed run URLs fail",()=>{
  for (const url of [
    "https://github.com/outside-org/oreslang-source.wasm/actions/runs/12345",
    "https://github.com/ores-truffle-oreslang/oreslang-source.wasm/actions/runs/0",
    "https://github.com/ores-truffle-oreslang/oreslang-source.wasm/actions/runs/012345",
    "https://github.com/ores-truffle-oreslang/oreslang-source.wasm/actions/runs/12345/job/9"
  ]) rejects(r=>{r.execution.workflowRunUrl=url},/exact source backend/);
});
