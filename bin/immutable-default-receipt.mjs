// Source-local *receipt-shape* validator, NOT an authentication or compiler test.
// Fetch workflow/job details independently from GitHub at the approved exact head.
// Never feed self-authored receipt JSON into a release decision without readback.
export const mandatoryAttoBackends = Object.freeze(["java", "llvm", "wasm", "net", "forge"]);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const requiredCases = new Map([
  ["IDB-01", "guest"],   // type-first int x = 7
  ["IDB-02", "guest"],   // const x = 7
  ["IDB-03", "guest"],   // const int x = 7
  ["IDB-07", "semantic-reject"], // type-first rebinding, not parse failure
  ["IDB-08", "semantic-reject"], // const rebinding, not parse failure
  ["IDB-17", "checked-trap"],    // eager unused initializer
  ["IDB-24", "guest"],   // explicit let rebinding positive control
]);

function result(status, reason) { return {status, reason}; }

// Status REVIEW_REQUIRED is intentionally not PASS: this module can validate
// structure but cannot authenticate a compiler, job logs or guest observation.
export function assessImmutableReceipt(receipt, pin) {
  if (!pin || !SHA1.test(pin.headSha) || !SHA1.test(pin.treeSha) ||
      !mandatoryAttoBackends.includes(pin.backend)) {
    return result("INVALID_PIN", "requires approved backend and exact commit/tree");
  }
  if (!receipt || receipt.backend !== pin.backend ||
      receipt.sourceHead !== pin.headSha || receipt.sourceTree !== pin.treeSha ||
      receipt.workflow?.head_sha !== pin.headSha) {
    return result("STALE_OR_WRONG_SOURCE", "receipt must match the approved backend, head and root Git tree");
  }
  const job = receipt.job;
  // GitHub returns null as well as [] when a job never obtained a runner.
  if (!job || !Array.isArray(job.steps) || job.steps.length === 0 ||
      !Number.isSafeInteger(job.runner_id) || job.runner_id <= 0) {
    return result("RUNNER_NOT_ADMITTED", "zero steps or no assigned runner is not execution");
  }
  if (!Number.isSafeInteger(receipt.workflow.run_attempt) ||
      receipt.workflow.run_attempt <= 0 ||
      !Number.isSafeInteger(receipt.workflow.id) || receipt.workflow.id <= 0 ||
      !Number.isSafeInteger(job.id) || job.id <= 0 ||
      job.run_id !== receipt.workflow.id) {
    return result("INVALID_JOB_BINDING", "run, job and attempt must be bound");
  }
  const indices = new Set();
  for (const step of job.steps) {
    if (!Number.isSafeInteger(step.number) || step.number <= 0 ||
        indices.has(step.number) || typeof step.name !== "string" ||
        step.name.length === 0 || !step.started_at || !step.completed_at) {
      return result("INVALID_STEPS", "ordered unique executed-step metadata required");
    }
    indices.add(step.number);
  }
  if (receipt.workflow.status !== "completed" ||
      receipt.workflow.conclusion !== "success" ||
      job.status !== "completed" || job.conclusion !== "success" ||
      job.steps.some(s => s.status !== "completed" || s.conclusion !== "success")) {
    return result("EXECUTED_NOT_SUCCESSFUL", "failed, skipped, pending or cancelled steps cannot certify parity");
  }
  if (!SHA256.test(receipt.compilerSha256) || !SHA256.test(receipt.binarySha256)) {
    return result("UNPINNED_ARTIFACT", "independent compiler and guest binary SHA-256 required");
  }
  if (!Array.isArray(receipt.cases)) {
    return result("NO_GUEST_PROOF", "host-only or source-only checks are not compiler-backed guest evidence");
  }
  const cases = new Map();
  for (const entry of receipt.cases) {
    if (!entry || typeof entry.id !== "string" || cases.has(entry.id)) {
      return result("INVALID_CASES", "duplicate or malformed guest case receipt");
    }
    cases.set(entry.id, entry);
  }
  for (const [id, requiredKind] of requiredCases) {
    const c = cases.get(id);
    if (!c || c.kind !== requiredKind || c.backend !== pin.backend ||
        c.headSha !== pin.headSha || !SHA1.test(c.fixtureBlobSha1)) {
      return result("INCOMPLETE_GUEST_PROOF", id + " requires a pinned compiler-owned observation");
    }
    if (requiredKind === "semantic-reject" &&
        (c.diagnosticFamily !== "immutable-binding" ||
         c.stage !== "typecheck" || c.artifactPublished !== false)) {
      return result("INCOMPLETE_GUEST_PROOF", id + " must reject a resolved readonly assignment, not parsing");
    }
    if (requiredKind === "guest" &&
        (c.stage !== "guest" || typeof c.observedI64 !== "string")) {
      return result("INCOMPLETE_GUEST_PROOF", id + " needs a real guest value");
    }
    if (requiredKind === "checked-trap" &&
        (c.stage !== "runtime" || c.diagnosticFamily !== "checked-i64-overflow")) {
      return result("INCOMPLETE_GUEST_PROOF", "unused initializer must genuinely trap");
    }
  }
  if (["IDB-01","IDB-02","IDB-03"].some(id => cases.get(id).observedI64 !== "7") ||
      cases.get("IDB-24").observedI64 !== "8") {
    return result("INCORRECT_GUEST_RESULT", "literal-equivalence or explicit-let oracle mismatch");
  }
  return result("REVIEW_REQUIRED", "structurally adequate, but independent log/source/toolchain attestation and approval remain mandatory");
}
