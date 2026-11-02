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
// Known source-bearing carrier owners are not valid relays or destinations.
// This is a quarantine layer, not a substitute for source provenance review.
const QUARANTINED_CARRIER_OWNERS = new Set([
  "zed-pkg-test", "scintilla-run-test", "ores-dummy-org-oreslang-stack",
  "agent-pontifex-test", "led-dynamo", "claimgraph-test",
  "honeypot-r-us-test", "ores-llm"
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
      !Number.isSafeInteger(result.id) || result.id <= 0 ||
      result.fork !== false || result.disabled !== false ||
      result.default_branch !== "main" ||
      typeof result.private !== "boolean" ||
      !["public", "internal", "private"].includes(result.visibility)) {
    throw Error("GitHub returned invalid or mismatched repository metadata (" + name + ")");
  }
  return result;
}

export async function requirePrivateMirror({
  source, destination, approvedDestinations, token, fetchImpl = fetch
}) {
  // In particular, no discovery endpoint and no source blob operation may
  // be attempted when approval, credentials or names are missing.
  const from = repoName(source);
  const to = repoName(destination);
  // A "mirror" back into the same repository only creates new
  // source-bearing refs. It is not an independent executable-CI target,
  // even when the owner or repository slug is written in mixed case.
  // Deny prior to any authenticated HTTP or Git object operation.
  if (from.toLowerCase() === to.toLowerCase()) {
    throw Error("private source self-mirror is not an authorized CI destination");
  }
  // P0 containment: deny EVERY cross-organization copy through this
  // publisher, regardless of the apparent source owner. Oreslang source
  // already copied to an intermediate private repository must not be able
  // to bypass the unresolved incident hold by naming that relay as source.
  //
  // An allowlist, a private destination, old carrier success or an explicit
  // user request cannot replace independently verified per-snapshot approval.
  // Reject BEFORE any GitHub request; a future authorized transfer must use
  // a separately reviewed policy/receipt path, not an env bypass.
  const sourceOwner = from.split("/")[0].toLowerCase();
  const targetOwner = to.split("/")[0].toLowerCase();
  if (sourceOwner !== targetOwner ||
      sourceOwner === "ores-truffle-oreslang" ||
      QUARANTINED_CARRIER_OWNERS.has(sourceOwner) ||
      QUARANTINED_CARRIER_OWNERS.has(targetOwner)) {
    // All private Oreslang source publishing is suspended, including a
    // self-repository "mirror": it would create a new source-bearing Git
    // branch without the protected-head authorization and receipt gates.
    // Existing source-local exact-head Actions need no object copying.
    // Relay-to-relay copies in different orgs are independently forbidden.
    throw Error("private source mirror suspended pending independent Oreslang incident dispositions #22 and #77");
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
  const destinationRepo = await repoMetadata(to, token, fetchImpl);
  if (destinationRepo.private !== true || destinationRepo.visibility !== "private" ||
      destinationRepo.archived === true || destinationRepo.permissions?.push !== true) {
    throw Error("destination must be a writable verified PRIVATE GitHub repository");
  }
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
