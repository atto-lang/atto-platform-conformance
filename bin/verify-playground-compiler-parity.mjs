#!/usr/bin/env node
// Shape validation ONLY; does not authenticate Git SHA, CI runs, binary or behavior.
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
export function validatePlaygroundReceipt(r,c){
 const errors=[],sha40=/^[0-9a-f]{40}$/,sha256=/^[0-9a-f]{64}$/,obj=x=>x!==null&&typeof x==="object"&&!Array.isArray(x);
 const safe=p=>typeof p==="string"&&p.endsWith(".ores")&&!p.startsWith("/")&&!p.includes("\\")&&p.length<512&&p.split("/").every(s=>s&&s!=="."&&s!=="..");
 if(!obj(c)||!Array.isArray(c.cases)||!Array.isArray(c.backends))return {valid:false,complete:false,parityCertified:false,evidenceAuthenticated:false,errors:["bad contract"]};
 if(!obj(r))return {valid:false,complete:false,parityCertified:false,evidenceAuthenticated:false,errors:["receipt not object"]};
 if(r.schema!=="oreslang.playground-compiler-receipt/1")errors.push("receipt schema mismatch");
 if(!c.backends.some(b=>b.id===r.backend&&b.repository===r.repository))errors.push("backend/repository mismatch");
 for(const f of ["sourceCommit","sourceTree"])if(!sha40.test(r[f]||""))errors.push(f+" missing");
 if(!sha256.test(r.compilerBinarySha256||""))errors.push("compilerBinarySha256 missing");
 if(r.upstreamManifestBlobSha!==c.upstream.manifestBlobSha)errors.push("upstream manifest mismatch");
 if(!obj(r.runner)||!["local","gha"].includes(r.runner.kind)||!Number.isSafeInteger(r.runner.executedSteps)||r.runner.executedSteps<1||!Array.isArray(r.runner.compilerArgv)||r.runner.compilerArgv.length===0||r.runner.compilerArgv.some(s=>typeof s!=="string"||!s))errors.push("missing genuine runner steps/argv metadata");
 if(obj(r.runner)&&r.runner.kind==="gha"&&!/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/[0-9]+/.test(r.runner.runUrl||""))errors.push("invalid GHA run URL");
 const known=new Map(c.cases.map(x=>[x.id,x])),seen=new Set();
 let complete=true;
 if(!Array.isArray(r.cases))errors.push("case results not array");
 for(const [i,item] of (Array.isArray(r.cases)?r.cases:[]).entries()){
   const loc="case "+i;
   if(!obj(item)){errors.push(loc+" not object");continue;}
   const target=known.get(item.id);
   if(!target||seen.has(item.id)){errors.push(loc+" unknown/duplicate "+item.id);continue;}
   seen.add(item.id);
   if(!["NOT_EXECUTED","UNSUPPORTED","SEMANTIC_REJECTED","GUEST_EXECUTED","NATIVE_AOT_EXECUTED"].includes(item.stage)){errors.push(loc+" unknown stage");continue;}
   if(["NOT_EXECUTED","UNSUPPORTED"].includes(item.stage))complete=false;
   if(item.stage==="NOT_EXECUTED"&&("execution" in item||"diagnostic" in item))errors.push(loc+" impossible unexecuted evidence");
   if(item.stage==="UNSUPPORTED"&&(!/^E_[A-Z][A-Z0-9_]*$/.test(item.diagnostic||"")||!Number.isSafeInteger(item.compilerExitCode)||item.compilerExitCode===0))errors.push(loc+" unsupported needs nonzero diagnostic");
   const positive=target.kind==="positive";
   if(positive&&item.stage==="SEMANTIC_REJECTED")errors.push(loc+" positive cannot pass by rejection");
   if(!positive&&["GUEST_EXECUTED","NATIVE_AOT_EXECUTED"].includes(item.stage))errors.push(loc+" negative cannot pass as positive guest");
   if(["SEMANTIC_REJECTED","GUEST_EXECUTED","NATIVE_AOT_EXECUTED"].includes(item.stage)){
     const e=item.execution;
     if(!safe(item.guestSourcePath)||!sha40.test(item.guestSourceBlobSha||""))errors.push(loc+" missing pinned .ores source");
     if(!obj(e)){errors.push(loc+" execution missing");continue;}
     if(!Number.isSafeInteger(e.executedSteps)||e.executedSteps<1||!Number.isSafeInteger(e.assertions)||e.assertions<1||!Array.isArray(e.compileArgv)||!e.compileArgv.length)errors.push(loc+" missing executed steps/assertions/compiler argv");
     if(item.stage==="SEMANTIC_REJECTED"){
       if(e.compilerExitCode===0||!Number.isSafeInteger(e.compilerExitCode)||!/^E_[A-Z][A-Z0-9_]*$/.test(e.diagnostic||"")||e.diagnosticCategory!==target.diagnosticCategory||"guestExitCode" in e)errors.push(loc+" not a proven semantic rejection");
     }else{
       if(e.compilerExitCode!==0||e.guestExitCode!==0||e.executedGuest!==true||e.oracleMatched!==true||!sha256.test(e.artifactSha256||"")||!Array.isArray(e.guestArgv)||!e.guestArgv.length)errors.push(loc+" missing successful guest run/artifact/oracle");
       if(c.promotion.fullAot.includes(r.backend)&&item.stage!=="NATIVE_AOT_EXECUTED")errors.push(loc+" full AOT evidence required");
       if(r.backend==="wasm"&&e.wasmWorkerExecuted!==true)errors.push(loc+" Wasm Worker execution required");
     }
   }
 }
 const missing=[...known.keys()].filter(id=>!seen.has(id));
 if(missing.length){errors.push("missing "+missing.length+" cases");complete=false;}
 return {valid:errors.length===0,fullEvidenceShape:errors.length===0&&complete,parityCertified:false,evidenceAuthenticated:false,shapeOnly:true,caseCount:known.size,observed:seen.size,errors};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3)throw Error("usage: node bin/verify-playground-compiler-parity.mjs receipt.json");
  const data=readFileSync(process.argv[2],"utf8");
  if(data.length>2097152)throw Error("receipt too large");
  const contract=JSON.parse(readFileSync(new URL("../contracts/playground-compiler-parity-v1.json",import.meta.url),"utf8"));
  const result=validatePlaygroundReceipt(JSON.parse(data),contract);
  console.log(JSON.stringify({classification:"UNAUTHENTICATED_SHAPE_CHECK_ONLY",...result},null,2));
  if(!result.valid)process.exitCode=1;
 }catch(e){console.error("INVALID_RECEIPT: "+e.message);process.exitCode=2;}
}
