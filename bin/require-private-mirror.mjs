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

const SOURCE_IDS = Object.freeze({
  "ores-truffle-oreslang/oreslang-source.java": 1400792274,
  "ores-truffle-oreslang/oreslang-source.llvm": 1410897874,
  "ores-truffle-oreslang/oreslang-source.net": 1419704375,
  "ores-truffle-oreslang/oreslang-source.wasm": 1419858954,
  "ores-truffle-oreslang/oreslang-source.forge": 1419703674
});
const OID = /^[a-f0-9]{40}$/;
const FULL_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;

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
function policyText(data) {
  if (!data || data.type !== "file" || data.encoding !== "base64" ||
      typeof data.content !== "string" || data.content.length > 65536 ||
      typeof data.sha !== "string" || !OID.test(data.sha) ||
      !/^[A-Za-z0-9+/=\r\n]+$/.test(data.content)) {
    throw Error("untrusted or oversized source-main policy content");
  }
  const clean = data.content.replace(/[\r\n]/g, "");
  const raw = Buffer.from(clean, "base64");
  if (raw.length > 32768 || raw.toString("base64") !== clean) {
    throw Error("noncanonical source-main policy content");
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
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const values = line.split(" ");
    if (values.length !== fields || values.some(x => !x || /\s/.test(x))) {
      throw Error("malformed reviewed " + label);
    }
    const key = values.join(" ");
    if (names.has(values[0]) || ids.has(values[fields - 1])) throw Error("duplicate reviewed " + label);
    names.add(values[0]); ids.add(values[fields - 1]);
    if (key === expected) matchCount++;
  }
  if (matchCount !== 1) throw Error("missing exact protected-main " + label);
}

const SECURITY_PATHS = Object.freeze([
  "/.github/CODEOWNERS",
  "/.github/private-ci-approved-repositories.txt",
  "/.github/private-ci-approved-source-snapshots.txt",
  "/.github/private-ci-required-checks.json",
  "/.github/workflows/private-ci-policy.yml"
]);
const TRUSTED_SECURITY_OWNERS = new Set([
  "@ORESoftware",
  "@ores-truffle-oreslang/security"
]);

function requireSecurityCodeowners(text) {
  const lines = text.split("\n").map(x => x.trim())
    .filter(x => x && !x.startsWith("#"));
  if (lines.length < SECURITY_PATHS.length) {
    throw Error("security CODEOWNERS final block missing");
  }
  const tail = lines.slice(-SECURITY_PATHS.length);
  const seen = new Set();
  let owners = null;
  for (const line of tail) {
    const values = line.split(/\s+/);
    const pattern = values.shift();
    if (!SECURITY_PATHS.includes(pattern) || seen.has(pattern) ||
        values.length === 0 || values.some(x => !TRUSTED_SECURITY_OWNERS.has(x))) {
      throw Error("security CODEOWNERS final block is not exact trusted ownership");
    }
    const normalized = [...new Set(values)].sort();
    if (normalized.length !== values.length) {
      throw Error("security CODEOWNERS contains duplicate owners");
    }
    const signature = normalized.join(" ");
    if (owners === null) owners = signature;
    else if (owners !== signature) {
      throw Error("security CODEOWNERS policy files do not share one owner set");
    }
    seen.add(pattern);
  }
  if (seen.size !== SECURITY_PATHS.length) {
    throw Error("security CODEOWNERS final block incomplete");
  }
  return owners;
}

function requiredChecksPolicy(text) {
  let value;
  try { value = JSON.parse(text); }
  catch { throw Error("required-check policy is not valid JSON"); }
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length !== 2 || value.schema !== 1 ||
      !Array.isArray(value.checks) || value.checks.length < 1 || value.checks.length > 16) {
    throw Error("required-check policy schema invalid");
  }
  const result = new Map();
  for (const item of value.checks) {
    if (!item || Object.getPrototypeOf(item) !== Object.prototype ||
        Object.keys(item).length !== 2 ||
        typeof item.context !== "string" || item.context.length < 1 || item.context.length > 100 ||
        /[\r\n\0]/.test(item.context) ||
        !Number.isSafeInteger(item.appId) || item.appId <= 0) {
      throw Error("required-check policy entry invalid");
    }
    if (result.has(item.context)) throw Error("required-check policy contains duplicate context");
    result.set(item.context, item.appId);
  }
  return result;
}

function requireApprovedProtectedChecks(checks, policy) {
  if (!checks || checks.strict !== true ||
      !Array.isArray(checks.checks) || checks.checks.length < policy.size ||
      (Array.isArray(checks.contexts) && checks.contexts.length !== 0)) {
    throw Error("approved app-bound required status checks missing");
  }
  const actual = new Map();
  for (const item of checks.checks) {
    if (!item || typeof item.context !== "string" ||
        !Number.isSafeInteger(item.app_id) || item.app_id <= 0 ||
        actual.has(item.context)) {
      throw Error("required status check context/app identity invalid");
    }
    actual.set(item.context, item.app_id);
  }
  for (const [context, appId] of policy) {
    if (actual.get(context) !== appId) {
      throw Error("approved required status check context/app identity missing");
    }
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
  const review = rules?.required_pull_request_reviews;
  const checks = rules?.required_status_checks;
  if (review?.require_code_owner_reviews !== true ||
      review.dismiss_stale_reviews !== true ||
      !Number.isSafeInteger(review.required_approving_review_count) ||
      review.required_approving_review_count < 1 ||
      rules?.enforce_admins?.enabled !== true ||
      !review?.bypass_pull_request_allowances ||
      (review?.bypass_pull_request_allowances?.users?.length ?? 0) !== 0 ||
      (review?.bypass_pull_request_allowances?.teams?.length ?? 0) !== 0 ||
      (review?.bypass_pull_request_allowances?.apps?.length ?? 0) !== 0) {
    throw Error("independently enforced codeowner review proof missing");
  }
  const file = async name => policyText(await metadata(base +
    "/contents/.github/" + name + "?ref=" + protectedSha, token, fetchImpl));
  requireSecurityCodeowners(await file("CODEOWNERS"));
  requireApprovedProtectedChecks(checks,
    requiredChecksPolicy(await file("private-ci-required-checks.json")));
  requireUniquePolicyEntry(await file("private-ci-approved-repositories.txt"),
    2, to + " " + destId, "destination approval");
  requireUniquePolicyEntry(await file("private-ci-approved-source-snapshots.txt"),
    3, sourceCommit + " " + sourceTree + " " + destId, "source snapshot approval");
  const commit = await metadata(base + "/git/commits/" + sourceCommit, token, fetchImpl);
  if (commit?.sha !== sourceCommit || commit?.tree?.sha !== sourceTree) {
    throw Error("reviewed source commit/tree mismatch");
  }
  // TOCTOU: fail if protected main changed while its policy was being read.
  const after = await metadata(base + "/branches/main", token, fetchImpl);
  if (after?.protected !== true || after?.commit?.sha !== protectedSha) {
    throw Error("protected policy changed during source admission");
  }
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
  await protectedSourceApproval(from, sourceCommit, sourceTree,
    destinationRepo.id, to, token, fetchImpl);
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
