// Static evidence-shape gate only. This module never authenticates GitHub runs.
import {BACKENDS, EXPECTED_GIT_BLOB, RELATIVE_FIXTURE} from "./five-backend-scalar.mjs";

export const EVIDENCE_SCHEMA = "oreslang.five-backend-scalar-evidence.v1";
export const EXECUTION_MODES = Object.freeze({
  "oreslang-source.java": "graalvm-guest",
  "oreslang-source.llvm": "llvm-native-guest",
  "oreslang-source.net": "windows-native-aot-guest",
  "oreslang-source.wasm": "wasm-guest",
  "oreslang-source.forge": "forge-guest"
});
export const REPOSITORY_IDS = Object.freeze({
  "oreslang-source.java": 1400792274,
  "oreslang-source.llvm": 1410897874,
  "oreslang-source.net": 1419704375,
  "oreslang-source.wasm": 1419858954,
  "oreslang-source.forge": 1419703674
});

const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const WORKFLOW = /^\.github\/workflows\/[A-Za-z0-9._/-]+\.ya?ml$/;
const CI_STATEMENT = "GITHUB_RUN_EXECUTION_VERIFIED_NOT_GUEST_PARITY_CERTIFIED";

function fail(message) { throw new Error("INVALID_FIVE_BACKEND_EVIDENCE: " + message); }
function object(v, name) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) fail(name + " must be object");
  return v;
}
function sha1(v, name) { if (typeof v !== "string" || !SHA1.test(v)) fail(name + " must be SHA-1"); }
function sha256(v, name) { if (typeof v !== "string" || !SHA256.test(v)) fail(name + " must be SHA-256"); }
function positive(v, name) { if (!Number.isSafeInteger(v) || v < 1) fail(name + " must be positive safe integer"); }
function nonempty(v, name) {
  if (typeof v !== "string" || v.trim().length < 1 || v.length > 250 ||
      /[\u0000-\u001f\u007f]/.test(v)) fail(name + " must be nonempty bounded single-line string");
}
function runPath(v, workflowPath) {
  // An evidence claim must identify exactly which reviewed workflow *ref*
  // GitHub reports as executed. Still verify this string independently.
  if (typeof v !== "string" || v.length > 500 ||
      !v.startsWith(workflowPath) ||
      (v !== workflowPath && !v.startsWith(workflowPath + "@")))
    fail("workflow run path does not match expected workflow");
  if (v !== workflowPath) {
    const ref = v.slice(workflowPath.length + 1);
    if (!/^[A-Za-z0-9_./-]+$/.test(ref) ||
        ref.split("/").some(segment => segment === "" || segment === "." || segment === ".."))
      fail("workflow run ref is malformed");
  }
}
function strictKeys(value, keys, name) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(name + " contains unexpected key: " + key);
}
function validateExecution(e, backend) {
  object(e, "execution evidence");
  const fields = ["repositoryId", "headCommitSha", "headTreeSha", "workflowId",
    "workflowPath", "workflowRunPath", "workflowBlobSha",
    "runId", "runAttempt", "runEvent", "jobId", "runnerId", "runnerName",
    "runnerJob", "testStep", "executionMode", "toolchain", "ciStatement",
    "sourceGitBlobSha", "nativeGuestExecuted", "compilerExecuted",
    "executedFixtureIds", "executedTestCount", "observedValue",
    "testLogSha256", "artifactSha256"];
  strictKeys(e, fields, "execution evidence");
  for (const key of fields) if (!Object.hasOwn(e, key)) fail("missing execution evidence: " + key);
  if (e.repositoryId !== REPOSITORY_IDS[backend]) fail("wrong numeric repository identity");
  for (const key of ["headCommitSha", "headTreeSha", "workflowBlobSha", "sourceGitBlobSha"])
    sha1(e[key], key);
  if (e.sourceGitBlobSha !== EXPECTED_GIT_BLOB) fail("source contract blob mismatch");
  for (const key of ["workflowId", "runId", "runAttempt", "jobId", "runnerId",
                     "executedTestCount"]) positive(e[key], key);
  if (typeof e.workflowPath !== "string" || !WORKFLOW.test(e.workflowPath) ||
      e.workflowPath.split("/").some(s => s === "" || s === "." || s === ".."))
    fail("invalid exact workflow path");
  runPath(e.workflowRunPath, e.workflowPath);
  if (!["push", "pull_request"].includes(e.runEvent)) fail("untrusted workflow event");
  for (const key of ["runnerName", "runnerJob", "testStep", "toolchain"]) nonempty(e[key], key);
  // Match the source backends' exact-run verifier: runner lifecycle entries
  // are never executable native proof steps, even when a run is successful.
  if (["Set up job", "Complete job", "Initialize containers",
       "Start containers", "Stop containers"].includes(e.testStep) ||
      e.testStep.startsWith("Pre ") || e.testStep.startsWith("Post "))
    fail("native test step must be executable, not runner housekeeping");
  if (e.executionMode !== EXECUTION_MODES[backend]) fail("incorrect native execution mode");
  if (e.ciStatement !== CI_STATEMENT) fail("GitHub execution proof statement absent");
  if (e.compilerExecuted !== true || e.nativeGuestExecuted !== true)
    fail("compiler and actual native guest execution are required");
  if (!Array.isArray(e.executedFixtureIds) || e.executedFixtureIds.length !== 1 ||
      e.executedFixtureIds[0] !== RELATIVE_FIXTURE)
    fail("required scalar fixture must execute explicitly");
  if (typeof e.observedValue !== "number" || e.observedValue !== 42)
    fail("incorrect native guest result");
  sha256(e.testLogSha256, "testLogSha256");
  sha256(e.artifactSha256, "artifactSha256");
}

export function validateFiveBackendEvidenceManifest(manifest) {
  object(manifest, "manifest");
  strictKeys(manifest, ["schema", "fixture", "records"], "manifest");
  if (manifest.schema !== EVIDENCE_SCHEMA) fail("unrecognized schema");
  object(manifest.fixture, "fixture");
  strictKeys(manifest.fixture, ["path", "gitBlobSha", "expectedValue"], "fixture");
  if (manifest.fixture.path !== RELATIVE_FIXTURE ||
      manifest.fixture.gitBlobSha !== EXPECTED_GIT_BLOB ||
      manifest.fixture.expectedValue !== 42) fail("scalar fixture contract mismatch");
  if (!Array.isArray(manifest.records) || manifest.records.length !== BACKENDS.length)
    fail("exactly five backend records required");
  const seen = new Set();
  const blocked = [];
  let claimed = 0;
  for (const record of manifest.records) {
    object(record, "backend record");
    strictKeys(record, ["backend", "status", "reason", "execution"], "backend record");
    if (!BACKENDS.includes(record.backend) || seen.has(record.backend))
      fail("missing, foreign, or duplicate backend");
    seen.add(record.backend);
    if (record.status === "executed-claimed") {
      if (Object.hasOwn(record, "reason")) fail("claimed execution must not have pending reason");
      validateExecution(record.execution, record.backend);
      claimed += 1;
      // This metadata is still unauthenticated. Keep *every* record on the
      // blocked list until an independent controller validates actual GitHub
      // jobs, compiler output, guest execution and artifact bytes.
      blocked.push({backend: record.backend, status: record.status,
        reason: "SELF_REPORTED_EXECUTION_NOT_AUTHENTICATED"});
    } else if (record.status === "pending" || record.status === "unsupported") {
      nonempty(record.reason, "pending/unsupported reason");
      if (Object.hasOwn(record, "execution")) fail("non-execution status cannot supply an execution claim");
      blocked.push({backend: record.backend, status: record.status, reason: record.reason});
    } else fail("unknown backend status");
  }
  // Offline metadata can always be fabricated. In particular, five claimed
  // executions must NEVER turn the "blocked" list empty or an
  // independently-authenticated boolean true. Shape checks only.
  return {status: "EVIDENCE_SHAPE_ONLY_NOT_AUTHENTICATED",
    nativeExecutionAuthenticated: false, parityCertified: false,
    releaseReady: false, authenticatedExecutionCount: 0,
    backendCount: BACKENDS.length, claimedExecutionCount: claimed,
    completeUnverifiedClaimSet: claimed === BACKENDS.length,
    independentlyAuthenticatableClaims: false,
    blocked};
}
