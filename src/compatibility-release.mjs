import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {registryUrl, validateOrgIntegrationRegistry} from "./integration-registry.mjs";

export const compatibilityUrl = new URL("../integration/compatibility-candidate.v1.json", import.meta.url);
const manifestFields = [
  "schemaVersion", "releaseId", "kind", "organization", "snapshotDate",
  "inventoryPath", "inventoryGitBlobSha", "promotionState", "securityIncident", "provenance", "policy", "pins"
];
const pinFields = ["name", "repositoryId", "ref", "commit", "compatibility", "evidence"];
function requireObject(obj, context) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj) ||
      Object.getPrototypeOf(obj) !== Object.prototype) {
    throw Error(context + ": expected plain JSON object");
  }
}
function requireFields(obj, fields, context) {
  requireObject(obj, context);
  if (JSON.stringify(Object.keys(obj).sort()) !== JSON.stringify([...fields].sort())) {
    throw Error(context + ": unexpected or missing properties");
  }
}
// Reproduce the canonical JSON Git blob ID; this binds the complete dependency
// graph/metadata, not just repository names. PR review protects this anchor.
export function canonicalInventoryGitBlobSha(inventory) {
  const bytes = Buffer.from(JSON.stringify(inventory, null, 2) + "\n", "utf8");
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}
function sortedNames(names) {
  for (let i = 1; i < names.length; i++) {
    if (!(names[i - 1] < names[i])) return false;
  }
  return true;
}

// Release *candidate* validator. This intentionally rejects all invented
// passing evidence until a separate attestation/approval implementation exists.
// No network calls, Git source transfers, shell commands, or CI execution.
export function validateCompatibilityCandidate(candidate, inventory) {
  const topology = validateOrgIntegrationRegistry(inventory);
  requireFields(candidate, manifestFields, "candidate");
  if (candidate.schemaVersion !== 1 ||
      candidate.kind !== "CANDIDATE_SNAPSHOT" ||
      candidate.organization !== inventory.organization ||
      candidate.inventoryPath !== "integration/org-repositories.v1.json" ||
      candidate.inventoryGitBlobSha !== canonicalInventoryGitBlobSha(inventory) ||
      candidate.snapshotDate !== inventory.snapshotDate ||
      candidate.releaseId !== "oreslang-compat-" + candidate.snapshotDate + "-candidate-1" ||
      candidate.promotionState !== "BLOCKED_UNVERIFIED" ||
      candidate.securityIncident !== "oreslang-platform-conformance#22" ||
      candidate.policy !== "METADATA_ONLY_NO_SOURCE_EXPORT" ||
      typeof candidate.provenance !== "string" ||
      !candidate.provenance.includes("NOT branch tip attestation or CI evidence")) {
    throw Error("candidate: invalid identity or non-promotable policy");
  }
  if (!Array.isArray(candidate.pins) || candidate.pins.length !== topology.count) {
    throw Error("candidate: pin coverage mismatch");
  }
  const source = new Map(inventory.repositories.map(r => [r.name, r]));
  const names = [];
  const seenRepositoryIds = new Set();
  for (const p of candidate.pins) {
    requireFields(p, pinFields, "pin");
    if (typeof p.name !== "string" || !source.has(p.name)) {
      throw Error("pin: unknown repository");
    }
    names.push(p.name);
    if (typeof p.repositoryId !== "string" || !/^[1-9][0-9]{0,19}$/.test(p.repositoryId) ||
        seenRepositoryIds.has(p.repositoryId)) {
      throw Error("pin: invalid or duplicated immutable GitHub repository ID");
    }
    seenRepositoryIds.add(p.repositoryId);
    if (p.ref !== "main") throw Error("pin: unexpected reference");
    if (typeof p.commit !== "string" || !/^[0-9a-f]{40}$/.test(p.commit)) {
      throw Error("pin: expected full immutable Git commit SHA");
    }
    if (p.compatibility !== "UNVERIFIED" ||
        !Array.isArray(p.evidence) || p.evidence.length !== 0) {
      throw Error("pin: unsupported compatibility or forged evidence promotion");
    }
  }
  if (!sortedNames(names) || names.some((name, i) => name !== inventory.repositories[i].name)) {
    throw Error("pin: duplicate, missing, or unsorted repository");
  }
  return Object.freeze({
    candidateId: candidate.releaseId,
    repositories: candidate.pins.length,
    intendedRelationships: topology.edgeCount,
    pinnedCommits: candidate.pins.length,
    verifiedCompatibilities: 0,
    releaseReady: false,
    result: "CANDIDATE_ONLY_NOT_COMPATIBILITY_PROOF"
  });
}
// Canonical source bytes are part of the Git blob binding. Reject duplicate
// JSON properties, noncanonical whitespace, missing terminal LF and ambiguous
// byte-level formatting before Git SHA validation. Do not relax to JSON.parse
// alone: normalization could otherwise hide a changed on-disk Git blob.
export function parseCanonicalJson(text, context) {
  if (typeof text !== "string" || text.length > 1_000_000) {
    throw Error(context + ": missing or oversized JSON");
  }
  const data = JSON.parse(text);
  if (JSON.stringify(data, null, 2) + "\n" !== text) {
    throw Error(context + ": non-canonical JSON; exact Git blob cannot be attested");
  }
  return data;
}
export function loadCompatibilityCandidate(url = compatibilityUrl) {
  return parseCanonicalJson(readFileSync(url, "utf8"), "candidate");
}
export function loadCandidateInventory(url = registryUrl) {
  return parseCanonicalJson(readFileSync(url, "utf8"), "inventory");
}
