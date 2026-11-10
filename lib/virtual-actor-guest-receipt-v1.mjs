/**
 * Source-free receipt shape gate ONLY. This module cannot verify a Git tree,
 * execute a compiler, establish guest provenance, or approve a PR.
 * It deliberately NEVER returns VERIFIED.
 */
const SHA1 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const deny = (classification, reason) => ({ classification, reason });

export function classifyVirtualActorGuestReceipt(receipt, expected) {
  if (!receipt || typeof receipt !== "object")
    return deny("UNVERIFIED_IDENTITY", "missing receipt");
  // Zero-step jobs are runner admission failures even if the workflow says success.
  if (receipt.runnerId === 0 || !Array.isArray(receipt.steps) ||
      receipt.steps.length === 0 || receipt.steps.every(step => step?.conclusion === "skipped"))
    return deny("UNVERIFIED_RUNNER_ADMISSION", "no executed job steps");
  if (receipt.hostOnly === true || receipt.sourceFree === true ||
      receipt.compilerBackedGuest !== true)
    return deny("UNVERIFIED_HOST_ONLY", "no compiler-backed .atto guest");
  if (!expected || !SHA1.test(expected.headSha ?? "") ||
      !SHA1.test(expected.treeSha ?? "") || !SHA256.test(expected.fixtureSha256 ?? "") ||
      receipt.headSha !== expected.headSha ||
      receipt.treeSha !== expected.treeSha ||
      receipt.fixtureSha256 !== expected.fixtureSha256)
    return deny("UNVERIFIED_IDENTITY", "exact head/tree/fixture identity missing or mismatched");
  if (!SHA256.test(receipt.guestLogSha256 ?? "") ||
      typeof receipt.jobUrl !== "string" ||
      !/^https:\/\/github\.com\//.test(receipt.jobUrl) ||
      !receipt.steps.some(step => step?.conclusion === "success" &&
         step?.kind === "compiled-atto-guest"))
    return deny("UNVERIFIED_GUEST_EXECUTION", "guest step/log provenance incomplete");
  if (!Array.isArray(receipt.negativeMutationReceipts) ||
      receipt.negativeMutationReceipts.length === 0 ||
      receipt.negativeMutationReceipts.some(item => !SHA256.test(item?.logSha256 ?? "") ||
        item?.rejected !== true))
    return deny("UNVERIFIED_NEGATIVE_MUTATIONS", "negative execution receipts missing");
  return deny("CANDIDATE_UNREVIEWED",
    "structural receipt candidate only; independently confirm logs, exact tree and review");
}
