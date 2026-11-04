#!/usr/bin/env node
// Structural admission only: never an attestation, runtime test, or hard-RT certificate.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const expected = Object.freeze({
  java: ["ores-truffle-oreslang/oreslang-source.java","graal-native-isolate","managed-graal-isolate",false],
  llvm: ["ores-truffle-oreslang/oreslang-source.llvm","native-ores-isolatevm","actor-owned-no-tracing-gc",true],
  wasm: ["ores-truffle-oreslang/oreslang-source.wasm","wasmtime-store-instance","linear-memory-no-guest-gc",false],
  net: ["ores-truffle-oreslang/oreslang-source.net","nativeaot-ores-isolatevm","unmanaged-guest-arena-clr-host-gc",false]
});
const stages=["host-reference","compiled-guest","tenant-isolation","hard-rt"];
const hex40=/^[a-f0-9]{40}$/;
const hex64=/^[a-f0-9]{64}$/;
const object=(x)=>x!==null && typeof x==="object" && !Array.isArray(x);
const positive=(x)=>Number.isSafeInteger(x) && x>0;

export function verifyTenantIsolateReceipt(r,c) {
  const problems=[];
  const fail=(s)=>problems.push(s);
  if(!object(c) || c.contract!=="oreslang.tenant-isolate-parity/1" || c.schemaVersion!==1)
    return {ok:false,errors:["unsupported contract"]};
  if(JSON.stringify(c.stages)!==JSON.stringify(stages)) fail("changed contract stages");
  if(!object(c.backends) || Object.keys(c.backends).sort().join(",")!=="java,llvm,net,wasm")
    fail("changed backend registry");
  for(const [key,[repo,isolate,memory,rt]] of Object.entries(expected)) {
    const value=c.backends?.[key];
    if(!object(value) || value.repository!==repo || value.isolate!==isolate ||
       value.memory!==memory || value.hardRtEligible!==rt)
      fail("changed contract backend binding: "+key);
  }
  if(problems.length) return {ok:false,errors:problems};
  if(!object(r)) return {ok:false,errors:["receipt must be an object"]};
  if(r.schema!=="oreslang.tenant-isolate-parity/1") fail("bad schema");
  const backend=typeof r.backend==="string" && Object.hasOwn(expected,r.backend)
    ? expected[r.backend] : null;
  if(!backend) fail("unknown backend");
  else if(r.repository!==backend[0]) fail("repository substitution");
  const level=stages.indexOf(r.stage);
  if(level<0) fail("unknown stage");
  const p=r.provenance;
  if(!object(p)) fail("missing provenance");
  else {
    for(const key of ["sourceCommit","treeSha","compilerCommit","runHead"])
      if(typeof p[key]!=="string" || !hex40.test(p[key])) fail("bad "+key);
    for(const key of ["artifactSha256","compilerSha256"])
      if(typeof p[key]!=="string" || !hex64.test(p[key])) fail("bad "+key);
    if(p.sourceCommit!==p.runHead) fail("source HEAD does not match executed HEAD");
    if(p.exactHead!==true) fail("exactHead required");
  }
  const e=r.execution;
  if(!object(e)) fail("missing execution");
  else {
    if(!positive(e.executedSteps)) fail("zero-step/unexecuted CI is not evidence");
    if(e.workflowConclusion!=="success") fail("successful stepful run required");
    // A job from Java, another backend, or another organization is not this source runner.
    const sourceUrl = backend ? `https://github.com/${backend[0]}/actions/runs/` : "";
    if (typeof e.workflowRunUrl !== "string" || !backend ||
        !e.workflowRunUrl.startsWith(sourceUrl) ||
        !/^[1-9][0-9]*$/.test(e.workflowRunUrl.slice(sourceUrl.length)))
      fail("workflow run URL must identify the exact source backend");
    if(level>=1) {
      if(e.realOresGuest!==true || e.compilerGenerated!==true ||
         e.targetExecuted!==true || e.hostReferenceOnly!==false)
        fail("real compiled .ores guest execution required");
      if(e.fullAot!==true || e.jitOrInterpreterFallback!==false)
        fail("strict AOT guest without JIT/interpreter required");
      if(!positive(e.positiveCases) || !positive(e.negativeCases))
        fail("executed positive and negative .ores cases required");
    }
  }
  if(level>=2) {
    const i=r.isolation;
    if(!object(i)) fail("missing isolation evidence");
    else {
      if(backend && i.mechanism!==backend[1]) fail("wrong tenant isolate mechanism");
      if(backend && i.guestMemory!==backend[2]) fail("wrong guest memory model");
      for(const flag of ["perTenantMutableGlobals","actorTurnExclusive","generationFence",
                          "crossTenantLeakRejected","quiescentRetirement","boundedQuotas"])
        if(i[flag]!==true) fail("isolation proof missing: "+flag);
      if(i.hostileTenantExecution===true && i.osBoundary!=="sandboxed-process")
        fail("hostile tenants require OS sandboxed process");
      if(i.osBoundary==="alc" || i.osBoundary==="node-worker" || i.osBoundary==="wasmtime-store")
        fail("in-process compartment is not OS sandbox");
    }
  }
  if(level===3) {
    if(r.backend!=="llvm") fail("only LLVM can request hard-rt evidence stage");
    const rt=r.realTime;
    if(!object(rt)) fail("missing RT qualifications");
    else {
      if(rt.profile!=="strict-hard-rt" || typeof rt.hardware!=="string" ||
         rt.hardware.length<4 || typeof rt.osConfig!=="string" || rt.osConfig.length<4)
        fail("named RT hardware and OS/RTOS configuration required");
      for(const flag of ["closedAotGraph","noTracingGC","noHotPathAllocation","noUnknownBlocking",
                          "boundedStack","boundedLoops","boundedMailbox","boundedCleanup","preemptionBounded"])
        if(rt[flag]!==true) fail("hard RT property missing: "+flag);
      if(typeof rt.wcetProofSha256!=="string" || !hex64.test(rt.wcetProofSha256))
        fail("WCET proof digest required");
      if(!positive(rt.deadlineNs) || !positive(rt.wcetBoundNs) ||
         rt.wcetBoundNs>rt.deadlineNs) fail("WCET must fit declared deadline");
    }
  }
  return {ok:problems.length===0,errors:problems};
}

const invoked=process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
  const contract=JSON.parse(fs.readFileSync(path.join(root,"contracts/tenant-isolate-parity-v1.json"),"utf8"));
  try {
    if(process.argv.length!==3) throw Error("usage: node bin/verify-tenant-isolate-receipt.mjs RECEIPT.json");
    const receipt=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
    const result=verifyTenantIsolateReceipt(receipt,contract);
    if(!result.ok) {
      console.error(result.errors.join("\n"));
      process.exitCode=1;
    } else {
      console.log("STRUCTURALLY_VALID_ONLY: independent run authentication and guest/runtime/RT proofs still required");
    }
  } catch(error) {
    console.error(error.message);
    process.exitCode=1;
  }
}
