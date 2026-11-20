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
  // Follow exact-run verifier's display-identity rule. GitHub job/runner/step
  // labels containing bidi controls, zero-width formatters, surrogate code
  // points or Unicode separators can impersonate real execution in reports.
  if (typeof v !== "string" || v.trim().length < 1 || v.length > 250 ||
      /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(v))
    fail(name + " must be a visible bounded single-line string");
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
  // Normalization is only for rejecting lifecycle masquerades, never for
  // approving the claim. Trim and ASCII-case-fold like the source verifier's
  // housekeeping exclusion, then reject pre/post and runner lifecycle steps.
  const normalizedStep = e.testStep.normalize("NFKC").trim()
    .replace(/\s+/gu, " ").toLowerCase();
  if (new Set(["set up job", "complete job", "initialize containers",
               "start containers", "stop containers"]).has(normalizedStep) ||
      /^(pre|post)\s/.test(normalizedStep))
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

// Validate an inspected source-free carrier JSON report *without* ever
// upgrading it to source-compiler / native-guest execution evidence.
// ZIP artifact SHA-256, GitHub run identity, logs and actual job allocation
// still require independent authenticated verification outside this function.
export function validateSourceFreeVerifierReceipt(receipt) {
  object(receipt, "source-free report");
  const keys=["schema","repository","carrier_head_sha","carrier_tree_sha",
    "run_id","run_attempt","source_free_only",
    "private_runtime_or_compiler_source_transferred","guest_runtime_certified",
    "source_repository_native_ci_certified","tests_per_round","rounds",
    "expected_total","git_blobs"];
  strictKeys(receipt,keys,"source-free report");
  for(const key of keys)
    if(!Object.hasOwn(receipt,key)) fail("missing source-free report field: "+key);
  const match=/^oreslang\.source_free_ci_verifier_([1-9][0-9]{0,3})\.v1$/.exec(receipt.schema);
  if(!match) fail("unrecognized source-free verifier schema");
  const schemaTests=Number(match[1]);
  positive(receipt.tests_per_round,"tests_per_round");
  positive(receipt.rounds,"rounds");
  positive(receipt.expected_total,"expected_total");
  positive(receipt.run_id,"run_id");
  positive(receipt.run_attempt,"run_attempt");
  if(receipt.rounds>12 || receipt.tests_per_round!==schemaTests ||
     receipt.expected_total!==receipt.rounds*receipt.tests_per_round)
    fail("source-free report has stale or inconsistent execution totals");
  nonempty(receipt.repository,"source-free carrier repository");
  sha1(receipt.carrier_head_sha,"carrier_head_sha");
  sha1(receipt.carrier_tree_sha,"carrier_tree_sha");
  if(receipt.source_free_only!==true ||
     receipt.private_runtime_or_compiler_source_transferred!==false ||
     receipt.guest_runtime_certified!==false ||
     receipt.source_repository_native_ci_certified!==false)
    fail("source-free receipt contains native certification or source-transfer claim");
  object(receipt.git_blobs,"source-free pinned blobs");
  const blobNames=["scripts/verify_ci_run.py","scripts/test_verify_ci_run.py",
    ".github/workflows/ci-run-evidence-contract.yml"];
  strictKeys(receipt.git_blobs,blobNames,"source-free pinned blobs");
  for(const name of blobNames){
    if(!Object.hasOwn(receipt.git_blobs,name))
      fail("source-free receipt missing exact input blob: "+name);
    sha1(receipt.git_blobs[name],name);
  }
  return {status:"SOURCE_FREE_RECEIPT_SHAPE_ONLY_NOT_AUTHENTICATED",
    regressionExecutionsClaimed:receipt.expected_total,
    authenticatedExecutionCount:0, nativeExecutionAuthenticated:false,
    parityCertified:false, releaseReady:false, externalVerificationRequired:true};
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
