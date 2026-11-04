const BACKENDS = new Map([
  ["java", "ores-truffle-oreslang/oreslang-source.java"],
  ["llvm", "ores-truffle-oreslang/oreslang-source.llvm"],
  ["wasm", "ores-truffle-oreslang/oreslang-source.wasm"],
  ["forge", "ores-truffle-oreslang/oreslang-source.forge"],
  ["net", "ores-truffle-oreslang/oreslang-source.net"]
]);
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

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
      if (!v || !/^FS-(0[1-9]|1[0-4])$/.test(v.id) ||
          !["read", "write", "size", "rest"].includes(v.kind) ||
          !["accept", "reject", "deny", "accept-or-deny", "accept-or-reject"].includes(v.expected) ||
          cases.has(v.id)) {
        fail("invalid or duplicate FS vector");
      } else cases.add(v.id);
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
