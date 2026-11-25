#!/usr/bin/env node
/**
 * Build a read-only proposal for ONE private-CI canary authorization.
 *
 * This tool never writes source or policy. It is intended to produce the exact
 * destination/snapshot lines that a human must add later through a protected,
 * CODEOWNERS-reviewed PR after protected-main bootstrap has passed.
 */
import {pathToFileURL} from "node:url";
import {SOURCE_REPOSITORIES} from "./audit-private-ci-bootstrap.mjs";

const FULL_NAME=/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const OID=/^[0-9a-f]{40}$/;

function deny(message){throw Error("PRIVATE_CI_CANARY_DENIED: "+message);}
async function get(url,token,fetchImpl){
  let response;
  try{
    response=await fetchImpl(url,{
      method:"GET",redirect:"error",
      headers:{
        "Accept":"application/vnd.github+json",
        "Authorization":"Bearer "+token,
        "X-GitHub-Api-Version":"2022-11-28"
      },
      signal:AbortSignal.timeout(5000)
    });
  }catch{deny("GitHub lookup failed");}
  if(!response || response.status!==200) deny("GitHub metadata unavailable");
  try{return await response.json();}catch{deny("GitHub metadata undecodable");}
}

export async function proposeCanary({source,destination,sourceCommit,token,fetchImpl=fetch}){
  if(!SOURCE_REPOSITORIES.includes(source)) deny("source repository is not an Oreslang compiler backend");
  if(typeof destination!=="string" || !FULL_NAME.test(destination) || destination.length>220) deny("invalid destination repository");
  if(typeof sourceCommit!=="string" || !OID.test(sourceCommit)) deny("exact source commit required");
  if(typeof token!=="string" || !token.trim()) deny("authenticated GitHub token required");
  if(typeof fetchImpl!=="function") deny("GitHub fetch implementation unavailable");

  const sourceRepo=await get("https://api.github.com/repos/"+source,token,fetchImpl);
  if(sourceRepo?.full_name!==source || sourceRepo?.private!==true ||
     sourceRepo?.visibility!=="private" || sourceRepo?.archived===true ||
     sourceRepo?.disabled!==false || !Number.isSafeInteger(sourceRepo?.id) ||
     sourceRepo.id<=0){
    deny("source repository identity/privacy is not securely established");
  }

  const dest=await get("https://api.github.com/repos/"+destination,token,fetchImpl);
  if(dest?.full_name!==destination || dest?.private!==true ||
     dest?.visibility!=="private" || dest?.archived===true ||
     dest?.disabled!==false || !Number.isSafeInteger(dest?.id) || dest.id<=0 ||
     dest?.permissions?.push!==true){
    deny("destination must be a writable verified private repository");
  }
  if(dest.id===sourceRepo.id) deny("destination must be a distinct repository");

  const commit=await get("https://api.github.com/repos/"+source+"/git/commits/"+sourceCommit,token,fetchImpl);
  const sourceTree=commit?.tree?.sha;
  if(commit?.sha!==sourceCommit || typeof sourceTree!=="string" || !OID.test(sourceTree)){
    deny("source commit/root-tree identity mismatch");
  }

  // Confirm commit is still reachable from the source repository's main ref.
  // This is not approval; it only prevents proposing an arbitrary detached SHA.
  const compare=await get("https://api.github.com/repos/"+source+
    "/compare/"+sourceCommit+"...main",token,fetchImpl);
  if(!["identical","ahead"].includes(compare?.status)){
    deny("source commit is not an ancestor of source main");
  }

  return Object.freeze({
    status:"PRIVATE_CI_CANARY_PROPOSAL_ONLY",
    source,
    sourceRepositoryId:sourceRepo.id,
    sourceCommit,
    sourceTree,
    destination,
    destinationId:dest.id,
    policyLines:Object.freeze({
      destination:destination+" "+dest.id,
      snapshot:sourceCommit+" "+sourceTree+" "+dest.id,
      carrierSnapshot:sourceCommit+" "+sourceTree+" "+dest.id
    }),
    reviewProtocol:Object.freeze({
      sourceReviewerPolicy:".github/private-ci-independent-reviewer.json",
      carrierReviewerPolicy:".github/private-ci-independent-reviewer.json",
      sourceAuthorizationPaths:Object.freeze([
        ".github/private-ci-approved-repositories.txt",
        ".github/private-ci-approved-source-snapshots.txt",
        ".github/private-ci-independent-reviewer.json"
      ]),
      carrierAuthorizationPaths:Object.freeze([
        ".github/private-ci-approved-source-snapshots.txt",
        ".github/private-ci-independent-reviewer.json"
      ]),
      requirements:Object.freeze([
        "activate the same non-operator reviewer identity on source and carrier",
        "change each side's authorization paths together in one commit",
        "obtain that reviewer\'s APPROVED review on the exact final PR head for both source and carrier",
        "reviewer must retain configured write-or-better permission in both repositories",
        "keep exactly one active canary and preserve pinned policy workflow blobs"
      ])
    }),
    warning:"Proposal only: after bootstrap passes, apply source and carrier lines in separate protected CODEOWNERS-reviewed PRs and obtain exact-head approval from the same configured independent reviewer."
  });
}

if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url){
  try{
    if(process.argv.length!==5){
      deny("usage: propose-private-ci-canary.mjs <source-owner/repo> <private-destination-owner/repo> <source-commit>");
    }
    const result=await proposeCanary({
      source:process.argv[2],
      destination:process.argv[3],
      sourceCommit:process.argv[4],
      token:process.env.GH_TOKEN||process.env.GITHUB_TOKEN
    });
    console.log(JSON.stringify(result,null,2));
  }catch(e){
    console.error(e?.message?.startsWith("PRIVATE_CI_CANARY_DENIED:")?e.message:
      "PRIVATE_CI_CANARY_DENIED: unexpected proposal failure");
    process.exitCode=1;
  }
}
