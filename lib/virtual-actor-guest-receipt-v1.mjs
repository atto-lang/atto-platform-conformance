/**
 * Source-free receipt SHAPE gate, not an attestation service.
 * It NEVER returns VERIFIED, and cannot verify remote logs or a Git tree.
 */
const SHA1 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const positive = n => Number.isSafeInteger(n) && n > 0;
const deny = (classification, reason) => ({ classification, reason });
const completed = step => step && typeof step === "object" &&
  positive(step.number) && step.status === "completed" &&
  ["success", "failure", "cancelled", "timed_out"].includes(step.conclusion);

export function classifyVirtualActorGuestReceipt(receipt, expected) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt))
    return deny("UNVERIFIED_IDENTITY", "missing or malformed receipt");
  // A job that never acquired a runner is NOT a compiler/test failure.
  if (!positive(receipt.runnerId) || !Array.isArray(receipt.steps) ||
      !receipt.steps.some(completed))
    return deny("UNVERIFIED_RUNNER_ADMISSION", "no runner or completed executed steps");
  if (receipt.hostOnly === true || receipt.sourceFree === true ||
      receipt.compilerBackedGuest !== true)
    return deny("UNVERIFIED_HOST_ONLY", "no compiler-backed .atto guest");
  if (!expected || !SHA1.test(expected.headSha ?? "") ||
      !SHA1.test(expected.treeSha ?? "") ||
      !SHA256.test(expected.fixtureSha256 ?? "") ||
      receipt.headSha !== expected.headSha ||
      receipt.treeSha !== expected.treeSha ||
      receipt.fixtureSha256 !== expected.fixtureSha256)
    return deny("UNVERIFIED_IDENTITY", "exact head/tree/fixture identity missing or mismatched");
  // A PR-supplied URL is not a real receipt unless it at least agrees with
  // exact run/job/attempt identifiers. Authenticity still needs independent lookup.
  const boundJobUrl = REPO.test(expected.repoFullName ?? "") &&
    positive(receipt.runId) && positive(receipt.jobId) &&
    positive(receipt.runAttempt) &&
    receipt.repoFullName === expected.repoFullName &&
    receipt.jobUrl === `https://github.com/${expected.repoFullName}/actions/runs/${receipt.runId}/job/${receipt.jobId}`;
  if (!boundJobUrl)
    return deny("UNVERIFIED_JOB_IDENTITY", "job URL, repository, run, job or attempt not bound");
  if (receipt.jobStatus !== "completed" || receipt.jobConclusion !== "success" ||
      !SHA256.test(receipt.guestLogSha256 ?? "") ||
      !receipt.steps.some(step => completed(step) && step.conclusion === "success" &&
        step.kind === "compiled-atto-guest" && positive(step.executedTests)))
    return deny("UNVERIFIED_GUEST_EXECUTION", "compiled guest step/count/log or job success missing");
  const mutations = receipt.negativeMutationReceipts;
  const required = expected.requiredNegativeMutations;
  if (!Array.isArray(required) || !required.length ||
      new Set(required).size !== required.length ||
      required.some(id => typeof id !== "string" || !id) ||
      !Array.isArray(mutations) || mutations.length < required.length ||
      mutations.some(item => !item || typeof item.mutationId !== "string" ||
        !SHA256.test(item.logSha256 ?? "") || item.rejected !== true ||
        !positive(item.executedTests)) ||
      new Set(mutations.map(item => item.mutationId)).size !== mutations.length ||
      !required.every(id => mutations.some(item => item.mutationId === id)))
    return deny("UNVERIFIED_NEGATIVE_MUTATIONS",
      "unique, executed negative receipts for each required mutation missing");
  return deny("CANDIDATE_UNREVIEWED",
    "shape only: independently confirm exact head/tree, runner logs, compiler, job attempt, negative mutations and review");
}
