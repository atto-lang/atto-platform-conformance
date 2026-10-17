#!/usr/bin/env node
/**
 * Read-only protected-main bootstrap auditor for private CI source export.
 *
 * This tool never copies source, writes refs, or changes repository settings.
 * It requires a token that can read branch-protection metadata. During the
 * bootstrap phase it also requires destination and snapshot approval files to
 * remain empty, so policy can be merged before any export authorization exists.
 */
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";

export const SOURCE_REPOSITORIES = Object.freeze([
  "ores-truffle-oreslang/oreslang-source.java",
  "ores-truffle-oreslang/oreslang-source.llvm",
  "ores-truffle-oreslang/oreslang-source.net",
  "ores-truffle-oreslang/oreslang-source.wasm",
  "ores-truffle-oreslang/oreslang-source.forge"
]);
const OID=/^[0-9a-f]{40}$/;
const EXPECTED_OWNER="@ORESoftware";
const EXPECTED_CHECK=Object.freeze({context:"private-ci-policy",appId:15368});
const SECURITY_PATHS=Object.freeze([
  "/.github/CODEOWNERS",
  "/.github/private-ci-approved-repositories.txt",
  "/.github/private-ci-approved-source-snapshots.txt",
  "/.github/private-ci-required-checks.json",
  "/.github/workflows/private-ci-policy.yml"
]);

function error(message){ throw Error("PRIVATE_CI_BOOTSTRAP_DENIED: "+message); }
async function getJson(url,token,fetchImpl){
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
  }catch{ error("GitHub policy lookup failed"); }
  if(!response || response.status!==200) error("GitHub policy metadata unavailable");
  try{return await response.json();}catch{error("GitHub policy metadata is not decodable");}
}
function decodePolicy(file,label){
  if(!file || file.type!=="file" || file.encoding!=="base64" ||
     typeof file.content!=="string" || file.content.length>131072 ||
     typeof file.sha!=="string" || !OID.test(file.sha) ||
     !/^[A-Za-z0-9+/=\r\n]+$/.test(file.content)){
    error(label+" file metadata invalid");
  }
  const clean=file.content.replace(/[\r\n]/g,"");
  let raw;
  try{raw=Buffer.from(clean,"base64");}catch{error(label+" base64 invalid");}
  if(raw.length>65536 || raw.toString("base64")!==clean) error(label+" base64 noncanonical");
  const digest=createHash("sha1").update("blob "+raw.length+"\0").update(raw).digest("hex");
  if(digest!==file.sha) error(label+" blob digest mismatch");
  const text=raw.toString("utf8");
  if(!Buffer.from(text,"utf8").equals(raw)) error(label+" UTF-8 invalid");
  return text;
}
function dataLines(text){
  return text.split("\n").map(x=>x.trim()).filter(x=>x && !x.startsWith("#"));
}
export function auditCodeowners(text){
  const lines=dataLines(text);
  if(lines.length<SECURITY_PATHS.length) error("security CODEOWNERS final block missing");
  const expected=SECURITY_PATHS.map(path=>path+" "+EXPECTED_OWNER);
  const actual=lines.slice(-expected.length);
  if(actual.length!==expected.length || actual.some((x,i)=>x!==expected[i])){
    error("security CODEOWNERS final block mismatch");
  }
}
export function auditRequiredChecks(text,protection){
  let policy;
  try{policy=JSON.parse(text);}catch{error("required-check policy is not valid JSON");}
  if(!policy || Object.getPrototypeOf(policy)!==Object.prototype ||
     Object.keys(policy).length!==2 || policy.schema!==1 ||
     !Array.isArray(policy.checks) || policy.checks.length!==1){
    error("required-check policy schema mismatch");
  }
  const one=policy.checks[0];
  if(!one || Object.getPrototypeOf(one)!==Object.prototype ||
     Object.keys(one).length!==2 || one.context!==EXPECTED_CHECK.context ||
     one.appId!==EXPECTED_CHECK.appId){
    error("required-check policy identity mismatch");
  }
  const checks=protection?.required_status_checks;
  if(checks?.strict!==true || !Array.isArray(checks.checks) ||
     (Array.isArray(checks.contexts) && checks.contexts.length!==0)){
    error("strict app-bound required checks missing");
  }
  const seen=new Set();
  let required=false;
  for(const item of checks.checks){
    if(!item || typeof item.context!=="string" ||
       !Number.isSafeInteger(item.app_id) || item.app_id<=0 ||
       seen.has(item.context)){
      error("required check identity invalid");
    }
    seen.add(item.context);
    if(item.context===EXPECTED_CHECK.context && item.app_id===EXPECTED_CHECK.appId) required=true;
  }
  if(!required) error("private-ci-policy check/app binding missing");
}
export function auditProtection(protection){
  const review=protection?.required_pull_request_reviews;
  if(review?.require_code_owner_reviews!==true ||
     review.dismiss_stale_reviews!==true ||
     !Number.isSafeInteger(review.required_approving_review_count) ||
     review.required_approving_review_count<1 ||
     protection?.enforce_admins?.enabled!==true ||
     !review?.bypass_pull_request_allowances ||
     (review.bypass_pull_request_allowances.users?.length??0)!==0 ||
     (review.bypass_pull_request_allowances.teams?.length??0)!==0 ||
     (review.bypass_pull_request_allowances.apps?.length??0)!==0){
    error("review/admin/no-bypass protection mismatch");
  }
}
function auditEmptyApprovals(destinationText,snapshotText){
  if(dataLines(destinationText).length!==0) error("destination approval must remain empty during bootstrap");
  if(dataLines(snapshotText).length!==0) error("snapshot approval must remain empty during bootstrap");
}
export async function auditRepository(repo,{token,fetchImpl=fetch}={}){
  if(typeof token!=="string" || !token.trim()) error("authenticated GitHub token required");
  if(typeof fetchImpl!=="function") error("GitHub fetch implementation unavailable");
  const base="https://api.github.com/repos/"+repo;
  const branch=await getJson(base+"/branches/main",token,fetchImpl);
  const protectedSha=branch?.commit?.sha;
  if(branch?.name!=="main" || branch.protected!==true ||
     typeof protectedSha!=="string" || !OID.test(protectedSha)){
    error(repo+" main is not protected");
  }
  const protection=await getJson(base+"/branches/main/protection",token,fetchImpl);
  auditProtection(protection);
  const file=async path=>decodePolicy(await getJson(base+"/contents/"+path+"?ref="+protectedSha,token,fetchImpl),path);
  const [codeowners,destinations,snapshots,requiredChecks]=await Promise.all([
    file(".github/CODEOWNERS"),
    file(".github/private-ci-approved-repositories.txt"),
    file(".github/private-ci-approved-source-snapshots.txt"),
    file(".github/private-ci-required-checks.json")
  ]);
  // Existence + blob integrity of the protected workflow is part of the trust root.
  await file(".github/workflows/private-ci-policy.yml");
  auditCodeowners(codeowners);
  auditProtection(protection);
  auditRequiredChecks(requiredChecks,protection);
  auditEmptyApprovals(destinations,snapshots);
  const after=await getJson(base+"/branches/main",token,fetchImpl);
  if(after?.protected!==true || after?.commit?.sha!==protectedSha){
    error(repo+" protected main changed during audit");
  }
  return Object.freeze({repo,status:"BOOTSTRAP_PROTECTED",protectedSha,
    requiredCheck:EXPECTED_CHECK.context,requiredCheckAppId:EXPECTED_CHECK.appId});
}
export async function auditAll(options={}){
  const results=[];
  for(const repo of SOURCE_REPOSITORIES) results.push(await auditRepository(repo,options));
  return results;
}

if(process.argv[1] && pathToFileURL(process.argv[1]).href===import.meta.url){
  try{
    const results=await auditAll({token:process.env.GH_TOKEN||process.env.GITHUB_TOKEN});
    console.log(JSON.stringify({status:"PRIVATE_CI_BOOTSTRAP_PROTECTED",repositories:results},null,2));
  }catch(e){
    console.error(e?.message?.startsWith("PRIVATE_CI_BOOTSTRAP_DENIED:")?e.message:
      "PRIVATE_CI_BOOTSTRAP_DENIED: unexpected audit failure");
    process.exitCode=1;
  }
}
