// Structural admission only. This is NOT a cryptographic or CI-provider attestation.
// The caller must independently fetch job steps, compiler/artifact hashes and
// compare source tree under an authenticated, reviewed trust root.
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^(?!0{64}$)[0-9a-f]{64}$/;
const STATUSES = new Set(["NOT_EXECUTED", "EXECUTED", "FAILED", "UNSUPPORTED"]);
const MODES = new Set(["none", "source-org", "authorized-carrier", "synthetic-canary"]);
const BACKENDS = new Set(["java", "llvm", "wasm", "net", "forge"]);
const FIELDS = ["schemaVersion", "backend", "sourceCommit", "sourceTree",
  "sourceProgramSha256", "compilerSha256", "artifactSha256", "status", "execution"];
const EXECUTION_FIELDS = ["jobId", "runnerName", "completedSteps", "kind",
  "guestBinaryRan", "compiledGuestEntrypointRan", "workflowSha256"];

function object(value, fields) {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const keys = Object.keys(value);
    if (keys.length !== fields.length || keys.some(key => !fields.includes(key)))
      return false;
    // Accessors, inherited fields and throwing proxy traps supply no authority.
    return fields.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.hasOwn(descriptor, "value");
    });
  } catch {
    return false;
  }
}
const positive = n => Number.isSafeInteger(n) && n > 0;
const count = n => Number.isSafeInteger(n) && n >= 0;
const hash = (n, kind) => typeof n === "string" && kind.test(n);
const nullableHash = n => n === null || hash(n, HEX64);

function validateGuestAotEvidenceUnchecked(raw, expected = {}) {
  const errors = [];
  // Only data decoded from JSON should be supplied. Never trust receipt claims
  // as proof without out-of-band authenticated job and artifact verification.
  if (!object(raw, FIELDS)) {
    return {ok: false, classification: "INVALID", errors: ["invalid receipt object or fields"]};
  }
  if (raw.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
  if (!BACKENDS.has(raw.backend)) errors.push("unknown backend");
  if (!hash(raw.sourceCommit, HEX40) || !hash(raw.sourceTree, HEX40))
    errors.push("immutable source commit and root tree SHA required");
  for (const field of ["sourceProgramSha256", "compilerSha256", "artifactSha256"])
    if (!nullableHash(raw[field])) errors.push("invalid " + field);
  if (!STATUSES.has(raw.status)) errors.push("invalid status");

  const e = raw.execution;
  if (!object(e, EXECUTION_FIELDS)) {
    errors.push("invalid execution fields");
    return {ok: false, classification: "INVALID", errors};
  }
  if (!(e.jobId === null || positive(e.jobId))) errors.push("invalid jobId");
  if (!(e.runnerName === null || (typeof e.runnerName === "string"
       && e.runnerName.length > 0 && e.runnerName.length <= 160)))
    errors.push("invalid runnerName");
  if (!count(e.completedSteps)) errors.push("invalid completedSteps");
  if (!MODES.has(e.kind)) errors.push("invalid runner kind");
  if (typeof e.guestBinaryRan !== "boolean"
      || typeof e.compiledGuestEntrypointRan !== "boolean")
    errors.push("guest execution fields must be boolean");
  if (!nullableHash(e.workflowSha256)) errors.push("invalid workflowSha256");
  if (expected?.sourceCommit !== undefined && raw.sourceCommit !== expected.sourceCommit)
    errors.push("sourceCommit differs from trusted expected SHA");
  if (expected?.sourceTree !== undefined && raw.sourceTree !== expected.sourceTree)
    errors.push("sourceTree differs from trusted expected tree");
  if (raw.status === "EXECUTED") {
    if (!positive(e.completedSteps) || !positive(e.jobId) || !e.runnerName
        || !["source-org", "authorized-carrier"].includes(e.kind))
      errors.push("executed guest needs actual non-synthetic runner and steps");
    if (!hash(raw.sourceProgramSha256, HEX64)
        || !hash(raw.compilerSha256, HEX64) || !hash(raw.artifactSha256, HEX64)
        || !hash(e.workflowSha256, HEX64))
      errors.push("executed guest needs immutable artifact, compiler, source and workflow hashes");
    if (e.guestBinaryRan !== true || e.compiledGuestEntrypointRan !== true)
      errors.push("executed guest needs program-specific compiled entrypoint witness");
  }
  if (raw.status === "NOT_EXECUTED" || raw.status === "UNSUPPORTED") {
    if (e.completedSteps !== 0 || e.guestBinaryRan !== false
        || e.compiledGuestEntrypointRan !== false || raw.artifactSha256 !== null)
      errors.push("unexecuted or unsupported state cannot carry an executed artifact");
  }
  if (raw.status === "FAILED" && e.completedSteps === 0)
    errors.push("zero-step failure must be NOT_EXECUTED, not implementation FAILED");
  if (e.kind === "synthetic-canary" &&
      (raw.status === "EXECUTED" || e.compiledGuestEntrypointRan === true))
    errors.push("synthetic carrier canary cannot certify actual guest execution");
  return {ok: errors.length === 0,
    classification: errors.length ? "INVALID" :
      raw.status === "EXECUTED" ? "REVIEW_REQUIRED" : raw.status,
    errors};
}

/** Parser-facing boundary: throwing Proxy traps cannot become proof or crash CI. */
export function validateGuestAotEvidence(raw, expected = {}) {
  try {
    return validateGuestAotEvidenceUnchecked(raw, expected);
  } catch {
    return {ok:false,classification:"INVALID",
      errors:["malformed receipt or untrusted reflection trap"]};
  }
}
