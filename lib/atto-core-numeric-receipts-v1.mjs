import {createHash} from "node:crypto";
import {classifyAttoRun} from "./atto-library-run-evidence-v1.mjs";

// Offline verification of exact source and artifact bytes. Never certify
// source execution merely because hashes in a JSON receipt look plausible.
const requireTrue=(ok,reason)=>{if(!ok)throw new Error(reason);};
const hex=(v,n)=>typeof v==="string"&&new RegExp("^[0-9a-f]{"+n+"}$").test(v);
function blob(name,value) {
 requireTrue(Buffer.isBuffer(value)||value instanceof Uint8Array,"Missing byte artifact: "+name);
 requireTrue(value.byteLength>0&&value.byteLength<=256*1024*1024,"Invalid artifact byte limit: "+name);
 return Buffer.from(value.buffer,value.byteOffset,value.byteLength);
}
const sha256=data=>createHash("sha256").update(data).digest("hex");
const gitBlob=data=>createHash("sha1")
 .update(Buffer.from("blob "+data.length+"\0")).update(data).digest("hex");
const entryPath=label=>"0/atto-core-numeric-"+(label==="base"?"main":"mutated")+".atto";
function graphHash(label,numeric,entry) {
 const units=[[entryPath(label),sha256(entry)],["@atto.core/numeric.atto",sha256(numeric)]];
 units.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
 return sha256(Buffer.from(units.map(unit=>unit[0]+"\0"+unit[1]+"\n").join(""),"utf8"));
}
export function verifyAttoNumericArtifactBundleV1({expected,receipts,artifacts}) {
 requireTrue(expected&&receipts&&artifacts,"Expected identities, two receipts and actual bytes required");
 requireTrue(hex(expected.head,40)&&hex(expected.tree,40),"Exact source HEAD and tree required");
 requireTrue(expected.rid==="linux-x64"||expected.rid==="win-x64","Unsupported NativeAOT RID");
 requireTrue(Number.isSafeInteger(expected.runId)&&expected.runId>0&&
   Number.isSafeInteger(expected.runAttempt)&&expected.runAttempt>0,"Run/attempt identity missing");
 requireTrue(expected.sourceBlobs&&["numeric","base","mutated"].every(
   key=>hex(expected.sourceBlobs[key],40)),"Trusted source Git blobs required");
 const source=blob("canonical numeric.atto",artifacts.numeric);
 const compiler=blob("native compiler executable",artifacts.compiler);
 requireTrue(gitBlob(source)===expected.sourceBlobs.numeric,"Compiler-owned source Git blob mismatch");
 const compilerHash=sha256(compiler);
 const expectedOs=expected.rid==="linux-x64"?"ubuntu-24.04":"windows-2022";
 const digests={};
 for(const label of ["base","mutated"]){
  const receipt=receipts[label],item=artifacts[label];
  requireTrue(receipt&&item,"Missing "+label+" receipt or bytes");
  const entry=blob(label+" entry",item.entry);
  const cil=blob(label+" CIL",item.cil);
  const native=blob(label+" native",item.native);
  requireTrue(gitBlob(entry)===expected.sourceBlobs[label],label+" entry Git blob mismatch");
  requireTrue(receipt.scope==="atto.core/numeric-stage2-not-five-backend-parity"&&
   receipt.label===label,label+" scope/label mismatch");
  requireTrue(receipt.run_id===expected.runId&&receipt.run_attempt===expected.runAttempt,
   label+" run/attempt mismatch");
  requireTrue(receipt.source_head===expected.head&&receipt.source_tree===expected.tree,
   label+" source head/tree mismatch");
  requireTrue(receipt.workflow_path===".github/workflows/source-modules-native-aot.yml"&&
   receipt.workflow_job==="native-source-modules",label+" workflow path/job mismatch");
  requireTrue(receipt.rid===expected.rid&&receipt.runner_os===expectedOs,
   label+" target runner/RID mismatch");
  requireTrue(receipt.canonical_library_git_blob===expected.sourceBlobs.numeric&&
   receipt.entry_git_blob===expected.sourceBlobs[label],label+" source Git blob receipt mismatch");
  requireTrue(receipt.compiler_binary_sha256===compilerHash,label+" compiler binary SHA mismatch");
  requireTrue(receipt.graph_sha256===graphHash(label,source,entry),label+" graph digest mismatch");
  requireTrue(receipt.cil_sha256===sha256(cil),label+" CIL artifact SHA mismatch");
  requireTrue(receipt.native_binary_sha256===sha256(native),label+" native artifact SHA mismatch");
  requireTrue(receipt.result===(label==="base"?"42":"43"),label+" mutation output mismatch");
  digests[label]={graph:receipt.graph_sha256,cil:receipt.cil_sha256,native:receipt.native_binary_sha256};
 }
 requireTrue(expected.sourceBlobs.base!==expected.sourceBlobs.mutated,"Mutation source is unchanged");
 for(const field of ["graph","cil","native"])
  requireTrue(digests.base[field]!==digests.mutated[field],"Mutation did not change "+field);
 return {classification:"ARTIFACT_BYTES_VERIFIED_EXECUTION_UNPROVEN",
  reason:"Requires independent GitHub executed-step and reviewer verification",
  compilerSha256:compilerHash,artifacts:digests};
}
export function qualifyAttoNumericRunV1({expected,receipts,artifacts,run,jobs}) {
 requireTrue(expected&&run&&Array.isArray(jobs),"Independent GitHub run and jobs required");
 const job=expected.rid==="linux-x64"
  ?"native-source-modules (ubuntu-24.04, linux-x64)"
  :"native-source-modules (windows-2022, win-x64, .exe)";
 const admission=classifyAttoRun({run,jobs,expectedHead:expected.head,expectedJob:job,
  expectedWorkflowPath:".github/workflows/source-modules-native-aot.yml",
  requiredSteps:["Existing compiler and module-linking regressions",
    "Build and execute canonical numeric.atto NativeAOT 42-to-43 mutation"]});
 if(admission.classification!=="EXECUTED_STEPS_UNVERIFIED")
  return {classification:"NOT_QUALIFIED",reason:admission.classification,
   executedSteps:admission.executedSteps};
 requireTrue(run.id===expected.runId&&run.run_attempt===expected.runAttempt,
   "Run identity not bound to expected attempt");
 const verified=verifyAttoNumericArtifactBundleV1({expected,receipts,artifacts});
 return {classification:"RECEIPTS_VERIFIED_PENDING_INDEPENDENT_REVIEW",
  executedSteps:admission.executedSteps,compilerSha256:verified.compilerSha256,
  artifacts:verified.artifacts};
}
