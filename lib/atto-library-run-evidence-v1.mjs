// Classify real GitHub run/job snapshots. This is not a proof of the source
// tree, compiler identity, guest semantics or artifact provenance.
function assert(value, message) { if (!value) throw new Error(message); }
const isSha = value => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);

export function classifyAttoRun({
  run, jobs, expectedHead, expectedJob, expectedWorkflowPath, requiredSteps = []
}) {
  assert(isSha(expectedHead), "expected exact 40-character PR head SHA");
  assert(typeof expectedJob === "string" && expectedJob.length > 0, "expected job name");
  assert(Array.isArray(requiredSteps) && requiredSteps.length > 0 &&
    requiredSteps.every(name => typeof name === "string" && name.length > 0) &&
    new Set(requiredSteps).size === requiredSteps.length, "distinct required job steps");
  assert(run && typeof run === "object" && isSha(run.head_sha), "GitHub run head SHA missing");
  assert(run.head_sha === expectedHead, "run is not bound to expected PR head");
  assert(Number.isSafeInteger(run.id) && run.id > 0 &&
    Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0,
    "real run and attempt identity required");
  if (expectedWorkflowPath !== undefined) {
    assert(typeof expectedWorkflowPath === "string" &&
      /^\.github\/workflows\/[a-zA-Z0-9_.-]+\.ya?ml$/.test(expectedWorkflowPath),
      "expected workflow path must be a repository workflow");
    assert(run.path === expectedWorkflowPath,
      "run workflow path is not the expected source-owned workflow");
  }
  assert(Array.isArray(jobs), "GitHub job array required");

  const candidates = jobs.filter(job => job?.name === expectedJob);
  if (candidates.length === 0)
    return {classification: "NOT_EXECUTED", reason: "TARGET_JOB_MISSING", executedSteps: 0};
  if (candidates.length !== 1)
    return {classification: "UNTRUSTED_EVIDENCE", reason: "DUPLICATE_JOB_NAME", executedSteps: 0};
  const job = candidates[0];
  assert(Number.isSafeInteger(job.id) && job.id > 0, "real job identity required");
  // A job can be copied from another run/attempt, or attached to the wrong
  // synthetic PR merge ref. It must match the run's immutable source identity.
  if (job.run_id !== run.id || job.run_attempt !== run.run_attempt ||
      job.head_sha !== expectedHead)
    return {classification: "UNTRUSTED_EVIDENCE",
      reason: "JOB_RUN_ATTEMPT_OR_HEAD_MISMATCH", executedSteps: 0};
  if (!Array.isArray(job.steps) || job.steps.length === 0) {
    // An in-progress job can legitimately have no reported steps yet.
    // The absence becomes a runner admission failure only when the run and
    // job have completed unsuccessfully with no allocated runner.
    if (run.status !== "completed" || job.status !== "completed")
      return {classification: "IN_PROGRESS",
        reason: "JOB_HAS_NOT_FINISHED_ADMISSION", executedSteps: 0};
    if (run.conclusion === "success" || job.conclusion === "success" ||
        job.runner_id !== 0)
      return {classification: "UNTRUSTED_EVIDENCE",
        reason: "ZERO_STEPS_BUT_RUNNER_OR_SUCCESS_REPORTED", executedSteps: 0};
    return {classification: "RUNNER_ADMISSION_FAILURE",
      reason: "ZERO_REPORTED_JOB_STEPS", executedSteps: 0};
  }
  if (new Set(job.steps.map(step => step?.name)).size !== job.steps.length ||
      new Set(job.steps.map(step => step?.number)).size !== job.steps.length ||
      job.steps.some(step => !step || typeof step.name !== "string" ||
        !Number.isSafeInteger(step.number) || step.number <= 0))
    return {classification: "UNTRUSTED_EVIDENCE", reason: "MALFORMED_OR_DUPLICATE_STEPS", executedSteps: 0};

  // A skipped or neutral step is *not* evidence that any command executed.
  // Count only completed, successful or failed steps; runner allocation
  // remains a separate necessary (not sufficient) gate for real execution.
  const executed = job.steps.filter(step => step.status === "completed" &&
    (step.conclusion === "success" || step.conclusion === "failure")).length;
  if (job.steps.some((step, index) => step.number !== index + 1))
    return {classification: "UNTRUSTED_EVIDENCE",
      reason: "NONCANONICAL_STEP_ORDER", executedSteps: executed};
  if (run.status !== "completed" || job.status !== "completed")
    return {classification: "IN_PROGRESS", reason: "RUN_OR_JOB_INCOMPLETE", executedSteps: executed};
  // A completed GitHub job with a queued, null, or unrecognized step
  // cannot be promoted to executed evidence by forged green job metadata.
  if (job.steps.some(step => step.status !== "completed" ||
      !["success", "skipped", "failure", "cancelled", "neutral"].includes(step.conclusion)))
    return {classification: "UNTRUSTED_EVIDENCE",
      reason: "INCONSISTENT_COMPLETED_STEP_STATES", executedSteps: executed};
  if (run.conclusion !== "success" || job.conclusion !== "success" ||
      job.steps.some(step => step.conclusion === "failure" || step.conclusion === "cancelled"))
    return {classification: "EXECUTION_FAILED", reason: "FAILED_OR_CANCELLED_STEP", executedSteps: executed};
  if (!Number.isSafeInteger(job.runner_id) || job.runner_id <= 0)
    return {classification: "UNTRUSTED_EVIDENCE", reason: "NO_RUNNER_IDENTITY", executedSteps: executed};

  for (const required of requiredSteps) {
    const index = job.steps.findIndex(step => step.name === required &&
      step.status === "completed" && step.conclusion === "success");
    if (index < 0)
      return {classification: "NO_REQUIRED_EXECUTION", reason: "MISSING_SUCCESSFUL_STEP: " + required,
        executedSteps: executed};
  }
  // GitHub reports steps, not execution of the exact Git tree or the validity
  // of artifacts. Caller must independently check checkout read-back, source
  // blob/tree, run_attempt, compiler receipt and negative mutation controls.
  return {classification: "EXECUTED_STEPS_UNVERIFIED", reason: "REQUIRES_INDEPENDENT_RECEIPT_AUDIT",
    executedSteps: executed};
}
