// Source-free SHAPE validator. Never authenticates GitHub or awards guest parity.
export const ISOLATION_SCHEMA = "oreslang.actor-isolation.evidence.v1";
export const ISOLATION_FIXTURE = "contracts/v1/actor-isolation/actor-isolation-v1.ores";
export const ISOLATION_BLOB = "2120772dea0e55bff6af95fec059555d9f4ea99b";
export const ISOLATION_BACKENDS = Object.freeze(["java", "llvm", "net", "wasm", "forge", "cranelift"]);
export const ISOLATION_CASES = Object.freeze([
  ["independent_private_state", "guest-runtime"],
  ["foreign_actor_access_denied", "compiler-negative"],
  ["read_loan_blocks_A_mutation_B_progresses", "guest-runtime"],
  ["destroy_A_preserves_B", "guest-and-host"],
  ["stale_handle_after_reclamation_denied", "guest-and-host"],
  ["private_state_scrub_before_physical_free", "host-before-free"]
]);
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
function fail(s) { throw new Error("INVALID_ACTOR_ISOLATION_EVIDENCE: " + s); }
function obj(v, s) {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail(s + " must be object");
  return v;
}
function keys(v, ks, s) {
  obj(v, s);
  for (const k of Object.keys(v)) if (!ks.includes(k)) fail(s + " unexpected key " + k);
  for (const k of ks) if (!Object.hasOwn(v, k)) fail(s + " missing " + k);
}
function hex(v, pattern, name) {
  if (typeof v !== "string" || !pattern.test(v) || /^([0-9a-f])\1+$/.test(v))
    fail(name + " missing or invalid digest");
}
function positive(v, name) {
  if (!Number.isSafeInteger(v) || v < 1) fail(name + " must be positive integer");
}
function distinctExact(actual, expected, name) {
  if (!Array.isArray(actual) || actual.length !== expected.length ||
      new Set(actual).size !== expected.length ||
      expected.some(x => !actual.includes(x))) fail(name + " missing or duplicate entries");
}
function step(s, name) {
  if (typeof s !== "string" || !s.trim() || s.length > 200 ||
      /[\u0000-\u001f\u007f\u2028\u2029]/u.test(s) ||
      /^(?:pre|post)\s|^(?:set up job|complete job|initialize containers)$/i.test(s))
    fail(name + " is not an executable step");
}
// Github's job step summaries are untrusted inputs until independently fetched;
// requiring actual-success-shaped steps limits counterfeit zero-step/skip reports.
function utc(v, name) {
  if (typeof v !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(v) ||
      !Number.isFinite(Date.parse(v)))
    fail(name + " must be an ISO UTC timestamp");
  return Date.parse(v);
}
function executedStep(record, i) {
  keys(record, ["name", "number", "conclusion", "startedAt", "completedAt"],
       "executed step " + i);
  step(record.name, "executed step name");
  positive(record.number, "executed step number");
  if (record.conclusion !== "success") fail("executed step was not successful");
  const start = utc(record.startedAt, "step start");
  const end = utc(record.completedAt, "step end");
  if (end < start) fail("executed step completed before it started");
}
function validateCase(p, expectedId, type) {
  keys(p, ["id", "outcome", "compiler", "guest", "guestAssertions",
           "actors", "violationRejected", "hostBeforeFree"], "case " + expectedId);
  if (p.id !== expectedId || p.outcome !== "pass") fail(expectedId + " failed or skipped");
  if (!Array.isArray(p.actors) || p.actors.length !== 2 || p.actors[0] !== "A" || p.actors[1] !== "B")
    fail(expectedId + " must identify both physical actor instances");
  if (type === "compiler-negative") {
    if (p.compiler !== "rejected-no-ir" || p.guest !== "not-applicable" ||
        p.guestAssertions !== 0 || p.violationRejected !== true ||
        p.hostBeforeFree !== false)
      fail(expectedId + " must reject foreign access before IR emission");
  } else if (type === "host-before-free") {
    if (p.compiler !== "executed" || p.guest !== "executed" ||
        p.guestAssertions < 1 || !Number.isSafeInteger(p.guestAssertions) ||
        p.hostBeforeFree !== true || p.violationRejected !== false)
      fail(expectedId + " lacks pre-free host scrub and live guest evidence");
  } else {
    if (p.compiler !== "executed" || p.guest !== "executed" ||
        !Number.isSafeInteger(p.guestAssertions) || p.guestAssertions < 1 ||
        p.violationRejected !==
          (expectedId === "read_loan_blocks_A_mutation_B_progresses" ||
           expectedId === "stale_handle_after_reclamation_denied") ||
        p.hostBeforeFree !== (type === "guest-and-host"))
      fail(expectedId + " lacks required guest/host isolation evidence");
  }
}
export function validateIsolationManifest(m) {
  keys(m, ["schema", "fixture", "cases", "backends"], "manifest");
  if (m.schema !== ISOLATION_SCHEMA) fail("wrong manifest schema");
  keys(m.fixture, ["path", "gitBlobSha"], "fixture");
  if (m.fixture.path !== ISOLATION_FIXTURE || m.fixture.gitBlobSha !== ISOLATION_BLOB)
    fail("source fixture blob mismatch");
  if (!Array.isArray(m.cases) || m.cases.length !== ISOLATION_CASES.length)
    fail("six canonical cases required");
  ISOLATION_CASES.forEach(([id, evidence], i) => {
    keys(m.cases[i], ["id", "evidence"], "manifest case");
    if (m.cases[i].id !== id || m.cases[i].evidence !== evidence)
      fail("canonical case inventory/order differs");
  });
  if (!Array.isArray(m.backends) || m.backends.length !== ISOLATION_BACKENDS.length)
    fail("six backend records required");
  distinctExact(m.backends.map(x => x.backend), ISOLATION_BACKENDS, "backend inventory");
  for (const r of m.backends) {
    keys(r, ["backend", "status", "reason"], "backend baseline");
    if (r.status !== "pending" ||
        typeof r.reason !== "string" || !r.reason.trim())
      fail("baseline must remain pending and reasoned");
  }
  return {status:"PENDING", guest_runtime_pass:false,
    authenticatedGuestExecutions:0, parityCertified:false};
}
export function validateIsolationClaim(m, e) {
  validateIsolationManifest(m);
  keys(e, ["schema", "backend", "source", "compiler", "ci", "registration",
            "caseResults"], "execution claim");
  if (e.schema !== ISOLATION_SCHEMA || !ISOLATION_BACKENDS.includes(e.backend))
    fail("backend or schema mismatch");
  keys(e.source, ["commit", "tree", "fixtureBlob"], "source");
  hex(e.source.commit, SHA1, "source commit");
  hex(e.source.tree, SHA1, "source tree");
  if (e.source.fixtureBlob !== ISOLATION_BLOB) fail("fixture source mismatch");
  keys(e.compiler, ["sourceCommit", "sourceTree", "binarySha256",
                    "builtFromPinnedCheckout"], "compiler provenance");
  hex(e.compiler.sourceCommit, SHA1, "compiler commit");
  hex(e.compiler.sourceTree, SHA1, "compiler tree");
  hex(e.compiler.binarySha256, SHA256, "compiler executable");
  if (e.compiler.builtFromPinnedCheckout !== true)
    fail("compiler provenance not tied to pinned checkout");
  keys(e.ci, ["workflowPath", "runId", "attempt", "jobId", "runnerId",
               "compilerStep", "guestStep", "executedSteps", "conclusion"], "ci");
  if (typeof e.ci.workflowPath !== "string" ||
      !/^\.github\/workflows\/[A-Za-z0-9._/-]+\.ya?ml$/.test(e.ci.workflowPath) ||
      e.ci.workflowPath.includes("..")) fail("invalid workflow path");
  for (const k of ["runId", "attempt", "jobId", "runnerId"]) positive(e.ci[k], k);
  if (e.ci.conclusion !== "success") fail("workflow did not succeed");
  step(e.ci.compilerStep, "compiler step");
  step(e.ci.guestStep, "guest step");
  if (e.ci.compilerStep === e.ci.guestStep)
    fail("compiler and guest must be distinct CI steps");
  if (!Array.isArray(e.ci.executedSteps) || e.ci.executedSteps.length < 2)
    fail("zero-step CI cannot certify guest execution");
  e.ci.executedSteps.forEach(executedStep);
  const names = e.ci.executedSteps.map(x => x.name);
  const numbers = e.ci.executedSteps.map(x => x.number);
  if (new Set(names).size !== names.length ||
      new Set(numbers).size !== numbers.length ||
      numbers.some((n,i) => i > 0 && n <= numbers[i-1]))
    fail("executed steps must have unique names and ordered step numbers");
  const compilerIndex = names.indexOf(e.ci.compilerStep);
  const guestIndex = names.indexOf(e.ci.guestStep);
  if (compilerIndex < 0 || guestIndex < 0 || compilerIndex >= guestIndex)
    fail("compiler and guest must be distinct, executed, ordered CI steps");
  if (e.ci.executedSteps.some((x,i,steps) =>
       i > 0 && Date.parse(x.startedAt) < Date.parse(steps[i-1].completedAt)))
    fail("CI steps overlap or begin before previous step completed");
  if (Date.parse(e.ci.executedSteps[guestIndex].startedAt) <
      Date.parse(e.ci.executedSteps[compilerIndex].completedAt))
    fail("guest execution began before compiler build completed");
  distinctExact(e.registration, ISOLATION_CASES.map(([id]) => id),
                "test registration");
  if (!Array.isArray(e.caseResults) || e.caseResults.length !== ISOLATION_CASES.length)
    fail("missing guest case results");
  ISOLATION_CASES.forEach(([id, type], i) => validateCase(e.caseResults[i], id, type));
  // A JSON declaration cannot authenticate GitHub runner logs, source objects,
  // compiler bytes, guest traces, or host pre-free instrumentation.
  return {status:"EXECUTION_CLAIM_SHAPE_ONLY_UNAUTHENTICATED",
    compilerProvenanceClaimed:true, guestCasesClaimed:5, compilerNegativesClaimed:1,
    authenticatedGuestExecutions:0, guest_runtime_pass:false, parityCertified:false};
}
