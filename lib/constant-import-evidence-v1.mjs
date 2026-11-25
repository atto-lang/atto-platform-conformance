// Structural review gate only: no source-free or self-authored receipt
// can independently authenticate real GitHub runner steps or release parity.
// Always fetch source/tree, workflow steps and binary hashes from trusted APIs.
function evaluateConstantImportEvidence(registry, receipt, trusted) {
  const summary = (classification, issues = []) => ({
    classification, structurallyValid: issues.length === 0,
    releaseQualified: false, guestParityCertified: false, issues
  });
  try {
    if (!receipt) return summary("NOT_EXECUTED");
    const obj = x => x !== null && typeof x === "object" &&
      !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
    const sha40 = x => typeof x === "string" && /^[a-f0-9]{40}$/.test(x);
    const sha64 = x => typeof x === "string" && /^[a-f0-9]{64}$/.test(x) && !/^0+$/.test(x);
    const positive = x => Number.isSafeInteger(x) && x > 0;
    if (!obj(registry) || !obj(registry.backend_status) || !Array.isArray(registry.cases)
        || !obj(receipt) || !obj(trusted)) return summary("INVALID", ["malformed registry, receipt or trust selector"]);
    if (registry.schema !== "atto.constant-imports.v1"
        || !Object.hasOwn(registry.backend_status, receipt.backend)
        || receipt.schema !== "atto.constant-import-evidence.v1"
        || receipt.status !== "EXECUTED") return summary("INVALID", ["invalid schema, backend or claimed status"]);
    if (!sha40(receipt.sourceCommit) || !sha40(receipt.sourceTree)
        || !sha64(receipt.compilerSha256) || !sha40(trusted.sourceCommit)
        || !sha40(trusted.sourceTree) || !positive(trusted.jobId)) {
      return summary("INVALID", ["missing exact source/compiler provenance or independently selected job"]);
    }
    if (receipt.sourceCommit !== trusted.sourceCommit ||
        receipt.sourceTree !== trusted.sourceTree) return summary("SOURCE_MISMATCH", ["candidate head/tree differs from trusted selector"]);
    const job = receipt.job;
    if (!obj(job) || !positive(job.id) || job.id !== trusted.jobId ||
        typeof job.runner !== "string" || !job.runner || job.runner.length > 160 ||
        !["source-org","authorized-carrier"].includes(job.mode) ||
        job.sourceFree !== false || !Array.isArray(job.steps) ||
        !job.steps.length || !job.steps.every(s => obj(s) &&
          typeof s.name === "string" && typeof s.conclusion === "string")) {
      return summary("NOT_EXECUTED", ["no authenticated material source-bearing runner step sequence"]);
    }
    const succeeded = job.steps.filter(s => s.conclusion === "success");
    if (job.steps.some(s => s.conclusion !== "success") ||
        !["checkout","compile","guest"].every(phase => succeeded.some(s => s.name === phase))) {
      return summary("NOT_EXECUTED", ["required checkout, compilation and guest steps were not all executed successfully"]);
    }
    if (!Array.isArray(receipt.cases) || receipt.cases.length !== registry.cases.length)
      return summary("INCOMPLETE", ["all versioned conformance cases need individual receipts"]);
    const got = new Map();
    for (const x of receipt.cases) {
      if (!obj(x) || typeof x.id !== "string" || got.has(x.id))
        return summary("INVALID", ["malformed or duplicate case receipt"]);
      got.set(x.id, x);
    }
    const issues = [];
    for (const expected of registry.cases) {
      const actual = got.get(expected.id);
      if (!actual) { issues.push("missing: " + expected.id); continue; }
      if (actual.status !== "EXECUTED" || !Number.isSafeInteger(actual.compileExit) ||
          !Number.isSafeInteger(actual.emittedArtifacts) ||
          typeof actual.guestEntrypointRan !== "boolean") {
        issues.push("unexecuted or malformed: " + expected.id); continue;
      }
      if (expected.kind === "pass") {
        if (actual.compileExit !== 0 || actual.emittedArtifacts < 1 ||
            !sha64(actual.artifactSha256) || actual.guestEntrypointRan !== true ||
            actual.guestReturn !== expected.expected_return ||
            actual.diagnosticCode !== null)
          issues.push("compiled guest did not prove expected return: " + expected.id);
        if (expected.reuse_compiled_artifact) {
          if (!Array.isArray(actual.startups) || actual.startups.length !== expected.startups.length
              || actual.startups.some((launch, idx) =>
                !obj(launch) || launch.artifactSha256 !== actual.artifactSha256 ||
                launch.guestReturn !== expected.startups[idx].expected_return ||
                launch.guestEntrypointRan !== true)) {
            issues.push("same compiled AOT artifact not proven across separate launches: " + expected.id);
          }
        }
        if (expected.expected_initializer_invocations) {
          if (!obj(actual.initializerInvocations) ||
              JSON.stringify(Object.entries(actual.initializerInvocations).sort()) !==
              JSON.stringify(Object.entries(expected.expected_initializer_invocations).sort()))
            issues.push("per-declaration startup counts not proven: " + expected.id);
        }
      } else if (expected.kind === "fail") {
        if (actual.compileExit === 0 || actual.emittedArtifacts !== 0 ||
            actual.artifactSha256 !== null || actual.guestEntrypointRan ||
            actual.diagnosticCode !== expected.expected_error)
          issues.push("negative compiled without expected diagnostic/zero-artifact proof: " + expected.id);
      } else issues.push("unknown case kind: " + expected.id);
    }
    if (got.size !== registry.cases.length) issues.push("unknown case receipts");
    if (issues.length) return summary("INCOMPLETE", issues);
    return summary("STRUCTURAL_REVIEW_REQUIRED");
  } catch {
    return summary("INVALID", ["invalid data/proxy/accessor in untrusted receipt"]);
  }
}

export { evaluateConstantImportEvidence };
