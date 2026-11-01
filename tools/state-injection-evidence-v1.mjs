// Structural intake gate only. A receipt is NEVER compiler/runtime proof by
// itself; reviewers must corroborate compiler SHA, runner steps and raw logs.
import { createHash } from "node:crypto";

export function sourceSha256(source) {
  return createHash("sha256").update(Buffer.from(source, "utf8")).digest("hex");
}

export function assessInjectedStateReceipt(contract, backend, receipt) {
  const failures = [];
  if (!contract.requiredBackends.includes(backend) &&
      !contract.optionalBackends.includes(backend)) {
    return { structurallyEligible: false, classification: "unverified", failures: ["unknown backend"] };
  }
  if (!receipt || typeof receipt !== "object") {
    return { structurallyEligible: false, classification: "unverified", failures: ["missing receipt"] };
  }
  if (receipt.backend !== backend) failures.push("backend mismatch");
  if (!/^[0-9a-f]{40}$/.test(receipt.compilerCommit ?? "")) {
    failures.push("compiler head must be exact SHA");
  }
  if (!Number.isSafeInteger(receipt.runId) || receipt.runId <= 0 ||
      !Number.isSafeInteger(receipt.buildSteps) || receipt.buildSteps <= 0 ||
      !Number.isSafeInteger(receipt.compileSteps) || receipt.compileSteps <= 0 ||
      !Number.isSafeInteger(receipt.guestRunSteps) || receipt.guestRunSteps <= 0) {
    failures.push("missing stepful native build/compile/run evidence");
  }
  if (!Array.isArray(receipt.cases)) {
    failures.push("missing per-source case results");
  } else {
    const observed = new Map();
    for (const outcome of receipt.cases) {
      if (!outcome || typeof outcome.id !== "string" || observed.has(outcome.id)) {
        failures.push("duplicate or malformed source case");
        continue;
      }
      observed.set(outcome.id, outcome);
    }
    if (observed.size !== contract.cases.length) {
      failures.push("wrong number of source cases");
    }
    for (const expected of contract.cases) {
      const actual = observed.get(expected.id);
      if (!actual) { failures.push("missing case " + expected.id); continue; }
      if (actual.sourceSha256 !== sourceSha256(expected.source)) {
        failures.push("source bytes differ " + expected.id);
      }
      if (actual.kind !== expected.kind) {
        failures.push("wrong case kind " + expected.id);
      }
      if (expected.kind === "compile-and-run") {
        if (actual.compileExitCode !== 0 || actual.runExitCode !== expected.expected.exitCode ||
            actual.stdout !== expected.expected.stdout || actual.unsupported === true) {
          failures.push("positive guest was not executed successfully " + expected.id);
        }
      } else {
        // A parser failure or a blanket "unsupported" is not a successful
        // semantic violation test after the positive language is admitted.
        if (!Number.isInteger(actual.compileExitCode) || actual.compileExitCode === 0 ||
            actual.diagnosticClass !== expected.violation ||
            actual.rejectionPhase !== "semantic" ||
            actual.emittedArtifacts !== 0 || actual.guestExecuted === true) {
          failures.push("negative compiler-owned denial not established " + expected.id);
        }
      }
    }
    for (const id of observed.keys()) {
      if (!contract.cases.some(c => c.id === id)) failures.push("unexpected case " + id);
    }
  }
  return {
    structurallyEligible: failures.length === 0,
    classification: "receipt-shape-only-not-verified-parity",
    failures
  };
}
