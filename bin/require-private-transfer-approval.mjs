#!/usr/bin/env node
/**
 * An allowlisted repository name and private visibility are not transfer
 * authorization. Require a GitHub-hosted, independently reviewed EXACT
 * snapshot record and both incident clearances before reading source blobs.
 * This repository intentionally has no active approval record today.
 */
const POLICY_REPO="ores-truffle-oreslang/oreslang-platform-conformance";
const POLICY_PATH="security/private-ci-source-export-approvals.v1.json";
const SHA=/^[0-9a-f]{40}$/;
const REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const fixed=(obj,keys)=>obj!==null&&typeof obj==="object"&&!Array.isArray(obj)&&
  Object.keys(obj).sort().join("|")===keys.slice().sort().join("|");
function deny(){throw Error("SOURCE_EXPORT_NOT_INDEPENDENTLY_AUTHORIZED")}
async function get(full,path,token,fetchImpl) {
  try {
    const response=await fetchImpl("https://api.github.com/repos/"+full+path,{
      method:"GET",redirect:"error",
      headers:{"Accept":"application/vnd.github+json",
        "X-GitHub-Api-Version":"2022-11-28","Authorization":"Bearer "+token},
      signal:AbortSignal.timeout(10000)
    });
    if(response?.status!==200)deny();
    return await response.json();
  }catch{deny()}
}
export function validateSourceExportApproval({approval,source,destination,sourceCommit,
  sourceTree,destinationId,nowMs=Date.now()}) {
  if(!Number.isSafeInteger(nowMs)||nowMs<0||
    typeof source!=="string"||!REPO.test(source)||
    typeof destination!=="string"||!REPO.test(destination)||
    typeof sourceCommit!=="string"||!SHA.test(sourceCommit)||
    typeof sourceTree!=="string"||!SHA.test(sourceTree)||
    !Number.isSafeInteger(destinationId)||destinationId<=0)deny();
  if(!fixed(approval,["schema","source","destination","sourceCommit",
    "sourceTree","destinationId","requestedBy","approvedBy",
    "incident22Approval","incident77Approval","createdAtMs","expiresAtMs",
    "maxArtifactRetentionDays","status"]))deny();
  if(approval.schema!=="ores.private-ci.source-export/v1"||
    approval.status!=="APPROVED_FOR_EXACT_SOURCE_ONLY"||
    approval.source!==source||approval.destination!==destination||
    approval.sourceCommit!==sourceCommit||approval.sourceTree!==sourceTree||
    approval.destinationId!==destinationId||
    approval.maxArtifactRetentionDays!==1||
    !Number.isSafeInteger(approval.createdAtMs)||
    !Number.isSafeInteger(approval.expiresAtMs)||
    approval.createdAtMs>nowMs||approval.expiresAtMs<nowMs||
    approval.expiresAtMs<=approval.createdAtMs||
    approval.expiresAtMs-approval.createdAtMs>86400000)deny();
  if(typeof approval.requestedBy!=="string"||!approval.requestedBy||
    !Array.isArray(approval.approvedBy)||approval.approvedBy.length!==2||
    approval.approvedBy.some(x=>typeof x!=="string"||!/^[A-Za-z0-9-]{1,39}$/.test(x))||
    approval.approvedBy[0]===approval.approvedBy[1]||
    approval.approvedBy.includes(approval.requestedBy))deny();
  for(const key of ["incident22Approval","incident77Approval"]){
    const x=approval[key];
    if(!fixed(x,["incident","status","reviewer"])||
      x.incident!==(key==="incident22Approval"?22:77)||
      x.status!=="INDEPENDENTLY_CLEARED"||
      !approval.approvedBy.includes(x.reviewer))deny();
  }
  if(approval.incident22Approval.reviewer===approval.incident77Approval.reviewer)deny();
  return Object.freeze({status:"EXACT_SOURCE_APPROVAL_STRUCTURE_OK",destinationId});
}

export async function requireIndependentSourceExportApproval({
  source,destination,sourceCommit,sourceTree,token,fetchImpl=fetch
}) {
  if(typeof token!=="string"||!token.trim()||
    typeof fetchImpl!=="function"||
    typeof source!=="string"||!REPO.test(source)||
    typeof destination!=="string"||!REPO.test(destination)||
    typeof sourceCommit!=="string"||!SHA.test(sourceCommit)||
    typeof sourceTree!=="string"||!SHA.test(sourceTree))deny();
  // The policy branch must be protected, with two independent approvals,
  // CODEOWNERS, stale-review dismissal and no administrator bypass.
  const branch=await get(POLICY_REPO,"/branches/main",token,fetchImpl);
  if(branch?.name!=="main"||branch.protected!==true)deny();
  const protection=await get(POLICY_REPO,"/branches/main/protection",token,fetchImpl);
  if(protection?.required_pull_request_reviews?.required_approving_review_count<2||
    protection.required_pull_request_reviews.dismiss_stale_reviews!==true||
    protection.required_pull_request_reviews.require_code_owner_reviews!==true||
    protection.enforce_admins?.enabled!==true)deny();
  // Both historical export incidents must be resolved by their owners.
  for(const number of [22,77]){
    const incident=await get(POLICY_REPO,"/issues/"+number,token,fetchImpl);
    if(incident?.number!==number||incident.state!=="closed"||incident.pull_request)deny();
  }
  const dest=await get(destination,"",token,fetchImpl);
  if(dest?.full_name!==destination||dest.private!==true||
    dest.visibility!=="private"||dest.archived===true||
    dest.permissions?.push!==true||
    !Number.isSafeInteger(dest.id)||dest.id<=0)deny();
  // Ledger is read from protected canonical MAIN, never a user-selected ref
  // or an injected caller-supplied JSON object.
  const file=await get(POLICY_REPO,
    "/contents/"+POLICY_PATH+"?ref=main",token,fetchImpl);
  if(file?.path!==POLICY_PATH||file.encoding!=="base64"||
    typeof file.content!=="string"||file.content.length>32768)deny();
  let ledger;
  try {
    const content=Buffer.from(file.content.replace(/\s/g,""),"base64").toString("utf8");
    ledger=JSON.parse(content);
    // Canonical bytes rule rejects duplicate JSON keys and arbitrary rewriting.
    if(content!==JSON.stringify(ledger)+"\n")deny();
  }catch{deny()}
  if(!fixed(ledger,["schema","approvals"])||
    ledger.schema!=="ores.private-ci.source-export-ledger/v1"||
    !Array.isArray(ledger.approvals)||ledger.approvals.length!==1)deny();
  validateSourceExportApproval({
    approval:ledger.approvals[0],source,destination,sourceCommit,
    sourceTree,destinationId:dest.id
  });
  return Object.freeze({status:"INDEPENDENT_EXACT_SOURCE_TRANSFER_REVIEWED",
    destinationId:dest.id,sourceCommit,sourceTree});
}
