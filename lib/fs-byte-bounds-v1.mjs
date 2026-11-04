const BACKENDS = new Map([
  ["java", "ores-truffle-oreslang/oreslang-source.java"],
  ["llvm", "ores-truffle-oreslang/oreslang-source.llvm"],
  ["wasm", "ores-truffle-oreslang/oreslang-source.wasm"],
  ["forge", "ores-truffle-oreslang/oreslang-source.forge"],
  ["net", "ores-truffle-oreslang/oreslang-source.net"]
]);
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
// Pin every vector's meaning, not only its identifier; no silent case substitution.
const REQUIRED_FS_VECTORS = new Map([
  ["FS-01", ["read", "utf8-six-byte-exact", "accept"]],
  ["FS-02", ["read", "utf8-five-byte-overflow", "reject"]],
  ["FS-03", ["read", "empty-file-zero-budget", "accept"]],
  ["FS-04", ["read", "malformed-utf8", "reject"]],
  ["FS-05", ["read", "out-of-scope-existing-and-missing", "deny"]],
  ["FS-06", ["read", "leaf-symlink-escape", "deny"]],
  ["FS-07", ["read", "parent-symlink-escape", "deny"]],
  ["FS-08", ["read", "directory-not-file", "reject"]],
  ["FS-09", ["read", "concurrent-growth-above-limit", "reject"]],
  ["FS-10", ["read", "max-limit-out-of-range", "reject"]],
  ["FS-11", ["write", "out-of-scope-existing-and-missing-parent", "deny"]],
  ["FS-12", ["write", "parent-symlink-out-of-scope", "deny"]],
  ["FS-13", ["size", "byte-count-and-permission-before-probe", "accept-or-deny"]],
  ["FS-14", ["rest", "exact-1mib-and-oversized-persisted-get-patch", "accept-or-reject"]]
]);

/**
 * A bounded, source-free SHAPE validator. It does not call GitHub, confirm
 * actual test execution, authenticate SHA provenance or certify parity.
 */
export function auditFsByteBoundsContract(input) {
  const errors = [];
  const fail = (message) => errors.push(message);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["invalid contract object"], evidenceClass: "shape-only", runtimeParityCertified: false };
  }
  if (input.schema !== "attolang.fs-byte-bounds/1") fail("wrong schema");
  if (input.status !== "normative_candidate_not_backend_execution_evidence") fail("wrong evidence class");
  const backends = input.backends;
  if (!Array.isArray(backends) || backends.length !== 5) {
    fail("requires exactly five backends");
  } else {
    const seen = new Set();
    for (const backend of backends) {
      if (!backend || !BACKENDS.has(backend.id) || seen.has(backend.id)) {
        fail("unknown or duplicate backend");
        continue;
      }
      seen.add(backend.id);
      if (backend.repo !== BACKENDS.get(backend.id)) fail("backend repository mismatch");
      if (!["unverified", "supported", "unsupported-verified"].includes(backend.status)) {
        fail("unknown backend state");
      }
      if (backend.status === "unverified") {
        if (backend.receipt !== null) fail("unverified backend must not carry a success receipt");
      } else {
        const r = backend.receipt;
        if (!r || !SHA40.test(r.sourceCommit ?? "") || !SHA40.test(r.sourceTree ?? "")) {
          fail("backend claim missing exact source commit/tree");
        }
        if (!r || !SHA256.test(r.compilerArtifactSha256 ?? "")) {
          fail("backend claim missing compiler digest");
        }
        if (!r || r.repository !== backend.repo ||
            !Number.isSafeInteger(r.runId) || r.runId < 1 ||
            !Number.isSafeInteger(r.runAttempt) || r.runAttempt < 1 ||
            !Number.isSafeInteger(r.jobId) || r.jobId < 1 ||
            r.runUrl !== `https://github.com/${backend.repo}/actions/runs/${r.runId}`) {
          fail("backend claim needs source-local run and job identity");
        }
        if (!r || !Number.isSafeInteger(r.executedSteps) || r.executedSteps < 1) {
          fail("backend claim requires nonzero executed steps");
        }
        if (backend.status === "supported" &&
            (!r || r.actualCompiledGuest !== true || r.staticOnly === true)) {
          fail("supported backend claim needs executed compiled guest evidence");
        }
        if (backend.status === "unsupported-verified" &&
            (!r || r.realCompilerInvoked !== true ||
             r.explicitRejection !== true || r.noEmittedArtifact !== true)) {
          fail("unsupported backend must prove executed fail-closed compiler rejection");
        }
      }
    }
    if (seen.size !== 5) fail("missing a required backend");
  }
  const vectors = input.vectors;
  if (!Array.isArray(vectors) || vectors.length !== 14) {
    fail("requires all fourteen bounded-FS vectors");
  } else {
    const cases = new Set();
    for (const v of vectors) {
      if (!v || !REQUIRED_FS_VECTORS.has(v.id) || cases.has(v.id)) {
        fail("invalid or duplicate FS vector");
        continue;
      }
      cases.add(v.id);
      const [kind, caseName, expectation] = REQUIRED_FS_VECTORS.get(v.id);
      if (v.kind !== kind || v.case !== caseName || v.expected !== expectation)
        fail("FS vector semantic identity mismatch: " + v.id);
      const ancestor = ["FS-07", "FS-12", "FS-13"].includes(v.id);
      const permittedKeys = ancestor
        ? ["id", "kind", "case", "expected", "ancestorSymlinkCases", "denialPhase"]
        : ["id", "kind", "case", "expected"];
      if (Object.keys(v).sort().join(",") !== permittedKeys.sort().join(","))
        fail("unexpected or missing FS vector fields: " + v.id);
      if (ancestor &&
          (!Array.isArray(v.ancestorSymlinkCases) ||
           v.ancestorSymlinkCases.length !== 2 ||
           v.ancestorSymlinkCases[0] !== "existing" ||
           v.ancestorSymlinkCases[1] !== "missing" ||
           v.denialPhase !== "before-canonical-resolution"))
        fail("symlink ancestor vectors must reject existing and missing before resolution");
    }
  }
  if (input.api?.read !== "fs.read_text_bounded_async(String path, int max_bytes) -> Future<String>" ||
      input.api?.write !== "fs.write_text_atomic_async(String path, String value) -> Future<void>" ||
      input.api?.size !== "fs.file_size_async(String path) -> Future<int>" ||
      input.api?.canonicalBlockingSuffix !== "_blocking" ||
      input.api?.optionalAsyncSuffix !== "_async") fail("filesystem API naming contract mismatch");
  if (input.bounds?.maxReadBytes !== 16777216 ||
      input.bounds?.restResourceBytes !== 1048576 ||
      input.bounds?.strictUtf8 !== true ||
      input.bounds?.noPartialOutputOnRejectedRead !== true) fail("byte-bound or UTF-8 contract mismatch");
  if (input.authority?.lexicalScopeBeforeAnyProbe !== true ||
      input.authority?.canonicalScopeCheck !== true ||
      input.authority?.rejectLeafSymlink !== true ||
      input.authority?.requireRegularFile !== true ||
      input.authority?.followSymlinks !== false ||
      input.authority?.rejectAncestorSymlinkBeforeCanonicalResolution !== true ||
      input.authority?.parentSymlinkExistingMissingDenyEqually !== true ||
      input.authority?.readSameOpenedDescriptor !== true ||
      input.authority?.boundStreamingWhileFileGrows !== true ||
      input.authority?.snapshotConsistencyClaimed !== false ||
      input.authority?.parentRenameRaceEliminated !== false) fail("filesystem authority or residual-race claim mismatch");
  if (input.evidencePolicy?.requireStepfulExactHeadHostRunner !== true ||
      input.evidencePolicy?.requireSourceCommitSha40 !== true ||
      input.evidencePolicy?.requireSourceTreeSha40 !== true ||
      input.evidencePolicy?.requireCompilerArtifactSha256 !== true ||
      input.evidencePolicy?.minimumExecutedSteps !== 1 ||
      input.evidencePolicy?.requireActualCompiledGuest !== true ||
      input.evidencePolicy?.prohibitStaticOrHostOnlyPromotion !== true ||
      input.evidencePolicy?.privateSourceTransferAllowedByThisContract !== false) {
    fail("unsafe evidence promotion or private source export policy");
  }
  if (input.certification?.fiveBackendRuntimeParity !== false ||
      input.certification?.independentlyVerified !== false) {
    fail("shape-only contract may never claim independent backend parity");
  }
  return { ok: errors.length === 0, errors, evidenceClass: "shape-only", runtimeParityCertified: false };
}
