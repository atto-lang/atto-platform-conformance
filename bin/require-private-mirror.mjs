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

const POLICY_PATH = ".github/private-ci-approved-repositories.txt";
const OWNER_REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** Caller-supplied lists are only restrictions, never authorization.
 * Read exact approval from trusted source main, never the PR under test.
 * Protected-main security reviews must be enforced in GitHub branch rules.
 */
async function requireReviewedApproval(source, destination, sourceRepo, token, fetchImpl) {
  if (sourceRepo.default_branch !== "main")
    throw Error("trusted source default branch must be main");
  let response;
  try {
    response = await fetchImpl(
      "https://api.github.com/repos/" + source + "/contents/" + POLICY_PATH + "?ref=main",
      {
        method: "GET", redirect: "error",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": "Bearer " + token,
          "X-GitHub-Api-Version": "2022-11-28"
        },
        signal: AbortSignal.timeout(5000)
      }
    );
  } catch {
    throw Error("trusted source destination policy request failed");
  }
  if (!response || response.status !== 200)
    throw Error("trusted source destination policy unavailable");
  let record;
  try { record = await response.json(); }
  catch { throw Error("trusted source destination policy invalid"); }
  if (!record || record.path !== POLICY_PATH || record.encoding !== "base64" ||
      !Number.isSafeInteger(record.size) || record.size < 0 || record.size > 4096 ||
      typeof record.content !== "string" || record.content.length > 8192)
    throw Error("trusted source destination policy invalid");
  const encoded = record.content.replace(/\s/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    throw Error("trusted source destination policy encoding invalid");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== record.size || bytes.toString("base64") !== encoded)
    throw Error("trusted source destination policy bytes invalid");
  const policy = bytes.toString("utf8");
  if (Buffer.byteLength(policy) !== bytes.length || policy.includes("\0"))
    throw Error("trusted source destination policy text invalid");
  const active = policy.split(/\r?\n/).map(x => x.trim())
    .filter(x => x.length > 0 && !x.startsWith("#"));
  if (active.length > 32 || active.some(x => !OWNER_REPO.test(x) || x.includes("..")) ||
      new Set(active).size !== active.length)
    throw Error("trusted source destination policy entries invalid");
  if (!active.includes(destination))
    throw Error("destination not approved by trusted source main policy");
}

export async function requirePrivateMirror({
  source, destination, approvedDestinations, token, fetchImpl = fetch
}) {
  // In particular, no discovery endpoint and no source blob operation may
  // be attempted when approval, credentials or names are missing.
  const from = repoName(source);
  const to = repoName(destination);
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
  const destinationRepo = await repoMetadata(to, token, fetchImpl);
  if (destinationRepo.private !== true || destinationRepo.visibility !== "private" ||
      destinationRepo.archived === true || destinationRepo.permissions?.push !== true ||
      destinationRepo.default_branch !== "main") {
    throw Error("destination must be a writable verified PRIVATE GitHub repository");
  }
  await requireReviewedApproval(from, to, sourceRepo, token, fetchImpl);
  return Object.freeze({status: "PRIVATE_MIRROR_APPROVED", source: from, destination: to});
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv.length !== 4) throw Error("usage: require-private-mirror.mjs <source-owner/repo> <destination-owner/repo>");
    const approvedDestinations = (process.env.ORES_APPROVED_PRIVATE_MIRRORS || "")
      .split(",").filter(Boolean);
    const verdict = await requirePrivateMirror({
      source: process.argv[2],
      destination: process.argv[3],
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
