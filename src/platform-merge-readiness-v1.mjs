/* Metadata-only, fail-closed platform PR triage.
 * No GitHub requests, credentials, source access, reviewer authentication,
 * protected-branch inspection or CI log attestation. Never authorizes merge. */
const REPOS = new Set([
  "oreslang-platform-conformance", "oreslang-platform.mobile",
  "oreslang-platform.iot", "oreslang-platform.asic",
  "oreslang-platform.fpga", "oreslang-platform.desktop",
  "oreslang-platform.embedded"
]);
const SHA = /^[0-9a-f]{40}$/;
const CHECK = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,95}$/;
const exact = (value, names) =>
  value !== null && typeof value === "object" &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).length === names.length &&
  names.every(key => Object.hasOwn(value,key)) &&
  Object.keys(value).every(key => names.includes(key));
const FIELDS = ["repository","head_sha","review_head_sha","draft",
  "mergeable","protected_base","approvers","checks"];
const CHECK_FIELDS = ["name","conclusion","executed_steps"];

export function assessPlatformMergeCandidate(receipt) {
  if (!exact(receipt,FIELDS) ||
      !REPOS.has(receipt.repository) ||
      typeof receipt.head_sha !== "string" || !SHA.test(receipt.head_sha) ||
      typeof receipt.review_head_sha !== "string" || !SHA.test(receipt.review_head_sha) ||
      typeof receipt.draft !== "boolean" ||
      typeof receipt.mergeable !== "boolean" ||
      typeof receipt.protected_base !== "boolean" ||
      !Array.isArray(receipt.approvers) || receipt.approvers.length > 32 ||
      receipt.approvers.some(p => typeof p !== "string" || !CHECK.test(p)) ||
      new Set(receipt.approvers).size !== receipt.approvers.length ||
      !Array.isArray(receipt.checks) ||
      receipt.checks.length > 128 ||
      receipt.checks.some(c => !exact(c,CHECK_FIELDS) ||
        typeof c.name !== "string" || !CHECK.test(c.name) ||
        !["success","failure","cancelled","skipped","pending"].includes(c.conclusion) ||
        !Number.isSafeInteger(c.executed_steps) ||
        c.executed_steps < 0 || c.executed_steps > 10000) ||
      new Set(receipt.checks.map(c => c.name)).size !== receipt.checks.length) {
    throw new TypeError("invalid platform PR evidence metadata");
  }

  let classification = "REPORTED_CHECKS_PASS_EXTERNAL_VERIFICATION_REQUIRED";
  if (receipt.draft) classification = "DRAFT_HOLD";
  else if (!receipt.protected_base) classification = "UNPROTECTED_BASE_HOLD";
  else if (!receipt.mergeable) classification = "UNMERGEABLE_HOLD";
  else if (receipt.head_sha !== receipt.review_head_sha) classification = "STALE_REVIEW_HOLD";
  else if (receipt.approvers.length === 0) classification = "NO_APPROVER_HOLD";
  else if (receipt.checks.length === 0 ||
    receipt.checks.some(c => c.conclusion !== "success" || c.executed_steps === 0))
    classification = "INCOMPLETE_CHECKS_HOLD";

  return Object.freeze({
    classification,
    reported_checks_complete:
      classification === "REPORTED_CHECKS_PASS_EXTERNAL_VERIFICATION_REQUIRED",
    authorizes_merge: false,
    certifies_review_identity: false,
    authenticates_ci_logs: false,
    proves_guest_or_device_execution: false
  });
}
