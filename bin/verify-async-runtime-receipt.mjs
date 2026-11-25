#!/usr/bin/env node
// Shape-consistency verifier only. NO evidence authentication, release certification,
// compiler execution, private-source movement, or async conformance is performed here.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function validateAsyncReceipt(receipt) {
  const ids = Array.from({length:15},(_,i)=>"ASYNC-"+String(i+1).padStart(2,"0"));
  const backendSet = new Set(["java","llvm","net","wasm","forge","js","embedded"]);
  const stages = new Set(["not-implemented","contract-only","host-model","source-compiled","rejected-as-required","guest-executed","native-aot-executed"]);
  const sha40=/^[0-9a-f]{40}$/,sha256=/^[0-9a-f]{64}$/;
  const errors=[];
  const obj=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
  if(!obj(receipt)) return {ok:false,shapeOnly:true,shapeValidCases:[],missingCases:ids,errors:["receipt must be an object"]};
  if(receipt.schema!=="oreslang.async-runtime-receipt/1")errors.push("invalid receipt schema");
  if(!backendSet.has(receipt.backend))errors.push("unknown backend");
  for(const p of ["sourceCommit","sourceTree","contractBlob"])if(typeof receipt[p]!=="string"||!sha40.test(receipt[p]))errors.push(p+" must be a lowercase 40-hex Git SHA");
  if(!Array.isArray(receipt.cases)||receipt.cases.length===0)errors.push("cases must be a nonempty array");
  const seen=new Set(),shapeValid=[];
  for(const [i,c] of (Array.isArray(receipt.cases)?receipt.cases:[]).entries()){
    const loc="cases["+i+"]";
    if(!obj(c)){errors.push(loc+" must be an object");continue}
    if(!ids.includes(c.id)){errors.push(loc+" unknown case id");continue}
    if(seen.has(c.id)){errors.push(loc+" duplicate case id "+c.id);continue}
    seen.add(c.id);
    if(!stages.has(c.evidence)){errors.push(loc+" unknown evidence stage");continue}
    if(!["supported","guarded","unsupported","pending"].includes(c.claim)){errors.push(loc+" unknown claim");continue}
    if(c.claim==="supported"&&!["guest-executed","native-aot-executed"].includes(c.evidence))
      errors.push(loc+" supported requires real guest execution evidence");
    if(c.claim==="guarded"&&c.evidence!=="rejected-as-required")
      errors.push(loc+" guarded requires compiler rejection evidence");
    if(c.claim==="unsupported"&&c.evidence!=="not-implemented")
      errors.push(loc+" unsupported must be not-implemented");
    if(c.claim==="pending"&&["guest-executed","native-aot-executed","rejected-as-required"].includes(c.evidence))
      errors.push(loc+" execution evidence must use supported or guarded claim");
    const executed=["source-compiled","rejected-as-required","guest-executed","native-aot-executed"].includes(c.evidence);
    if(executed){
      if(typeof c.fixturePath!=="string"||!c.fixturePath.endsWith(".ores")||c.fixturePath.startsWith("/")||c.fixturePath.includes("\\")||c.fixturePath.split("/").some(s=>s===""||s==="."||s===".."))
        errors.push(loc+" requires safe relative .ores fixturePath");
      if(typeof c.fixtureSha256!=="string"||!sha256.test(c.fixtureSha256))
        errors.push(loc+" requires fixture SHA-256");
      const e=c.execution;
      if(!obj(e))errors.push(loc+" requires execution evidence");
      else {
        if(!["gha","local"].includes(e.runnerKind))errors.push(loc+" invalid runnerKind");
        if(e.runnerKind==="gha"&&(!(/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/[0-9]+(?:\/.*)?$/).test(e.runUrl||"")))
          errors.push(loc+" GHA runner requires concrete run URL");
        if(!Number.isSafeInteger(e.executedSteps)||e.executedSteps<1)errors.push(loc+" zero-step/missing runner evidence");
        if(!Array.isArray(e.command)||e.command.length===0||e.command.some(a=>typeof a!=="string"||!a||a.length>2048))
          errors.push(loc+" missing or malformed executed argv");
        if(e.exitCode!==0)errors.push(loc+" execution exitCode must be 0");
        if(c.evidence==="rejected-as-required"){
          if(!Number.isSafeInteger(e.compilerExitCode)||e.compilerExitCode===0)
            errors.push(loc+" compiler rejection requires nonzero compilerExitCode");
          if(typeof e.expectedDiagnostic!=="string"||e.expectedDiagnostic.trim().length<3||e.expectedDiagnostic.length>512)
            errors.push(loc+" compiler rejection requires expectedDiagnostic");
        }
        if(!Number.isSafeInteger(e.assertionCount)||e.assertionCount<1)
          errors.push(loc+" missing executed assertions");
        if(typeof e.compilerSha256!=="string"||!sha256.test(e.compilerSha256))
          errors.push(loc+" missing compiler binary SHA-256");
        if(c.evidence==="native-aot-executed"&&(!sha256.test(e.nativeExecutableSha256||"")))
          errors.push(loc+" native AOT requires executable SHA-256");
      }
    } else if(c.claim==="supported"||c.claim==="guarded"){
      errors.push(loc+" no executable evidence for claim");
    }
    if(!errors.some(x=>x.startsWith(loc+" ")))shapeValid.push(c.id);
  }
  return {ok:errors.length===0,shapeOnly:true,shapeValidCases:shapeValid,missingCases:ids.filter(id=>!seen.has(id)),errors};
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length!==3) throw Error("usage: node bin/verify-async-runtime-receipt.mjs receipt.json");
    const raw=readFileSync(process.argv[2],"utf8");
    if (raw.length>1024*1024) throw Error("receipt exceeds 1 MiB");
    const result=validateAsyncReceipt(JSON.parse(raw));
    console.log(JSON.stringify({classification:"RECEIPT_SHAPE_ONLY_NO_PROMOTION",...result},null,2));
    if(!result.ok)process.exitCode=1;
  }catch(err){console.error("INVALID_RECEIPT: "+(err.message||err));process.exitCode=2}
}
