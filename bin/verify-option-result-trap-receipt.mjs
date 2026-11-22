#!/usr/bin/env node
// This is a receipt SHAPE validator, not cryptographic GitHub Actions or guest attestation.
import {openSync, closeSync, readSync, lstatSync, fstatSync, constants} from "node:fs";
import {createHash} from "node:crypto";
import {dirname, resolve, sep} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");

const sha40=/^[a-f0-9]{40}$/;
const sha64=/^[a-f0-9]{64}$/;
const nonEmpty=x=>typeof x==="string" && x.trim().length>0;
const isObject=x=>x!==null && typeof x==="object" && !Array.isArray(x);

export function verifyOptionResultTrapReceipt(receipt,manifest,fixtureDigest) {
  const errors=[];
  const fail=message=>errors.push(message);
  if(!isObject(manifest) || !["oreslang.option-result-trap.fixtures/v1","oreslang.option-result-trap.modular/v2","oreslang.option-result-trap.scalar/v3","oreslang.option-result-trap.scalar/v4"].includes(manifest.schema))
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
  // V4 receipts have mutually exclusive outcomes; a panic or compile reject
  // must never carry a successful scalar guest return. These are SHAPE checks,
  // not authentication of a GitHub run, compiler output, or diagnostic origin.
  const v4=manifest.schema==="oreslang.option-result-trap.scalar/v4";
  if(v4){
    if(!Number.isSafeInteger(e.workflowRunId)||e.workflowRunId<=0||
       !Number.isSafeInteger(e.jobId)||e.jobId<=0||
       !sha40.test(e.sourceTreeSha||""))
      fail("v4 independent run/job/source-tree lookup coordinates missing");
    if(!nonEmpty(e.compilerStep)||!Array.isArray(e.steps)||
       !e.steps.includes(e.compilerStep))
      fail("v4 actual compiler step reference missing");
    if(e.parserOnly===true||e.unsupportedFeature===true)
      fail("v4 parser-only or unsupported backend cannot claim semantic parity");
    if(c?.kind!=="guest_i64" &&
       ["guestReturnType","guestReturnValue","guestResultSource"].some(k=>Object.hasOwn(e,k)))
      fail("v4 panic/rejection claims a successful scalar guest return");
    if(c?.kind==="guest_i64"){
      if(e.runtimeControl!=="normal"||e.stderr!==""||
         Object.hasOwn(e,"guestPanicCode")||Object.hasOwn(e,"diagnosticCategory"))
        fail("v4 scalar success carries a conflicting failure/control channel");
      if(e.guestStep===e.compilerStep)
        fail("v4 scalar compiler step cannot masquerade as guest execution");
    }else if(c?.kind==="guest_panic"){
      if(e.guestPanicCode!==c.expected_panic_code||
         !/unwrap/i.test(e.stderr||"") ||
         e.guestStep===e.compilerStep)
        fail("v4 panic must identify a Result unwrap and independent guest execution");
    }else if(c?.kind==="compile_reject"){
      if(e.runtimeControl!=="not_launched"||
         e.diagnosticOrigin!=="typechecker"||
         !nonEmpty(e.diagnosticCode)||
         Object.hasOwn(e,"guestPanicCode"))
        fail("v4 rejection must identify compiler type-checker diagnostics before guest launch");
    }
  }
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
  if(e.stdout!==undefined && (typeof e.stdout!=="string"||e.stdout.length>131072))
    fail("invalid or oversized captured stdout");
  if(e.stderr!==undefined && (typeof e.stderr!=="string"||e.stderr.length>131072))
    fail("invalid or oversized captured stderr");
  if(!Number.isSafeInteger(e.compilerExitCode))
    fail("compiler exit code missing");
  if(c?.kind==="guest_stdout") {
    if(e.compilerExitCode!==0||e.guestLaunched!==true||e.guestExitCode!==0)
      fail("successful guest compile and execution required");
    if(e.stdout!==c.expected_stdout)
      fail("guest stdout mismatch; source-only or partial receipts cannot pass");
    if(!nonEmpty(e.guestStep)||!e.steps.includes(e.guestStep)) fail("guest execution step missing or not executed");
  } else if(c?.kind==="guest_panic") {
    if(e.compilerExitCode!==0||e.guestLaunched!==true||
       !Number.isSafeInteger(e.guestExitCode)||e.guestExitCode===0)
      fail("actual nonzero guest panic required");
    if(e.runtimeControl!=="guest_panic"||
       !nonEmpty(e.stderr)||!e.stderr.includes(c.expected_diagnostic_contains))
      fail("guest panic identity/diagnostic not preserved");
    if(typeof e.stdout!=="string"||e.stdout.includes(c.forbidden_stdout))
      fail("forbidden post-panic output observed");
    if(!nonEmpty(e.guestStep)||!e.steps.includes(e.guestStep)) fail("guest panic execution step missing or not executed");
  } else if(c?.kind==="guest_i64") {
    // The result must come from the actual guest entry return, not process
    // status 0 or stdout produced by a host-side reference implementation.
    if(e.compilerExitCode!==0||e.guestLaunched!==true||e.guestExitCode!==0)
      fail("successful compiler-produced scalar guest execution required");
    if(e.guestReturnType!==c.return_type||
       typeof e.guestReturnValue!=="string"||
       e.guestReturnValue!==c.expected_return)
      fail("guest int return missing or differs from the scalar oracle");
    if(!nonEmpty(e.guestStep)||!e.steps.includes(e.guestStep))
      fail("scalar guest execution step missing or not executed");
    if(e.guestResultSource!=="compiler_guest")
      fail("scalar result must originate from compiler-generated guest");
  } else if(c?.kind==="compile_reject") {
    if(e.compilerExitCode!==1||e.guestLaunched!==false||
       e.guestExitCode!==null || e.guestStep!==null)
      fail("type rejection must happen before guest launch");
    if(e.diagnosticCategory!==(c.expected_diagnostic_category||"type")||!nonEmpty(e.stderr))
      fail("typed compiler rejection diagnostic required");
    if(e.stdout!=="") fail("compile rejection must not print guest stdout");
  } else fail("unknown fixture expectation");
  return {ok:errors.length===0,errors};
}


// Source files and the fixture lock are admitted through bounded, identity-checked
// descriptors. This prevents ordinary pathname replacement between lstat/open/read;
// it is NOT a security sandbox against a hostile same-UID actor with open write FDs.
const equalStat=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode&&
  a.nlink===b.nlink&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
export function readPinnedRegular(filename,maxBytes=131072) {
  const before=lstatSync(filename);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
     before.size<=0||before.size>maxBytes)
    throw new Error("nonregular, linked, empty or oversized input");
  // No silent fallback to a pathname race on hosts lacking O_NOFOLLOW.
  if(!Number.isInteger(constants.O_NOFOLLOW))
    throw new Error("atomic no-follow open unavailable on this platform");
  const fd=openSync(filename,constants.O_RDONLY|constants.O_NOFOLLOW|
    (constants.O_NONBLOCK??0));
  try {
    const opened=fstatSync(fd);
    if(!opened.isFile()||!equalStat(before,opened))
      throw new Error("file replaced before descriptor admission");
    const bytes=Buffer.alloc(opened.size+1);
    let total=0;
    while(total<bytes.length) {
      const n=readSync(fd,bytes,total,bytes.length-total,total);
      if(n===0)break;
      total+=n;
    }
    if(total!==opened.size||!equalStat(opened,fstatSync(fd))||
       !equalStat(opened,lstatSync(filename)))
      throw new Error("file mutated during descriptor read");
    return bytes.subarray(0,total);
  }finally{closeSync(fd)}
}
function pinnedPath(rel) {
  if(typeof rel!=="string"||
     !/^fixtures\/option-result-trap\/v[1234]\/(?:negative\/)?[a-z_]+\.ores$/.test(rel))
    throw new Error("untrusted fixture relative path");
  const full=resolve(root,rel);
  if(!full.startsWith(root+sep))throw new Error("fixture escapes checkout");
  // Reject symlinked parent directories; O_NOFOLLOW alone checks only the leaf.
  let parent=dirname(full);
  while(parent!==root) {
    const info=lstatSync(parent);
    if(!info.isDirectory()||info.isSymbolicLink())
      throw new Error("untrusted fixture directory");
    const next=dirname(parent);
    if(next===parent||!parent.startsWith(root+sep))
      throw new Error("fixture parent escaped checkout");
    parent=next;
  }
  return full;
}
const gitBlobSha=bytes=>createHash("sha1")
  .update(Buffer.from("blob "+bytes.length+"\0")).update(bytes).digest("hex");
function readPinnedCase(caseId) {
  const v2=typeof caseId==="string" && caseId.startsWith("ORT2-");
  const v3=typeof caseId==="string" && caseId.startsWith("ORT3-");
  const v4=typeof caseId==="string" && caseId.startsWith("ORT4-");
  const folder=v4?"v4":v3?"v3":v2?"v2":"v1";
  const base=resolve(root,"fixtures/option-result-trap",folder);
  const manifestBytes=readPinnedRegular(resolve(base,"manifest.json"));
  const manifest=JSON.parse(manifestBytes.toString("utf8"));
  const lockPath=resolve(base,v4?"fixture-lock-v4.json":v3?"fixture-lock-v3.json":v2?"fixture-lock-v2.json":"fixture-lock-v1.json");
  const lock=JSON.parse(readPinnedRegular(lockPath).toString("utf8"));
  const expectedManifest=v4?"oreslang.option-result-trap.scalar/v4":v3?"oreslang.option-result-trap.scalar/v3":v2?"oreslang.option-result-trap.modular/v2":
    "oreslang.option-result-trap.fixtures/v1";
  const expectedLock=v4?"oreslang.option-result-trap.scalar-lock/v4":v3?"oreslang.option-result-trap.scalar-lock/v3":v2?"oreslang.option-result-trap.modular-lock/v2":
    "oreslang.option-result-trap.fixture-lock/v1";
  if(!isObject(manifest)||manifest.schema!==expectedManifest||
     manifest.status!=="authored_not_executed"||
     !Array.isArray(manifest.backends)||
     manifest.backends.join(",")!==(v4?"java,llvm,wasm,cranelift,net,forge,js,rust,hdl":"java,llvm,wasm,cranelift,net")||
     !Array.isArray(manifest.cases)||!isObject(lock)||
     lock.schema!==expectedLock||
     gitBlobSha(manifestBytes)!==lock.manifest_blob||
     !Array.isArray(lock.cases)||lock.cases.length!==manifest.cases.length)
    throw new Error("fixture manifest/lock not pinned");
  const seenIds=new Set(),seenPaths=new Set();
  for(const c of manifest.cases) {
    if(!isObject(c)||!nonEmpty(c.id)||!nonEmpty(c.path)||
       seenIds.has(c.id)||seenPaths.has(c.path))
      throw new Error("fixture manifest duplicate/invalid entry");
    seenIds.add(c.id);seenPaths.add(c.path);
  }
  const seenPins=new Set();
  for(const pin of lock.cases) {
    if(!isObject(pin)||!nonEmpty(pin.id)||seenPins.has(pin.id)||
       !sha40.test(pin.git_blob||""))
      throw new Error("duplicate/invalid fixture lock pin");
    seenPins.add(pin.id);
    const c=manifest.cases.find(x=>x.id===pin.id);
    if(!c||pin.path!==c.path)throw new Error("fixture lock case mismatch");
    pinnedPath(pin.path);
  }
  return {manifest,lock};
}
export function verifyReceiptFile(filename) {
  const receipt=JSON.parse(readPinnedRegular(filename,262144).toString("utf8"));
  const {manifest,lock}=readPinnedCase(receipt?.caseId);
  const c=manifest.cases.find(x=>x.id===receipt?.caseId);
  if(!c)throw new Error("unknown case ID");
  const bytes=readPinnedRegular(pinnedPath(c.path));
  const pin=lock.cases.find(x=>x.id===c.id);
  if(!pin||gitBlobSha(bytes)!==pin.git_blob)
    throw new Error("fixture contents do not match reviewed blob lock");
  const digest=createHash("sha256").update(bytes).digest("hex");
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
