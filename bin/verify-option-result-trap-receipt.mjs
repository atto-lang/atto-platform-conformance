#!/usr/bin/env node
// This is a receipt SHAPE validator, not cryptographic GitHub Actions or guest attestation.
import {readFileSync, lstatSync} from "node:fs";
import {createHash} from "node:crypto";
import {dirname, resolve, sep} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const manifestFile=resolve(root,"fixtures/option-result-trap/v1/manifest.json");
const sha40=/^[a-f0-9]{40}$/;
const sha64=/^[a-f0-9]{64}$/;
const nonEmpty=x=>typeof x==="string" && x.trim().length>0;
const isObject=x=>x!==null && typeof x==="object" && !Array.isArray(x);

export function verifyOptionResultTrapReceipt(receipt,manifest,fixtureDigest) {
  const errors=[];
  const fail=message=>errors.push(message);
  if(!isObject(manifest) || manifest.schema!=="oreslang.option-result-trap.fixtures/v1")
    return {ok:false,errors:["unknown fixture manifest schema"]};
  if(!isObject(receipt)) return {ok:false,errors:["receipt must be an object"]};
  if(receipt.schema!=="oreslang.option-result-trap.receipt/v1") fail("unknown receipt schema");
  const supported=Array.isArray(manifest.backends) ? manifest.backends : [];
  if(!supported.includes(receipt.backend)) fail("unknown backend");
  const cases=Array.isArray(manifest.cases) ? manifest.cases : [];
  const c=cases.find(x=>isObject(x)&&x.id===receipt.caseId);
  if(!c) fail("case ID is not registered");
  if(!sha40.test(receipt.sourceCommit||"")) fail("missing exact source commit");
  if(!sha40.test(receipt.stdlibCommit||"")) fail("missing exact stdlib commit");
  if(!sha64.test(receipt.compilerBinarySha256||"")) fail("missing compiler binary digest");
  if(!sha64.test(receipt.fixtureSha256||"")) fail("missing fixture digest");
  if(!sha64.test(fixtureDigest||"") || receipt.fixtureSha256!==fixtureDigest)
    fail("fixture bytes differ from pinned checkout");
  if(!nonEmpty(receipt.runtimeVersion)) fail("runtime version missing");
  const e=receipt.evidence;
  if(!isObject(e)) return {ok:false,errors:[...errors,"evidence must be object"]};
  if(e.exactHead!==true || e.sourceCommit!==receipt.sourceCommit)
    fail("exact source-head identity missing or mismatched");
  if(!Number.isSafeInteger(e.runnerId)||e.runnerId<=0)
    fail("runner admission missing");
  if(!Number.isSafeInteger(e.runAttempt)||e.runAttempt<=0)
    fail("run attempt missing");
  if(!Array.isArray(e.steps)||e.steps.length===0||
     e.steps.some(s=>!nonEmpty(s)))
    fail("executed job steps missing");
  if(e.workflowConclusion!=="success") fail("workflow not successful");
  if(e.hostReferenceOnly!==false||e.compilerProduced!==true)
    fail("actual compiler-produced guest evidence required");
  if(!Number.isSafeInteger(e.compilerExitCode))
    fail("compiler exit code missing");
  if(c?.kind==="guest_stdout") {
    if(e.compilerExitCode!==0||e.guestLaunched!==true||e.guestExitCode!==0)
      fail("successful guest compile and execution required");
    if(e.stdout!==c.expected_stdout)
      fail("guest stdout mismatch; source-only or partial receipts cannot pass");
    if(!nonEmpty(e.guestStep)) fail("guest execution step missing");
  } else if(c?.kind==="guest_panic") {
    if(e.compilerExitCode!==0||e.guestLaunched!==true||
       !Number.isSafeInteger(e.guestExitCode)||e.guestExitCode===0)
      fail("actual nonzero guest panic required");
    if(e.runtimeControl!=="guest_panic"||
       !nonEmpty(e.stderr)||!e.stderr.includes(c.expected_diagnostic_contains))
      fail("guest panic identity/diagnostic not preserved");
    if(typeof e.stdout!=="string"||e.stdout.includes(c.forbidden_stdout))
      fail("forbidden post-panic output observed");
    if(!nonEmpty(e.guestStep)) fail("guest panic execution step missing");
  } else if(c?.kind==="compile_reject") {
    if(e.compilerExitCode!==1||e.guestLaunched!==false||
       e.guestExitCode!==null || e.guestStep!==null)
      fail("type rejection must happen before guest launch");
    if(e.diagnosticCategory!=="type"||!nonEmpty(e.stderr))
      fail("typed compiler rejection diagnostic required");
    if(e.stdout!=="") fail("compile rejection must not print guest stdout");
  } else fail("unknown fixture expectation");
  return {ok:errors.length===0,errors};
}

function fixtureDigestFor(c) {
  if(!isObject(c)||!/^fixtures\/option-result-trap\/v1\/[a-z_\/]+\.ores$/.test(c.path))
    throw new Error("unsafe or unknown fixture path");
  const filename=resolve(root,c.path);
  if(!filename.startsWith(root+sep)) throw new Error("fixture escapes checkout");
  const stat=lstatSync(filename);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>131072)
    throw new Error("untrusted fixture entry or size");
  return createHash("sha256").update(readFileSync(filename)).digest("hex");
}
export function verifyReceiptFile(filename) {
  const manifest=JSON.parse(readFileSync(manifestFile,"utf8"));
  const receipt=JSON.parse(readFileSync(filename,"utf8"));
  const c=manifest.cases?.find(x=>x.id===receipt?.caseId);
  const digest=fixtureDigestFor(c);
  return verifyOptionResultTrapReceipt(receipt,manifest,digest);
}
const invoked=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(invoked) {
  if(!process.argv[2]) {
    console.error("usage: node bin/verify-option-result-trap-receipt.mjs receipt.json");
    process.exit(64);
  }
  try{
    const result=verifyReceiptFile(process.argv[2]);
    if(!result.ok) {
      result.errors.forEach(s=>console.error("ORT receipt: "+s));
      process.exit(1);
    }
    // This checks asserted fields and local fixture bytes, NOT independent provenance.
    console.log("ORT receipt: SHAPE_VALID; independent run authentication still required");
  }catch(error){
    console.error("ORT receipt: "+(error instanceof Error?error.message:String(error)));
    process.exit(1);
  }
}
