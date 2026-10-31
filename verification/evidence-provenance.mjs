const BACKEND_REPOSITORIES = {
  java: "ores-truffle-oreslang/oreslang-source.java",
  llvm: "ores-truffle-oreslang/oreslang-source.llvm",
  net: "ores-truffle-oreslang/oreslang-source.net",
  wasm: "ores-truffle-oreslang/oreslang-source.wasm",
  forge: "ores-truffle-oreslang/oreslang-source.forge"
};
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const positiveInteger = value => Number.isInteger(value) && value > 0;
const nonEmptyString = value => typeof value === "string" && value.trim().length > 0;

function verifyRun(name, entry, run, label, errors) {
  const repository = BACKEND_REPOSITORIES[name];
  if (run?.repository !== repository) errors.push(`${label}: wrong repository`);
  if (!positiveInteger(run?.runId)) errors.push(`${label}: workflow run id required`);
  if (!positiveInteger(run?.runAttempt)) errors.push(`${label}: workflow run attempt required`);
  if (!positiveInteger(run?.jobId)) errors.push(`${label}: workflow job id required`);
  if (!positiveInteger(run?.runnerId)) errors.push(`${label}: assigned runner id required`);
  if (run?.runnerAssigned !== true) errors.push(`${label}: runner assignment required`);
  if (!positiveInteger(run?.executedSteps)) errors.push(`${label}: nonzero executed-step count required`);
  if (run?.conclusion !== "success") errors.push(`${label}: successful conclusion required`);
  if (run?.headSha !== entry?.sourceHead) errors.push(`${label}: workflow head must equal sourceHead`);
  if (run?.compilerSha256 !== entry?.compilerSha256)
    errors.push(`${label}: compiler digest must equal compilerSha256`);
  if (!SHA256.test(run?.stepsSha256 ?? "")) errors.push(`${label}: executed-step metadata SHA-256 required`);
  if (positiveInteger(run?.runId) &&
      run?.runUrl !== `https://github.com/${repository}/actions/runs/${run.runId}`)
    errors.push(`${label}: canonical run URL required`);
  if (positiveInteger(run?.runId) && positiveInteger(run?.jobId) &&
      run?.jobUrl !== `https://github.com/${repository}/actions/runs/${run.runId}/job/${run.jobId}`)
    errors.push(`${label}: canonical job URL required`);
}

function verifyCases(name, contract, entry, errors) {
  const scenarios = contract?.scenarios ?? [];
  const byId = new Map(scenarios.map(s => [s.id, s]));
  const receipts = entry?.caseReceipts;
  if (!Array.isArray(receipts)) {
    errors.push(`${name}: caseReceipts must be an array`);
    return;
  }
  if (receipts.length !== scenarios.length)
    errors.push(`${name}: exactly ${scenarios.length} case receipts required`);

  const seen = new Set();
  for (const receipt of receipts) {
    const scenario = byId.get(receipt?.scenarioId);
    if (!scenario) {
      errors.push(`${name}: unknown case receipt ${receipt?.scenarioId ?? "<missing>"}`);
      continue;
    }
    if (seen.has(scenario.id)) errors.push(`${name}: duplicate case receipt ${scenario.id}`);
    seen.add(scenario.id);

    const label = `${name}/${scenario.id}`;
    if (receipt.kind !== scenario.kind) errors.push(`${label}: wrong semantic kind`);
    if (receipt.result !== "pass") errors.push(`${label}: passing result required`);
    if (receipt.sourceHead !== entry.sourceHead) errors.push(`${label}: source head mismatch`);
    if (receipt.compilerSha256 !== entry.compilerSha256) errors.push(`${label}: compiler digest mismatch`);
    if (receipt.runId !== entry.workflowRun?.runId ||
        receipt.runAttempt !== entry.workflowRun?.runAttempt ||
        receipt.jobId !== entry.workflowRun?.jobId)
      errors.push(`${label}: must bind to workflow run/attempt/job`);
    if (!positiveInteger(receipt.stepNumber)) errors.push(`${label}: executed step number required`);
    if (!nonEmptyString(receipt.stepName)) errors.push(`${label}: executed step name required`);
    if (receipt.guestSourceChecked !== true) errors.push(`${label}: guest source checking required`);
    if (receipt.unsupportedSyntaxOnly === true)
      errors.push(`${label}: unsupported-syntax-only result is not parity evidence`);

    if (scenario.kind === "compile") {
      if (receipt.semanticRejection !== true) errors.push(`${label}: semantic rejection required`);
      if (!nonEmptyString(receipt.diagnosticCategory))
        errors.push(`${label}: stable diagnostic category required`);
      if (receipt.diagnosticCategory === "ORES-SINGLETON-UNSUPPORTED")
        errors.push(`${label}: generic unsupported diagnostic is not semantic proof`);
      if (!SHA256.test(receipt.diagnosticSha256 ?? ""))
        errors.push(`${label}: diagnostic SHA-256 required`);
    } else {
      if (receipt.guestExecuted !== true) errors.push(`${label}: compiled guest execution required`);
      if (!SHA256.test(receipt.guestArtifactSha256 ?? ""))
        errors.push(`${label}: guest artifact SHA-256 required`);
      if (!SHA256.test(receipt.resultSha256 ?? ""))
        errors.push(`${label}: runtime result SHA-256 required`);
      if (name === "wasm" && scenario.id === "table-worker-isolate-shared-identity" &&
          !["worker", "isolate", "both"].includes(receipt.workerIsolateMode))
        errors.push(`${label}: worker/isolate execution mode required`);
    }
  }

  for (const scenario of scenarios)
    if (!seen.has(scenario.id)) errors.push(`${name}: missing case receipt ${scenario.id}`);

  const receiptIds = receipts.map(r => r?.scenarioId).filter(Boolean).sort();
  const executedIds = [...(entry?.executedCaseIds ?? [])].sort();
  if (JSON.stringify(receiptIds) !== JSON.stringify(executedIds))
    errors.push(`${name}: executedCaseIds must exactly match caseReceipts`);
}

function verifySanitizers(name, entry, errors) {
  const receipt = entry?.sanitizerEvidence;
  if (!receipt || typeof receipt !== "object") {
    errors.push(`${name}: sanitizer execution receipt required`);
    return;
  }
  if (receipt.asan !== true || receipt.ubsan !== true)
    errors.push(`${name}: ASan and UBSan must both pass`);
  verifyRun(name, entry, receipt.workflowRun, `${name}: sanitizer`, errors);
}

export function verifyEvidenceProvenance(contract, evidence) {
  const errors = [];
  const promotion = contract?.promotion ?? {};
  for (const key of [
    "perCaseExecutionReceiptsRequired",
    "workflowRunJobIdentityRequired",
    "negativeSemanticDiagnosticsRequired",
    "nativeSanitizerReceiptsRequired"
  ]) {
    if (promotion[key] !== true) errors.push(`${key} must remain true`);
  }

  for (const name of Object.keys(BACKEND_REPOSITORIES)) {
    const entry = evidence?.backends?.[name] ?? {};
    if (entry.status !== "guest-executed") continue;
    if (!SHA40.test(entry.sourceHead ?? "")) errors.push(`${name}: exact source head required`);
    if (!SHA256.test(entry.compilerSha256 ?? "")) errors.push(`${name}: compiler SHA-256 required`);
    verifyRun(name, entry, entry.workflowRun, `${name}: workflow`, errors);
    verifyCases(name, contract, entry, errors);
    if (name === "llvm" || name === "forge") verifySanitizers(name, entry, errors);
  }
  return errors;
}

export function selfTestEvidenceProvenance(contract) {
  const javaRepo = BACKEND_REPOSITORIES.java;
  const sourceHead = "a".repeat(40), compilerSha256 = "b".repeat(64);
  const run = {
    repository: javaRepo, runId: 101, runAttempt: 2, jobId: 303, runnerId: 404,
    runnerAssigned: true, executedSteps: 25, conclusion: "success",
    headSha: sourceHead, compilerSha256, stepsSha256: "c".repeat(64),
    runUrl: `${"https://github.com"}/${javaRepo}/actions/runs/101`,
    jobUrl: `${"https://github.com"}/${javaRepo}/actions/runs/101/job/303`
  };
  const cases = (contract?.scenarios ?? []).map((scenario, index) => ({
    scenarioId: scenario.id, kind: scenario.kind, result: "pass",
    sourceHead, compilerSha256, runId:101, runAttempt:2, jobId:303,
    stepNumber:index + 1, stepName:`scenario ${scenario.id}`,
    guestSourceChecked:true, unsupportedSyntaxOnly:false,
    ...(scenario.kind === "compile" ? {
      semanticRejection:true, diagnosticCategory:`ORES-SEMANTIC-${index}`,
      diagnosticSha256:"d".repeat(64)
    } : {
      guestExecuted:true, guestArtifactSha256:"e".repeat(64), resultSha256:"f".repeat(64)
    })
  }));
  const baseline = {
    contract: contract.contract,
    backends: {java:{
      status:"guest-executed", sourceHead, compilerSha256,
      executedCaseIds:cases.map(c => c.scenarioId), workflowRun:run, caseReceipts:cases
    }}
  };
  const failures = [];
  if (verifyEvidenceProvenance(contract, baseline).length) failures.push("valid provenance baseline");
  const reject = (name, mutate) => {
    const copy = structuredClone(baseline);
    mutate(copy.backends.java);
    if (verifyEvidenceProvenance(contract, copy).length === 0) failures.push(name);
  };
  reject("zero-step provenance", e => { e.workflowRun.executedSteps = 0; });
  reject("unassigned provenance", e => { e.workflowRun.runnerId = 0; });
  reject("missing case receipt", e => { e.caseReceipts.pop(); });
  reject("different job receipt", e => { e.caseReceipts[0].jobId++; });
  reject("generic unsupported diagnostic", e => {
    e.caseReceipts.find(r => r.kind === "compile").diagnosticCategory = "ORES-SINGLETON-UNSUPPORTED";
  });
  if (failures.length) throw new Error("provenance self-test failed: " + failures.join(", "));
}
