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
const PINNED_SOURCE_IDENTITIES=Object.freeze({
  "ores-truffle-oreslang/oreslang-source.java":1400792274,
  "ores-truffle-oreslang/oreslang-source.llvm":1410897874,
  "ores-truffle-oreslang/oreslang-source.net":1419704375,
  "ores-truffle-oreslang/oreslang-source.wasm":1419858954,
  "ores-truffle-oreslang/oreslang-source.forge":1419703674
});
// Reviewed immutable workflow identities: GitHub Actions app ID and check name
// alone cannot authenticate what instructions the status-producing job ran.
const PINNED_POLICY_WORKFLOW_BLOBS=Object.freeze({
  "ores-truffle-oreslang/oreslang-source.java":"3ccf6597e52d427ba261573d6702f9a6bf19c07a",
  "ores-truffle-oreslang/oreslang-source.llvm":"1e18ea42fc8a819e26a90f9b2dfea7cbdc129e76",
  "ores-truffle-oreslang/oreslang-source.net":"1e18ea42fc8a819e26a90f9b2dfea7cbdc129e76",
  "ores-truffle-oreslang/oreslang-source.wasm":"1e18ea42fc8a819e26a90f9b2dfea7cbdc129e76",
  "ores-truffle-oreslang/oreslang-source.forge":"1e18ea42fc8a819e26a90f9b2dfea7cbdc129e76"
});
const OID=/^[0-9a-f]{40}$/;
const EXPECTED_OWNER="@ORESoftware";
const EXPECTED_CHECK=Object.freeze({context:"private-ci-policy",appId:15368});
const SECURITY_PATHS=Object.freeze([
  "/.github/CODEOWNERS",
  "/.github/private-ci-approved-repositories.txt",
  "/.github/private-ci-approved-source-snapshots.txt",
  "/.github/private-ci-independent-reviewer.json",
  "/.github/private-ci-required-checks.json",
  "/.github/workflows/private-ci-policy.yml"
]);
const JAVA_SOURCE_REPOSITORY="ores-truffle-oreslang/oreslang-source.java";
// Java's reviewed publisher preserves a larger terminal CODEOWNERS block
// than the smaller fail-closed bootstrap contract in the other four backends.
const JAVA_SECURITY_PATHS=Object.freeze([
  "/.github/CODEOWNERS",
  "/.github/private-ci-approved-repositories.txt",
  "/.github/private-ci-approved-source-snapshots.txt",
  "/.github/private-ci-independent-reviewer.json",
  "/.github/private-ci-required-checks.json",
  "/.github/workflows/private-ci-mirror-preflight.yml",
  "/.github/workflows/private-ci-policy.yml",
  "/.github/workflows/private-exact-candidate-validation.yml",
  "/.github/workflows/private-exact-main-validation.yml",
  "/.github/workflows/private-exact-publisher-validation.yml",
  "/docs/security/CI_PRIVATE_SOURCE_MIRRORING.md",
  "/docs/security/PRIVATE_CI_POLICY_INTEGRATION_REVIEW_2026-10-16.md",
  "/docs/security/PRIVATE_EXACT_MAIN_VALIDATION.md",
  "/docs/security/PRIVATE_CI_REVIEW_PINNED_EXTERNAL_ADMISSION.md",
  "/scripts/check-private-ci-destination.sh",
  "/scripts/publish-private-ci-source.py",
  "/scripts/run-in-private-ci-destination.sh",
  "/scripts/test-private-ci-destination.sh",
  "/scripts/test-publish-private-ci-source.py",
  "/scripts/ci_private_mirror_preflight.py",
  "/scripts/verify-review-pinned-private-ci.py",
  "/scripts/dispatch-review-pinned-private-ci.py",
  "/tests/test_ci_private_mirror_preflight.py",
  "/tests/test_review_pinned_private_ci.py",
  "/tests/test_review_pinned_dispatcher.py",
  "/src/test/java/dev/oreslang/PrivateExactMainValidationWorkflowSecurityTest.java",
  "/src/test/java/dev/oreslang/PrivateExactPublisherAdmissionMutationTest.java",
  "/src/test/java/dev/oreslang/PrivateExactPublisherValidationWorkflowSecurityTest.java"
]);
const JAVA_REQUIRED_CHECKS=Object.freeze({
  schema:1,
  source:EXPECTED_CHECK,
  carrier:Object.freeze({context:"carrier-policy",appId:15368})
});

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
function strictJsonParse(text,label){
  // JSON.parse silently accepts duplicate object keys (last value wins).
  // Walk the JSON grammar first so escaped-equivalent duplicate names such as
  // "schema" and "\\u0073chema" are rejected before ordinary parsing.
  let i=0;
  const fail=()=>error(label+" JSON is ambiguous or invalid");
  const ws=()=>{ while(i<text.length && /[\t\n\r ]/.test(text[i])) i++; };
  const stringToken=()=>{
    ws();
    if(text[i]!=='"') fail();
    const start=i++;
    while(i<text.length){
      const ch=text[i++];
      if(ch==='"'){
        try{return JSON.parse(text.slice(start,i));}catch{fail();}
      }
      if(ch==='\\'){
        if(i>=text.length) fail();
        const esc=text[i++];
        if(esc==='u'){
          if(!/^[0-9a-fA-F]{4}$/.test(text.slice(i,i+4))) fail();
          i+=4;
        }else if(!'"\\/bfnrt'.includes(esc)) fail();
      }else if(ch.charCodeAt(0)<0x20) fail();
    }
    fail();
  };
  const literal=()=>{
    ws();
    const rest=text.slice(i);
    const m=rest.match(/^(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null)/);
    if(!m) fail();
    i+=m[0].length;
  };
  const value=()=>{
    ws();
    if(text[i]==='{') object();
    else if(text[i]==='[') array();
    else if(text[i]==='"') stringToken();
    else literal();
    ws();
  };
  const object=()=>{
    i++; ws();
    const seen=new Set();
    if(text[i]==='}'){i++;return;}
    for(;;){
      const key=stringToken();
      if(seen.has(key)) error(label+" JSON contains duplicate object key: "+key);
      seen.add(key);
      ws(); if(text[i++]!==':') fail();
      value();
      if(text[i]===','){i++;continue;}
      if(text[i]==='}'){i++;return;}
      fail();
    }
  };
  const array=()=>{
    i++; ws();
    if(text[i]===']'){i++;return;}
    for(;;){
      value();
      if(text[i]===','){i++;continue;}
      if(text[i]===']'){i++;return;}
      fail();
    }
  };
  value(); ws();
  if(i!==text.length) fail();
  try{return JSON.parse(text);}catch{fail();}
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
  if(raw.length===0 || raw.length>65536 || raw.toString("base64")!==clean)
    error(label+" base64 noncanonical");
  if((raw.length>=3 && raw[0]===0xef && raw[1]===0xbb && raw[2]===0xbf) || raw.includes(0))
    error(label+" contains forbidden BOM/NUL bytes");
  const digest=createHash("sha1").update("blob "+raw.length+"\0").update(raw).digest("hex");
  if(digest!==file.sha) error(label+" blob digest mismatch");
  const text=raw.toString("utf8");
  if(!Buffer.from(text,"utf8").equals(raw)) error(label+" UTF-8 invalid");
  return text;
}
function dataLines(text,label="policy"){
  const out=[];
  for(const line of text.split("\n")){
    if(line==="") continue;
    if(line.startsWith("#")) continue;
    if(line!==line.trim() || line.startsWith(" #"))
      error(label+" contains ambiguous surrounding whitespace/comment syntax");
    out.push(line);
  }
  return out;
}
export function auditCodeowners(text,repo){
  const lines=dataLines(text,"CODEOWNERS");
  const java=repo===JAVA_SOURCE_REPOSITORY;
  const paths=java?JAVA_SECURITY_PATHS:SECURITY_PATHS;
  if(lines.length<paths.length+1) error("security CODEOWNERS final block missing");
  const expected=paths.map(path=>path+" "+EXPECTED_OWNER);
  const actual=lines.slice(-expected.length);
  if(actual.length!==expected.length || actual.some((x,i)=>x!==expected[i])){
    error("security CODEOWNERS final block mismatch");
  }
  if(lines[lines.length-expected.length-1]!=="/.github/workflows/ "+EXPECTED_OWNER){
    error("workflow directory CODEOWNERS wildcard missing or shadowed");
  }
}
export function auditRequiredChecks(text,protection,repo){
  const policy=strictJsonParse(text,"required-check policy");
  const java=repo===JAVA_SOURCE_REPOSITORY;
  if(!policy || Object.getPrototypeOf(policy)!==Object.prototype ||
     !Number.isSafeInteger(policy.schema) || policy.schema!==1){
    error("required-check policy schema mismatch");
  }
  if(java){
    const expected=JAVA_REQUIRED_CHECKS;
    if(Object.keys(policy).length!==3 ||
       !Object.hasOwn(policy,"source") || !Object.hasOwn(policy,"carrier") ||
       ![["source",expected.source],["carrier",expected.carrier]].every(([key,value])=>{
         const actual=policy[key];
         return actual && Object.getPrototypeOf(actual)===Object.prototype &&
           Object.keys(actual).length===2 &&
           actual.context===value.context && actual.appId===value.appId;
       })){
      error("Java source/carrier issuer policy identity mismatch");
    }
  }else{
    if(Object.keys(policy).length!==2 ||
       !Array.isArray(policy.checks) || policy.checks.length!==1){
      error("required-check policy schema mismatch");
    }
    const one=policy.checks[0];
    if(!one || Object.getPrototypeOf(one)!==Object.prototype ||
       Object.keys(one).length!==2 || one.context!==EXPECTED_CHECK.context ||
       one.appId!==EXPECTED_CHECK.appId){
      error("required-check policy identity mismatch");
    }
  }
  const checks=protection?.required_status_checks;
  if(checks?.strict!==true || !Array.isArray(checks.checks) ||
     !Array.isArray(checks.contexts) || checks.contexts.length!==0){
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
     protection?.allow_force_pushes?.enabled!==false ||
     protection?.allow_deletions?.enabled!==false ||
     !review?.bypass_pull_request_allowances ||
     !Array.isArray(review.bypass_pull_request_allowances.users) ||
     !Array.isArray(review.bypass_pull_request_allowances.teams) ||
     !Array.isArray(review.bypass_pull_request_allowances.apps) ||
     review.bypass_pull_request_allowances.users.length!==0 ||
     review.bypass_pull_request_allowances.teams.length!==0 ||
     review.bypass_pull_request_allowances.apps.length!==0){
    error("review/admin/no-bypass protection mismatch");
  }
}
export function auditReviewerPolicy(text){
  const policy=strictJsonParse(text,"independent reviewer policy");
  const keys=["schema","enabled","minimumPermission","disallowedReviewerIds","reviewer"];
  if(!policy || Object.getPrototypeOf(policy)!==Object.prototype ||
     Object.keys(policy).length!==keys.length || keys.some(key=>!Object.hasOwn(policy,key)) ||
     !Number.isSafeInteger(policy.schema) || policy.schema!==2 ||
     typeof policy.enabled!=="boolean" ||
     !["write","maintain","admin"].includes(policy.minimumPermission)){
    error("independent reviewer policy schema mismatch");
  }
  const blocked=policy.disallowedReviewerIds;
  if(!Array.isArray(blocked) || blocked.length!==2 ||
     blocked.some(id=>!Number.isSafeInteger(id) || id<=0) ||
     new Set(blocked).size!==2 || !blocked.includes(11139560) || !blocked.includes(2148448)){
    error("independent reviewer operator denylist mismatch");
  }
  // Bootstrap is deliberately non-authorizing. Reviewer activation belongs to
  // the separately reviewed canary phase after protected-main bootstrap.
  if(policy.enabled!==false || policy.reviewer!==null){
    error("independent reviewer must remain disabled during bootstrap");
  }
}
function auditEmptyApprovals(destinationText,snapshotText){
  if(dataLines(destinationText,"destination approval").length!==0)
    error("destination approval must remain empty during bootstrap");
  if(dataLines(snapshotText,"snapshot approval").length!==0)
    error("snapshot approval must remain empty during bootstrap");
}
export async function auditRepository(repo,{token,fetchImpl=fetch}={}){
  if(typeof token!=="string" || !token.trim()) error("authenticated GitHub token required");
  if(!SOURCE_REPOSITORIES.includes(repo)) error("source repository is not allowlisted");
  if(typeof fetchImpl!=="function") error("GitHub fetch implementation unavailable");
  const base="https://api.github.com/repos/"+repo;
  const assertSourceIdentity=async()=>{
    const metadata=await getJson(base,token,fetchImpl);
    if(metadata?.full_name!==repo || metadata.id!==PINNED_SOURCE_IDENTITIES[repo] ||
       metadata.private!==true || metadata.visibility!=="private" ||
       metadata.archived!==false || metadata.disabled!==false){
      error(repo+" immutable source identity, privacy or active state mismatch");
    }
  };
  // Confirm the original reviewed private repository, not just an owner/repo
  // slug that could be reassigned after an organization transfer or rename.
  await assertSourceIdentity();
  const branch=await getJson(base+"/branches/main",token,fetchImpl);
  const protectedSha=branch?.commit?.sha;
  if(branch?.name!=="main" || branch.protected!==true ||
     typeof protectedSha!=="string" || !OID.test(protectedSha)){
    error(repo+" main is not protected");
  }
  const protection=await getJson(base+"/branches/main/protection",token,fetchImpl);
  auditProtection(protection);
  const file=async path=>decodePolicy(await getJson(base+"/contents/"+path+"?ref="+protectedSha,token,fetchImpl),path);
  const [codeowners,destinations,snapshots,reviewerPolicy,requiredChecks]=await Promise.all([
    file(".github/CODEOWNERS"),
    file(".github/private-ci-approved-repositories.txt"),
    file(".github/private-ci-approved-source-snapshots.txt"),
    file(".github/private-ci-independent-reviewer.json"),
    file(".github/private-ci-required-checks.json")
  ]);
  // Pin the *reviewed instructions* of the trusted check: an attacker could
  // otherwise replace the workflow with a passing no-op job under the same
  // check name and GitHub Actions issuer, despite valid CODEOWNERS metadata.
  const workflowPath=".github/workflows/private-ci-policy.yml";
  const workflowResponse=await getJson(base+"/contents/"+workflowPath+"?ref="+protectedSha,token,fetchImpl);
  decodePolicy(workflowResponse,workflowPath);
  if(workflowResponse.sha!==PINNED_POLICY_WORKFLOW_BLOBS[repo])
    error(repo+" policy workflow differs from independently reviewed immutable Git blob");
  auditCodeowners(codeowners,repo);
  auditProtection(protection);
  auditRequiredChecks(requiredChecks,protection,repo);
  auditReviewerPolicy(reviewerPolicy);
  auditEmptyApprovals(destinations,snapshots);
  // A protection rule can change without changing main's commit SHA.
  const finalProtection=await getJson(base+"/branches/main/protection",token,fetchImpl);
  auditProtection(finalProtection);
  auditRequiredChecks(requiredChecks,finalProtection,repo);
  const after=await getJson(base+"/branches/main",token,fetchImpl);
  if(after?.protected!==true || after?.commit?.sha!==protectedSha){
    error(repo+" protected main changed during audit");
  }
  // Privacy and immutable repository ID can change independently of branch
  // SHA and branch-protection settings. Revalidate both before success.
  await assertSourceIdentity();
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
