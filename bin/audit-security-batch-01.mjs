#!/usr/bin/env node
/**
 * SOURCE-FREE, READ-ONLY diagnostics for Oreslang security work items 1-10.
 *
 * This deliberately cannot authorize source publication or close incidents.
 * Only GitHub repository, branch, issue, policy-file, and Actions-job metadata
 * is queried. Never download compiler blobs, create Git objects or rerun jobs.
 */
import {pathToFileURL} from "node:url";

export const SOURCE_REPOS=Object.freeze([
  ["ores-truffle-oreslang/oreslang-source.java",1400792274],
  ["ores-truffle-oreslang/oreslang-source.llvm",1410897874],
  ["ores-truffle-oreslang/oreslang-source.net",1419704375],
  ["ores-truffle-oreslang/oreslang-source.wasm",1419858954],
  ["ores-truffle-oreslang/oreslang-source.forge",1419703674],
  ["ores-truffle-oreslang/oreslang-serialization-and-validation",1406070609]
]);
export const CARRIERS=Object.freeze([
  ["zed-pkg-test/java-app",1323575966],
  ["scintilla-run-test/gleam-runner-conformance",1323598260],
  ["sagitta-stack/sagitta-infra",1357615104]
]);
export const SAMPLE_RUNS=Object.freeze([
  // Immutable commit IDs observed through the authenticated run metadata.
  ["ores-truffle-oreslang/oreslang-source.java",39192171654,"0f9012b4bfd6efbf9e35da3873a23f6a104f8467"],
  ["ores-truffle-oreslang/oreslang-source.llvm",39192071724,"d2d335689336f53f9ed8858dc8103a2753959838"],
  ["ores-truffle-oreslang/oreslang-serialization-and-validation",39171413088,"979e60642df99908f9aa44502fb17ae66c4072b1"]
]);
const ISSUE_REPO="ores-truffle-oreslang/oreslang-platform-conformance";
const OID=/^[0-9a-f]{40}$/;
const DATA_FILES=[
  "private-ci-approved-repositories.txt",
  "private-ci-approved-source-snapshots.txt"
];

/* Never surface HTTP response content or transport exceptions: either could
 * accidentally contain an access token. 404 and 403 are unknown, not proof
 * that the policy is disabled or that a GitHub Actions quota is exhausted.
 */
async function readMetadata(path,token,fetchImpl) {
  let result;
  try {
    result=await fetchImpl("https://api.github.com/repos/"+path,{
      method:"GET", redirect:"error",
      headers:{
        "Accept":"application/vnd.github+json",
        "Authorization":"Bearer "+token,
        "X-GitHub-Api-Version":"2022-11-28"
      },
      signal:AbortSignal.timeout(8000)
    });
  } catch { return {ok:false,reason:"TRANSPORT_UNAVAILABLE"}; }
  if(!result || result.status!==200)
    return {ok:false,reason:result?.status===403?"PERMISSION_UNAVAILABLE":
      result?.status===404?"NOT_FOUND":"HTTP_UNAVAILABLE"};
  try {return {ok:true,value:await result.json()};}
  catch {return {ok:false,reason:"INVALID_JSON"};}
}

export function classifyWorkflowJob(job) {
  if(!job || typeof job!=="object" || !["queued","waiting","pending","in_progress","completed"].includes(job.status))
    return "UNOBSERVED";
  if(job.status!=="completed") return "NOT_TERMINAL";
  if(!Array.isArray(job.steps)) return "UNOBSERVED";
  if(job.steps.length===0) return "NO_RECORDED_STEPS";
  // A step's name alone never proves execution, and even executed setup
  // steps are not compiler/test evidence.
  const count=job.steps.filter(step=>step &&
    step.status==="completed" && step.conclusion!=="skipped" &&
    typeof step.started_at==="string" && step.started_at.length>0 &&
    typeof step.completed_at==="string" && step.completed_at.length>0).length;
  return count>0?"TIMESTAMPED_STEPS_REPORTED":"NO_TIMESTAMPED_STEPS";
}

/**
 * Bind job metadata to the sampled immutable head and numeric repository ID
 * before analyzing any jobs. This is an evidence-integrity check, NOT an
 * authorization or CI-success assertion. Missing fields always mean unknown.
 */
export function classifyPinnedRun(run,name,id,expectedHead) {
  const identity=SOURCE_REPOS.find(([repo])=>repo===name);
  if(!identity || !run || typeof run!=="object" ||
     !Number.isSafeInteger(id) || run.id!==id ||
     run.repository?.id!==identity[1] ||
     run.repository?.full_name!==name ||
     (run.head_repository!=null &&
       (run.head_repository.id!==identity[1] ||
        run.head_repository.full_name!==name)) ||
     !OID.test(expectedHead) || run.head_sha!==expectedHead ||
     !Number.isSafeInteger(run.run_attempt) || run.run_attempt<1)
    return "MISMATCHED_OR_UNVERIFIABLE";
  return run.status==="completed"?"EXACT_HEAD_RUN_METADATA":
    "NOT_TERMINAL";
}

export function policyLines(file) {
  if(!file || file.type!=="file" || file.encoding!=="base64" ||
      typeof file.content!=="string" || file.content.length>131072)
    return "UNVERIFIABLE";
  const b64=file.content.replace(/[\r\n]/g,"");
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64))
    return "UNVERIFIABLE";
  const bytes=Buffer.from(b64,"base64");
  if(bytes.toString("base64")!==b64 || bytes.length>65536 || bytes.includes(0))
    return "UNVERIFIABLE";
  const text=bytes.toString("utf8");
  if(!Buffer.from(text,"utf8").equals(bytes)) return "UNVERIFIABLE";
  const active=text.split(/\r?\n/).filter(line=>line.trim()&&!line.trim().startsWith("#"));
  return active.length===0?"NO_ACTIVE_ENTRIES":"NONEMPTY_REQUIRES_INDEPENDENT_REVIEW";
}

async function repositoryRecord(name,id,token,fetchImpl,source) {
  const meta=await readMetadata(name,token,fetchImpl);
  if(!meta.ok) return {repo:name,identity:"UNVERIFIABLE",branch:"UNVERIFIABLE",
    protection:"UNVERIFIABLE",policies:{},reason:meta.reason};
  const r=meta.value;
  const identity=r?.id===id && r?.full_name===name && r?.private===true &&
    r?.visibility==="private" && r?.archived===false && r?.disabled===false
    ?"PRIVATE_ID_VERIFIED":"IDENTITY_OR_VISIBILITY_MISMATCH";
  const branch=await readMetadata(name+"/branches/main",token,fetchImpl);
  const b=branch.ok?branch.value:null;
  const branchStatus=!branch.ok?"UNVERIFIABLE":
    b?.name!=="main" || !OID.test(b?.commit?.sha||"")?"INVALID_BRANCH":
    b.protected===false?"UNPROTECTED":
    b.protected===true?"PROTECTED_FLAG_ONLY":"UNVERIFIABLE";
  // Branch 'protected=true' is NOT equivalent to independently verified
  // CODEOWNER enforcement; lack of Administration:read must remain unknown.
  const protection=b?.protected===true?
    await readMetadata(name+"/branches/main/protection",token,fetchImpl):null;
  const protectionStatus=protection===null?"NOT_READ":
    protection.ok?"READABLE_REQUIRES_INDEPENDENT_POLICY_AUDIT":"UNVERIFIABLE";
  const policies={};
  if(source) {
    for(const file of DATA_FILES) {
      const entry=await readMetadata(name+"/contents/.github/"+file+
        "?ref="+encodeURIComponent(b?.commit?.sha||"main"),token,fetchImpl);
      policies[file]=entry.ok?policyLines(entry.value):"UNVERIFIABLE_"+entry.reason;
    }
  }
  return {repo:name,identity,branch:branchStatus,
    mainSha:OID.test(b?.commit?.sha||"")?b.commit.sha:null,
    protection:protectionStatus,policies};
}

export async function auditSecurityBatch({token,fetchImpl=fetch}={}) {
  if(typeof token!=="string" || token.trim().length===0 ||
     typeof fetchImpl!=="function") throw Error("authenticated read-only GitHub access required");
  const sources=[];
  const carriers=[];
  // Deliberately sequential, bounded API calls and no pagination claims.
  for(const [name,id] of SOURCE_REPOS)
    sources.push(await repositoryRecord(name,id,token,fetchImpl,true));
  for(const [name,id] of CARRIERS)
    carriers.push(await repositoryRecord(name,id,token,fetchImpl,false));
  const incidents=[];
  for(const number of [22,77]) {
    const response=await readMetadata(ISSUE_REPO+"/issues/"+number,token,fetchImpl);
    const issue=response.ok?response.value:null;
    incidents.push({number,state:issue?.number===number &&
      ["open","closed"].includes(issue?.state)?issue.state:"UNVERIFIABLE",
      // Closed is still not an independent incident-closure attestation.
      independentlyAccepted:false});
  }
  const runs=[];
  for(const [name,id,expectedHead] of SAMPLE_RUNS) {
    const metadata=await readMetadata(name+"/actions/runs/"+id,token,fetchImpl);
    const runEvidence=classifyPinnedRun(
      metadata.ok?metadata.value:null,name,id,expectedHead);
    // Never analyze possibly unrelated job records as evidence for an exact
    // source head. A missing run/attempt/repository binding fails closed.
    if(runEvidence!=="EXACT_HEAD_RUN_METADATA") {
      runs.push({repo:name,runId:id,expectedHead,runEvidence,
        coverage:"INCOMPLETE_OR_UNOBSERVED",jobEvidence:["UNOBSERVED"]});
      continue;
    }
    const response=await readMetadata(name+"/actions/runs/"+id+"/jobs?per_page=100",
      token,fetchImpl);
    const payload=response.ok?response.value:null;
    const jobs=Array.isArray(payload?.jobs)?payload.jobs:null;
    const complete=jobs!==null && jobs.length<=100 &&
      Number.isSafeInteger(payload.total_count) &&
      payload.total_count===jobs.length &&
      jobs.every(job=>job && Number.isSafeInteger(job.id) &&
        job.run_id===id);
    runs.push({repo:name,runId:id,expectedHead,runEvidence,
      coverage:complete?"FIRST_PAGE_COMPLETE":"INCOMPLETE_OR_UNOBSERVED",
      jobEvidence:complete?jobs.map(classifyWorkflowJob):["UNOBSERVED"]});
  }
  // A read-only diagnostic NEVER grants source-export authority.
  return {
    schema:1,kind:"SOURCE_FREE_NON_CERTIFYING_SECURITY_DIAGNOSTIC",
    privateSourceExport:"DENIED",incidentClosure:"NOT_ATTESTED",
    ciCompilerTests:"NOT_ATTESTED",billingCause:"UNKNOWN",
    items:[1,2,3,4,5,6,7,8,9,10].map(id=>({id,state:"OPEN_OR_ADMIN_REVIEW_REQUIRED"})),
    sources,carriers,incidents,runs
  };
}

if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url) {
  try {
    const report=await auditSecurityBatch({
      token:process.env.GH_TOKEN||process.env.GITHUB_TOKEN
    });
    console.log(JSON.stringify(report,null,2));
  } catch {
    console.error("SECURITY_BATCH_DIAGNOSTIC_UNAVAILABLE: no admission or export authorization");
  }
  // This program is a DENY gate, never a green CI pass.
  process.exitCode=2;
}
