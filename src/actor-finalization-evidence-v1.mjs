// Source-free actor-finalization AF20 receipt *shape* validation.
// A self-reported receipt can never certify independently authenticated execution.
const hex40 = /^[a-f0-9]{40}$/;
const hex64 = /^[a-f0-9]{64}$/;
export const ACTOR_FINALIZATION_BACKENDS = Object.freeze(
  ["java", "llvm", "wasm", "cranelift", "net"]);
const nativeSanitizerTargets = new Set(["llvm", "cranelift", "forge"]);
export function validateActorFinalizationReceipt(expectedHead, receipt) {
  const errors = [];
  if (!hex40.test(expectedHead ?? "")) errors.push("INVALID_EXPECTED_HEAD");
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt))
    return {shapeReady: false, independentlyAuthenticated: false,
      parityCertified: false, errors: [...errors, "MALFORMED_RECEIPT"]};
  if (!hex40.test(receipt.sourceHead ?? "") || receipt.sourceHead !== expectedHead)
    errors.push("EXACT_HEAD_MISMATCH");
  if (!hex40.test(receipt.sourceTree ?? "")) errors.push("TREE_SHA_MISSING");
  if (receipt.workflowStatus !== "completed" ||
      receipt.workflowConclusion !== "success")
    errors.push("WORKFLOW_NOT_SUCCESSFUL");
  if (!Array.isArray(receipt.jobs) || receipt.jobs.length === 0)
    errors.push("NO_JOBS");
  else {
    const jobIds = new Set();
    for (const job of receipt.jobs) {
      if (!job || typeof job !== "object") {
        errors.push("MALFORMED_JOB"); continue;
      }
      if (!Number.isSafeInteger(job.id) || job.id <= 0 || jobIds.has(job.id))
        errors.push("MISSING_OR_DUPLICATE_JOB_ID");
      jobIds.add(job.id);
      if (!Number.isSafeInteger(job.runnerId) || job.runnerId <= 0)
        errors.push("RUNNER_NOT_ASSIGNED");
      if (!Array.isArray(job.steps) || job.steps.length === 0)
        errors.push("ZERO_EXECUTED_STEPS");
      else if (!job.steps.some(step => step &&
               step.name === job.requiredTestStep &&
               step.status === "completed" && step.conclusion === "success"))
        errors.push("REQUIRED_TEST_STEP_NOT_EXECUTED");
      if (job.conclusion !== "success") errors.push("JOB_NOT_SUCCESSFUL");
    }
  }
  if (!hex64.test(receipt.compilerSha256 ?? ""))
    errors.push("COMPILER_DIGEST_MISSING");
  if (!hex64.test(receipt.artifactSha256 ?? ""))
    errors.push("ARTIFACT_DIGEST_MISSING");
  if (receipt.compilerExecuted !== true || receipt.nativeGuestExecuted !== true)
    errors.push("GUEST_EXECUTION_NOT_SHOWN");
  if (!Array.isArray(receipt.scenarioIds) || receipt.scenarioIds.length === 0 ||
      new Set(receipt.scenarioIds).size !== receipt.scenarioIds.length ||
      receipt.scenarioIds.some(id => !/^AF(?:0[1-9]|1[0-9]|20)$/.test(id)))
    errors.push("SCENARIOS_INVALID");
  if (receipt.rejectionOnly === true || receipt.hostModelOnly === true)
    errors.push("SAFETY_OR_MODEL_NOT_GUEST_PARITY");
  // No JSON field can authenticate its own origin. The independent verifier
  // must inspect the provider's job/commit/artifact records, not trust this blob.
  return {shapeReady: errors.length === 0, independentlyAuthenticated: false,
    parityCertified: false, errors: [...new Set(errors)]};
}
export function validateActorFinalizationLedger(ledger) {
  const errors = [];
  if (!ledger || !Array.isArray(ledger.backends))
    return {valid: false, parityCertified: false, errors: ["INVALID_BACKEND_LEDGER"]};
  const names = ledger.backends.map(row => row?.backend);
  if (names.length !== ACTOR_FINALIZATION_BACKENDS.length ||
      new Set(names).size !== names.length ||
      ACTOR_FINALIZATION_BACKENDS.some(name => !names.includes(name)))
    errors.push("MISSING_DUPLICATE_OR_UNKNOWN_BACKEND");
  for (const row of ledger.backends) {
    if (!row || !ACTOR_FINALIZATION_BACKENDS.includes(row.backend) ||
        !["unverified", "safety-only", "host-verified", "guest-claimed"].includes(row.status))
      errors.push("UNRECOGNIZED_BACKEND_STATE");
    if (row?.status === "guest-claimed" && !row?.exactHeadEvidence)
      errors.push("GUEST_CLAIM_WITHOUT_RECEIPT");
  }
  return {valid: errors.length === 0, parityCertified: false,
    errors: [...new Set(errors)]};
}
export function actorFinalizationReleaseGate({
  backend, strictAot = false, sanitized = false,
  independentlyAuthenticated = false, shapeReady = false
} = {}) {
  const errors = [];
  if (![...ACTOR_FINALIZATION_BACKENDS,"forge"].includes(backend))
    errors.push("UNKNOWN_BACKEND");
  if (!shapeReady || !independentlyAuthenticated)
    errors.push("EVIDENCE_NOT_AUTHENTICATED");
  if (backend === "net" && !strictAot) errors.push("NET_NATIVE_AOT_REQUIRED");
  if (nativeSanitizerTargets.has(backend) && !sanitized)
    errors.push("NATIVE_SANITIZERS_REQUIRED");
  return {ready: errors.length === 0, errors};
}
