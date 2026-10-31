import fs from "node:fs";
import { verifyEvidenceProvenance, selfTestEvidenceProvenance } from "./evidence-provenance.mjs";

const REQUIRED_BACKENDS = ["java", "llvm", "net", "wasm", "forge"];
const ALLOWED_STATUS = new Set(["pending-guest", "host-foundation-only", "guest-executed"]);
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function verify(contract, evidence) {
  const errors = [];
  if (contract?.contract !== "singleton-shared-state-v1") errors.push("wrong contract id");
  if (evidence?.contract !== contract?.contract) errors.push("evidence contract mismatch");

  const targets = [...(contract?.backendTargets ?? [])].sort();
  if (JSON.stringify(targets) !== JSON.stringify([...REQUIRED_BACKENDS].sort()))
    errors.push("backendTargets must be exactly java, llvm, net, wasm, forge");

  const scenarios = contract?.scenarios ?? [];
  const ids = scenarios.map(x => x.id);
  if (ids.length < 20) errors.push("contract must retain the full v1 scenario floor");
  if (new Set(ids).size !== ids.length) errors.push("duplicate scenario id");
  for (const scenario of scenarios) {
    if (!scenario.id || !["compile", "runtime"].includes(scenario.kind))
      errors.push(`invalid scenario: ${scenario?.id ?? "<missing>"}`);
    if (!Array.isArray(scenario.requires) || scenario.requires.length === 0)
      errors.push(`scenario has no requirements: ${scenario?.id ?? "<missing>"}`);
  }

  const promotion = contract?.promotion ?? {};
  for (const key of [
    "hostUnitTestsAloneSufficient",
    "zeroStepActionRunCountsAsEvidence",
    "unsupportedSyntaxRejectionCountsAsSafetyPass",
    "unsupportedSyntaxRejectionCountsAsParityPass"
  ]) {
    if (promotion[key] !== false) errors.push(`${key} must remain false`);
  }
  for (const key of [
    "guestSourceCheckingRequired",
    "guestSourceExecutionRequired",
    "identicalScenarioIdsAcrossFiveBackends",
    "exactHeadRequired",
    "compilerExecutableSha256Required",
    "runnerAssignmentRequired",
    "executedJobStepsRequired"
  ]) {
    if (promotion[key] !== true) errors.push(`${key} must remain true`);
  }

  const backends = evidence?.backends ?? {};
  const evidenceNames = Object.keys(backends).sort();
  if (JSON.stringify(evidenceNames) !== JSON.stringify([...REQUIRED_BACKENDS].sort()))
    errors.push("evidence must contain exactly five backends");

  for (const name of REQUIRED_BACKENDS) {
    const entry = backends[name] ?? {};
    if (!ALLOWED_STATUS.has(entry.status)) errors.push(`${name}: invalid status`);
    const executed = entry.executedCaseIds ?? [];
    if (!Array.isArray(executed)) {
      errors.push(`${name}: executedCaseIds must be an array`);
      continue;
    }
    for (const id of executed) if (!ids.includes(id)) errors.push(`${name}: unknown case ${id}`);
    if (entry.status !== "guest-executed" && executed.length !== 0)
      errors.push(`${name}: non-guest status cannot contain executedCaseIds`);

    for (const field of ["hostFoundationCaseIds", "sourceLocalUnexecutedCaseIds"]) {
      const cases = entry[field];
      if (cases === undefined) continue;
      if (!Array.isArray(cases)) {
        errors.push(`${name}: ${field} must be an array`);
        continue;
      }
      if (new Set(cases).size !== cases.length)
        errors.push(`${name}: duplicate ${field}`);
      for (const id of cases) {
        if (!ids.includes(id)) errors.push(`${name}: unknown ${field} case ${id}`);
        if (executed.includes(id))
          errors.push(`${name}: ${field} case ${id} cannot also be executed`);
      }
    }

    if (entry.status === "guest-executed") {
      if (!SHA40.test(entry.sourceHead ?? "")) errors.push(`${name}: exact source head required`);
      if (!SHA256.test(entry.compilerSha256 ?? "")) errors.push(`${name}: compiler SHA-256 required`);
      if (entry.unsupportedSyntaxOnly === true) errors.push(`${name}: unsupported syntax is not guest evidence`);
      const run = entry.workflowRun ?? {};
      if (run.runnerAssigned !== true) errors.push(`${name}: runner assignment required`);
      if (!Number.isInteger(run.executedSteps) || run.executedSteps < 1)
        errors.push(`${name}: at least one executed job step required`);
      const missing = ids.filter(id => !executed.includes(id));
      if (missing.length) errors.push(`${name}: missing executed cases: ${missing.join(",")}`);
      if (name === "wasm" && entry.crossWorkerOrIsolateExecuted !== true)
        errors.push("wasm: cross-worker/isolate execution required");
      if ((name === "llvm" || name === "forge") && entry.sanitizersPassed !== true)
        errors.push(`${name}: ASan/UBSan evidence required`);
    }
  }

  errors.push(...verifyEvidenceProvenance(contract, evidence));

  if (evidence?.conformant === true &&
      REQUIRED_BACKENDS.some(name => backends[name]?.status !== "guest-executed"))
    errors.push("conformant=true requires guest-executed evidence for all five backends");

  return errors;
}

function load(path) { return JSON.parse(fs.readFileSync(path, "utf8")); }

function selfTest(contract, evidence) {
  const failures = [];
  const expectReject = (name, mutate) => {
    const c = structuredClone(contract), e = structuredClone(evidence);
    mutate(c, e);
    if (verify(c, e).length === 0) failures.push(name);
  };
  expectReject("zero-step evidence", (_c, e) => {
    e.backends.java = {
      status:"guest-executed", sourceHead:"a".repeat(40), compilerSha256:"b".repeat(64),
      executedCaseIds:contract.scenarios.map(x => x.id),
      workflowRun:{runnerAssigned:true, executedSteps:0}
    };
  });
  expectReject("unsupported-only evidence", (_c, e) => {
    e.backends.java = {
      status:"guest-executed", sourceHead:"a".repeat(40), compilerSha256:"b".repeat(64),
      executedCaseIds:contract.scenarios.map(x => x.id),
      unsupportedSyntaxOnly:true, workflowRun:{runnerAssigned:true, executedSteps:2}
    };
  });
  expectReject("partial case evidence", (_c, e) => {
    e.backends.java = {
      status:"guest-executed", sourceHead:"a".repeat(40), compilerSha256:"b".repeat(64),
      executedCaseIds:[contract.scenarios[0].id],
      workflowRun:{runnerAssigned:true, executedSteps:2}
    };
  });
  expectReject("host foundation smuggled as executed", (_c, e) => {
    e.backends.forge.executedCaseIds = [contract.scenarios[0].id];
  });
  expectReject("unknown source-local case", (_c, e) => {
    e.backends.forge.sourceLocalUnexecutedCaseIds = ["not-a-contract-case"];
  });
  expectReject("false five-backend conformance", (_c, e) => { e.conformant = true; });
  selfTestEvidenceProvenance(contract);
  if (failures.length) throw new Error("self-test failed to reject: " + failures.join(", "));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const contractPath = process.argv[2] ?? "contracts/singleton-shared-state-v1.json";
  const evidencePath = process.argv[3] ?? "evidence/singleton-shared-state-v1.json";
  const contract = load(contractPath), evidence = load(evidencePath);
  const errors = verify(contract, evidence);
  if (errors.length) {
    for (const error of errors) console.error("ERROR:", error);
    process.exit(1);
  }
  selfTest(contract, evidence);
  console.log(`PASS: ${contract.scenarios.length} singleton/shared-state scenarios; five-backend evidence policy is fail-closed`);
}
