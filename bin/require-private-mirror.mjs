#!/usr/bin/env node
/**
 * PRE-COPY confidentiality admission. Source Git hashes prove byte identity,
 * not permission to publish the bytes. Always validate repository visibility
 * before creating a tree/blob, pushing a ref or uploading an Actions artifact.
 *
 * This verifier does not perform a mirror, fetch source bytes or change GitHub
 * settings. The mirror orchestrator must fail closed if this command fails.
 */
import {pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {auditCodeowners,auditRequiredChecks,auditProtection} from "./audit-private-ci-bootstrap.mjs";

const SOURCE_IDS = Object.freeze({
  "ores-truffle-oreslang/oreslang-source.java": 1400792274,
  "ores-truffle-oreslang/oreslang-source.llvm": 1410897874,
  "ores-truffle-oreslang/oreslang-source.net": 1419704375,
  "ores-truffle-oreslang/oreslang-source.wasm": 1419858954,
  "ores-truffle-oreslang/oreslang-source.forge": 1419703674
});
const OID = /^[a-f0-9]{40}$/;
const FULL_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const INCIDENT_REPOSITORY = "ores-truffle-oreslang/oreslang-platform-conformance";
const REQUIRED_INCIDENTS = Object.freeze([
  Object.freeze({
    number:22,
    title:"P0 SECURITY: private Oreslang source mirrored into public GitHub Actions carrier"
  }),
  Object.freeze({
    number:77,
    title:"P0 SECURITY: audit repeated private Oreslang source carriers in Scintilla"
  }),
  // Never authorize new copies while the unauthorized LLVM carrier incident
  // remains open. Incident closure is necessary, not sufficient: the reviewed
  // source-commit/tree, destination ID and protected-main gates still apply.
  Object.freeze({
    number:127,
    title:"P0 SECURITY: investigate source-bearing Oreslang CI placement in dummy-stack private carrier during unprotected policy window"
  }),
  Object.freeze({
    number:212,
    title:"P0 review: LLVM private source exact tree executed in unapproved honeypot carrier"
  })
]);
const CARRIER_CHECK = Object.freeze({context:"carrier-policy",appId:15368});
const PINNED_SOURCE_POLICY_WORKFLOW_BLOBS = Object.freeze({
  "ores-truffle-oreslang/oreslang-source.java":"3ccf6597e52d427ba261573d6702f9a6bf19c07a",
  "ores-truffle-oreslang/oreslang-source.llvm":"1e18ea42fc8a819e26a90f9b2dfea7cbdc129e76",
  "ores-truffle-oreslang/oreslang-source.net":"1e18ea42fc8a819e26a90f9b2dfea7cbdc129e76",
  "ores-truffle-oreslang/oreslang-source.wasm":"1e18ea42fc8a819e26a90f9b2dfea7cbdc129e76",
  "ores-truffle-oreslang/oreslang-source.forge":"1e18ea42fc8a819e26a90f9b2dfea7cbdc129e76"
});
const PINNED_CARRIER_POLICY_WORKFLOW_BLOBS = Object.freeze({
  "sagitta-stack/sagitta-infra":"645f7f8f5ec6d907fb2a1b7ea9f93c8e28f3855a"
});
const REVIEWER_LOGIN=/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const PERMISSION_RANK=Object.freeze({read:1,triage:2,write:3,maintain:4,admin:5});
const CARRIER_SECURITY_PATHS = Object.freeze([
  "/.github/private-ci-independent-reviewer.json",
  "/.github/private-ci-approved-source-snapshots.txt",
  "/.github/private-ci-carrier-policy.json",
  "/.github/CODEOWNERS",
  "/.github/workflows/"
]);

function repoName(value) {
  if (typeof value !== "string" || !FULL_NAME.test(value) ||
      value.length > 220 || value.includes("..")) {
    throw Error("invalid GitHub owner/repository identifier");
  }
  return value;
}

async function repoMetadata(name, token, fetchImpl) {
  let response;
  try {
    response = await fetchImpl("https://api.github.com/repos/" + name, {
      method: "GET",
      redirect: "error",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    // Transport diagnostics are untrusted. Never propagate a library error
    // whose message could contain an Authorization header or access token.
    throw Error("GitHub repository visibility lookup failed (" + name + ")");
  }
  if (!response || response.status !== 200) {
    throw Error("GitHub repository visibility is unverifiable (" + name + ")");
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw Error("GitHub repository metadata could not be decoded (" + name + ")");
  }
  if (!result || result.full_name !== name ||
      typeof result.private !== "boolean" ||
      !["public", "internal", "private"].includes(result.visibility)) {
    throw Error("GitHub returned invalid or mismatched repository metadata (" + name + ")");
  }
  return result;
}


/** Fail-closed read-only request. Never include errors or raw response bodies. */
async function metadata(path, token, fetchImpl) {
  let response;
  try {
    response = await fetchImpl("https://api.github.com/" + path, {
      method: "GET", redirect: "error",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    throw Error("trusted source export policy lookup failed");
  }
  if (!response || response.status !== 200) throw Error("trusted source export policy unavailable");
  try { return await response.json(); }
  catch { throw Error("trusted source export policy is not decodable"); }
}
async function requireIncidentCompletion(token, fetchImpl) {
  for (const expected of REQUIRED_INCIDENTS) {
    const issue = await metadata("repos/" + INCIDENT_REPOSITORY + "/issues/" + expected.number,
      token, fetchImpl);
    if (issue?.number !== expected.number ||
        issue?.state !== "closed" || issue?.state_reason !== "completed" ||
        issue?.title !== expected.title ||
        issue?.html_url !== "https://github.com/" + INCIDENT_REPOSITORY + "/issues/" + expected.number ||
        issue?.repository_url !== "https://api.github.com/repos/" + INCIDENT_REPOSITORY ||
        typeof issue?.closed_at !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(issue.closed_at) ||
        Object.hasOwn(issue, "pull_request")) {
      throw Error("P0 private-source incident is not completed with exact identity");
    }
  }
}

function strictJsonParse(text,label) {
  let i=0;
  const fail=()=>{ throw Error(label+" JSON is ambiguous or invalid"); };
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
    const m=text.slice(i).match(/^(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null)/);
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
      if(seen.has(key)) throw Error(label+" JSON contains duplicate object key: "+key);
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

function exactDataLines(text,label) {
  const out=[];
  for (const line of text.split("\n")) {
    if (line==="") continue;
    if (line.startsWith("#")) continue;
    if (line!==line.trim() || line.startsWith(" #")) {
      throw Error(label+" contains ambiguous surrounding whitespace/comment syntax");
    }
    out.push(line);
  }
  return out;
}


function activeReviewerPolicy(text,label) {
  const value=strictJsonParse(text,label+" reviewer policy");
  const keys=["schema","enabled","minimumPermission","disallowedReviewerIds","reviewer"];
  if(!value || Object.getPrototypeOf(value)!==Object.prototype ||
     Object.keys(value).length!==keys.length || keys.some(k=>!Object.hasOwn(value,k)) ||
     !Number.isSafeInteger(value.schema) || value.schema!==2 ||
     value.enabled!==true || !["write","maintain","admin"].includes(value.minimumPermission)){
    throw Error(label+" independent reviewer policy is not actively configured");
  }
  const blocked=value.disallowedReviewerIds;
  if(!Array.isArray(blocked) || blocked.length!==2 ||
     blocked.some(id=>!Number.isSafeInteger(id)||id<=0) ||
     new Set(blocked).size!==2 || !blocked.includes(11139560) || !blocked.includes(2148448)){
    throw Error(label+" independent reviewer denylist mismatch");
  }
  const reviewer=value.reviewer;
  if(!reviewer || Object.getPrototypeOf(reviewer)!==Object.prototype ||
     Object.keys(reviewer).length!==2 || typeof reviewer.login!=="string" ||
     !REVIEWER_LOGIN.test(reviewer.login) || !Number.isSafeInteger(reviewer.id) ||
     reviewer.id<=0 || blocked.includes(reviewer.id)){
    throw Error(label+" independent reviewer identity invalid");
  }
  return Object.freeze({login:reviewer.login,id:reviewer.id,minimumPermission:value.minimumPermission});
}

async function requireReviewerPermission(repo,reviewer,token,fetchImpl) {
  const doc=await metadata("repos/"+repo+"/collaborators/"+encodeURIComponent(reviewer.login)+"/permission",
    token,fetchImpl);
  const user=doc?.user;
  const permission=String(doc?.permission||"").toLowerCase();
  if(user?.login!==reviewer.login || user?.id!==reviewer.id ||
     !Object.hasOwn(PERMISSION_RANK,permission) ||
     PERMISSION_RANK[permission]<PERMISSION_RANK[reviewer.minimumPermission]){
    throw Error("independent reviewer lacks live repository permission");
  }
  return permission;
}

async function latestPolicyCommit(repo,protectedSha,path,token,fetchImpl) {
  const rows=await metadata("repos/"+repo+"/commits?sha="+protectedSha+
    "&path="+encodeURIComponent(path)+"&per_page=1",token,fetchImpl);
  if(!Array.isArray(rows)||rows.length!==1||typeof rows[0]?.sha!=="string"||!OID.test(rows[0].sha)){
    throw Error("authorization policy commit history is unavailable");
  }
  return rows[0].sha;
}

async function requireExactPolicyReview(repo,protectedSha,paths,reviewer,token,fetchImpl) {
  const commits=[];
  for(const path of paths) commits.push(await latestPolicyCommit(repo,protectedSha,path,token,fetchImpl));
  if(new Set(commits).size!==1) throw Error("authorization files were not activated in one reviewed commit");
  const policyCommit=commits[0];
  const pulls=await metadata("repos/"+repo+"/commits/"+policyCommit+"/pulls?per_page=20",token,fetchImpl);
  if(!Array.isArray(pulls)||pulls.length===0||pulls.length>=20)
    throw Error("authorization pull request lookup is ambiguous");
  const merged=pulls.filter(pr=>pr?.state==="closed" && typeof pr?.merged_at==="string" &&
    pr?.base?.ref==="main" && pr?.base?.repo?.full_name===repo &&
    pr?.head?.repo?.full_name===repo);
  if(merged.length!==1 || !Number.isSafeInteger(merged[0]?.number) || merged[0].number<=0 ||
     typeof merged[0]?.head?.sha!=="string" || !OID.test(merged[0].head.sha) ||
     !Number.isSafeInteger(merged[0]?.user?.id) || merged[0].user.id<=0){
    throw Error("authorization commit is not bound to one merged main pull request");
  }
  const pr=merged[0];
  if(pr.user.id===reviewer.id) throw Error("independent reviewer cannot be the authorization PR author");
  const reviews=await metadata("repos/"+repo+"/pulls/"+pr.number+"/reviews?per_page=100",token,fetchImpl);
  if(!Array.isArray(reviews)||reviews.length>=100) throw Error("authorization review history is ambiguous");
  const exact=reviews.filter(review=>review?.user?.login===reviewer.login &&
    review?.user?.id===reviewer.id && review?.commit_id===pr.head.sha &&
    typeof review?.submitted_at==="string" && Number.isSafeInteger(review?.id) && review.id>0)
    .sort((a,b)=>a.submitted_at.localeCompare(b.submitted_at)||a.id-b.id);
  if(exact.length===0 || String(exact.at(-1).state||"").toUpperCase()!=="APPROVED"){
    throw Error("configured independent reviewer has not approved the exact authorization head");
  }
  return Object.freeze({policyCommit,prNumber:pr.number,prHead:pr.head.sha,reviewId:exact.at(-1).id});
}

function requireCarrierCodeowners(text) {
  const lines = exactDataLines(text,"carrier CODEOWNERS");
  const expected = CARRIER_SECURITY_PATHS.map(path => path + " @ORESoftware");
  const actual = lines.slice(-expected.length);
  if (actual.length !== expected.length || actual.some((line,index) => line !== expected[index])) {
    throw Error("carrier security CODEOWNERS final block mismatch");
  }
}

function carrierPolicy(text) {
  const value = strictJsonParse(text,"carrier policy");
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length !== 2 || !Number.isSafeInteger(value.schema) || value.schema !== 1 ||
      !value.carrier || Object.getPrototypeOf(value.carrier) !== Object.prototype ||
      Object.keys(value.carrier).length !== 2 ||
      value.carrier.context !== CARRIER_CHECK.context ||
      value.carrier.appId !== CARRIER_CHECK.appId) {
    throw Error("carrier policy identity mismatch");
  }
}

function requireCarrierCheck(protection) {
  auditProtection(protection);
  const checks = protection?.required_status_checks;
  if (checks?.strict !== true || !Array.isArray(checks.checks) ||
      !Array.isArray(checks.contexts) || checks.contexts.length !== 0) {
    throw Error("strict app-bound carrier checks missing");
  }
  const seen = new Set();
  let required = false;
  for (const item of checks.checks) {
    if (!item || typeof item.context !== "string" ||
        !Number.isSafeInteger(item.app_id) || item.app_id <= 0 ||
        seen.has(item.context)) {
      throw Error("carrier required check identity invalid");
    }
    seen.add(item.context);
    if (item.context === CARRIER_CHECK.context && item.app_id === CARRIER_CHECK.appId) {
      required = true;
    }
  }
  if (!required) throw Error("carrier-policy check/app binding missing");
}

async function protectedCarrierApproval(to, sourceCommit, sourceTree, destId, token, fetchImpl) {
  const base = "repos/" + to;
  const branch = await metadata(base + "/branches/main", token, fetchImpl);
  const protectedSha = branch?.commit?.sha;
  if (branch?.name !== "main" || branch.protected !== true ||
      typeof protectedSha !== "string" || !OID.test(protectedSha)) {
    throw Error("protected carrier main is mandatory");
  }
  const protection = await metadata(base + "/branches/main/protection", token, fetchImpl);
  requireCarrierCheck(protection);
  const file = async name => policyText(await metadata(base +
    "/contents/.github/" + name + "?ref=" + protectedSha, token, fetchImpl));
  requireCarrierCodeowners(await file("CODEOWNERS"));
  carrierPolicy(await file("private-ci-carrier-policy.json"));
  const reviewer=activeReviewerPolicy(await file("private-ci-independent-reviewer.json"),"carrier");
  requireUniquePolicyEntry(await file("private-ci-approved-source-snapshots.txt"),
    3, sourceCommit+" "+sourceTree+" "+destId, "carrier source snapshot approval");
  const workflowPath=".github/workflows/private-ci-carrier-admission.yml";
  const workflow=await metadata(base+"/contents/"+workflowPath+"?ref="+protectedSha,token,fetchImpl);
  policyText(workflow);
  if(workflow.sha!==PINNED_CARRIER_POLICY_WORKFLOW_BLOBS[to])
    throw Error("carrier policy workflow differs from independently reviewed immutable Git blob");
  const review=await requireExactPolicyReview(to,protectedSha,[
    ".github/private-ci-independent-reviewer.json",
    ".github/private-ci-approved-source-snapshots.txt"
  ],reviewer,token,fetchImpl);
  const after = await metadata(base + "/branches/main", token, fetchImpl);
  if (after?.protected !== true || after?.commit?.sha !== protectedSha) {
    throw Error("protected carrier policy changed during admission");
  }
  return Object.freeze({reviewer,review,protectedSha});
}
function policyText(data) {
  if (!data || data.type !== "file" || data.encoding !== "base64" ||
      typeof data.content !== "string" || data.content.length > 65536 ||
      typeof data.sha !== "string" || !OID.test(data.sha) ||
      !/^[A-Za-z0-9+/=\r\n]+$/.test(data.content)) {
    throw Error("untrusted or oversized source-main policy content");
  }
  const clean = data.content.replace(/[\r\n]/g, "");
  const raw = Buffer.from(clean, "base64");
  if (raw.length === 0 || raw.length > 32768 || raw.toString("base64") !== clean) {
    throw Error("noncanonical source-main policy content");
  }
  if ((raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) ||
      raw.includes(0)) {
    throw Error("source-main policy contains forbidden BOM/NUL bytes");
  }
  const actualSha = createHash("sha1").update("blob " + raw.length + "\0").update(raw).digest("hex");
  if (actualSha !== data.sha) throw Error("source-main policy blob digest mismatch");
  const text = raw.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(raw)) throw Error("invalid source-main policy encoding");
  return text;
}
function requireUniquePolicyEntry(text, fields, expected, label) {
  let matchCount = 0;
  const names = new Set(), ids = new Set();
  for (const line of exactDataLines(text,label)) {
    const values = line.split(" ");
    if (values.length !== fields || values.some(x => !x || /\s/.test(x))) {
      throw Error("malformed reviewed " + label);
    }
    const key = values.join(" ");
    if (names.has(values[0]) || ids.has(values[fields - 1])) throw Error("duplicate reviewed " + label);
    names.add(values[0]); ids.add(values[fields - 1]);
    if (key === expected) matchCount++;
  }
  if (matchCount !== 1 || names.size !== 1) {
    throw Error("protected-main " + label + " must contain exactly one active canary");
  }
}

async function protectedSourceApproval(from, sourceCommit, sourceTree, destId, to, token, fetchImpl) {
  const base = "repos/" + from;
  const branch = await metadata(base + "/branches/main", token, fetchImpl);
  const protectedSha = branch?.commit?.sha;
  if (branch?.name !== "main" || branch.protected !== true ||
      typeof protectedSha !== "string" || !OID.test(protectedSha)) {
    throw Error("protected source main is mandatory");
  }
  // A branch's protected flag alone cannot prove independent codeowner review.
  const rules = await metadata(base + "/branches/main/protection", token, fetchImpl);
  auditProtection(rules);
  const file = async name => policyText(await metadata(base +
    "/contents/.github/" + name + "?ref=" + protectedSha, token, fetchImpl));
  auditCodeowners(await file("CODEOWNERS"), from);
  auditRequiredChecks(await file("private-ci-required-checks.json"), rules, from);
  const reviewer=activeReviewerPolicy(await file("private-ci-independent-reviewer.json"),"source");
  requireUniquePolicyEntry(await file("private-ci-approved-repositories.txt"),
    2, to + " " + destId, "destination approval");
  requireUniquePolicyEntry(await file("private-ci-approved-source-snapshots.txt"),
    3, sourceCommit + " " + sourceTree + " " + destId, "source snapshot approval");
  const workflowPath=".github/workflows/private-ci-policy.yml";
  const workflow=await metadata(base+"/contents/"+workflowPath+"?ref="+protectedSha,token,fetchImpl);
  policyText(workflow);
  if(workflow.sha!==PINNED_SOURCE_POLICY_WORKFLOW_BLOBS[from])
    throw Error("source policy workflow differs from independently reviewed immutable Git blob");
  const review=await requireExactPolicyReview(from,protectedSha,[
    ".github/private-ci-approved-repositories.txt",
    ".github/private-ci-approved-source-snapshots.txt",
    ".github/private-ci-independent-reviewer.json"
  ],reviewer,token,fetchImpl);
  const commit = await metadata(base + "/git/commits/" + sourceCommit, token, fetchImpl);
  if (commit?.sha !== sourceCommit || commit?.tree?.sha !== sourceTree) {
    throw Error("reviewed source commit/tree mismatch");
  }
  // TOCTOU: fail if protected main changed while its policy was being read.
  const after = await metadata(base + "/branches/main", token, fetchImpl);
  if (after?.protected !== true || after?.commit?.sha !== protectedSha) {
    throw Error("protected policy changed during source admission");
  }
  return Object.freeze({reviewer,review,protectedSha});
}

export async function requirePrivateMirror({
  source, destination, sourceCommit, sourceTree, approvedDestinations, token, fetchImpl = fetch
}) {
  // In particular, no discovery endpoint and no source blob operation may
  // be attempted when approval, credentials or names are missing.
  const from = repoName(source);
  const to = repoName(destination);
  if (!(from in SOURCE_IDS) || !OID.test(sourceCommit ?? "") ||
      !OID.test(sourceTree ?? "")) {
    throw Error("exact pinned Oreslang source commit/tree required");
  }
  if (!Array.isArray(approvedDestinations) ||
      approvedDestinations.length === 0 || approvedDestinations.length > 32 ||
      !approvedDestinations.every(v => typeof v === "string" && FULL_NAME.test(v)) ||
      !approvedDestinations.includes(to)) {
    throw Error("destination is not in the explicit trusted private-mirror allowlist");
  }
  if (typeof token !== "string" || token.trim().length < 1) {
    throw Error("authenticated GitHub repository visibility lookup required");
  }
  if (typeof fetchImpl !== "function") throw Error("GitHub visibility lookup unavailable");

  // Incident containment is a revocable release gate. Check it before any
  // private-source metadata/content reads and, because the publisher calls
  // this admission again before every write, before every destination write.
  await requireIncidentCompletion(token, fetchImpl);

  const sourceRepo = await repoMetadata(from, token, fetchImpl);
  if (sourceRepo.private !== true || sourceRepo.visibility !== "private" ||
      sourceRepo.archived === true) {
    throw Error("private source metadata is not securely established");
  }
  if (sourceRepo.id !== SOURCE_IDS[from] || sourceRepo.disabled !== false) {
    throw Error("immutable source repository identity mismatch");
  }
  const destinationRepo = await repoMetadata(to, token, fetchImpl);
  if (destinationRepo.private !== true || destinationRepo.visibility !== "private" ||
      destinationRepo.archived === true || destinationRepo.disabled !== false ||
      !Number.isSafeInteger(destinationRepo.id) || destinationRepo.id <= 0 ||
      destinationRepo.permissions?.push !== true) {
    throw Error("destination must be a writable verified PRIVATE GitHub repository");
  }
  const carrierApproval=await protectedCarrierApproval(to,sourceCommit,sourceTree,
    destinationRepo.id,token,fetchImpl);
  const sourceApproval=await protectedSourceApproval(from, sourceCommit, sourceTree,
    destinationRepo.id, to, token, fetchImpl);
  if(carrierApproval.reviewer.login!==sourceApproval.reviewer.login ||
     carrierApproval.reviewer.id!==sourceApproval.reviewer.id ||
     carrierApproval.reviewer.minimumPermission!==sourceApproval.reviewer.minimumPermission){
    throw Error("source and carrier independent reviewer policies do not match");
  }
  await requireReviewerPermission(from,sourceApproval.reviewer,token,fetchImpl);
  await requireReviewerPermission(to,sourceApproval.reviewer,token,fetchImpl);
  return Object.freeze({status: "PRIVATE_MIRROR_APPROVED", source: from, destination: to,
    sourceCommit, sourceTree, destinationId: destinationRepo.id});
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv.length !== 6) throw Error("usage: require-private-mirror.mjs <source-owner/repo> <destination-owner/repo> <source-commit> <source-tree>");
    const approvedDestinations = (process.env.ORES_APPROVED_PRIVATE_MIRRORS || "")
      .split(",").filter(Boolean);
    const verdict = await requirePrivateMirror({
      source: process.argv[2],
      destination: process.argv[3],
      sourceCommit: process.argv[4], sourceTree: process.argv[5],
      approvedDestinations,
      token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN
    });
    console.log(JSON.stringify(verdict));
  } catch (error) {
    // Never print token, GitHub response JSON or credential-bearing URLs.
    console.error("MIRROR_PRIVACY_DENIED: " + error.message);
    process.exitCode = 1;
  }
}
