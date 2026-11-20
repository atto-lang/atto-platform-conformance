import fs from "node:fs";

const REQUIRED_BACKENDS = ["java", "llvm", "net", "wasm", "forge"];
const ALLOWED_STATUS = new Set(["pending-guest", "host-foundation-only", "guest-partial", "guest-executed"]);
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FROZEN_V1_SCENARIOS = [
  {
    "id": "singleton-concurrent-first-access-once",
    "kind": "runtime",
    "requires": [
      "one-initializer",
      "complete-publication",
      "same-identity"
    ]
  },
  {
    "id": "singleton-sticky-initializer-failure",
    "kind": "runtime",
    "requires": [
      "one-attempt",
      "same-failure",
      "no-partial-publication"
    ]
  },
  {
    "id": "singleton-direct-initialization-cycle",
    "kind": "runtime",
    "requires": [
      "deterministic-cycle-error",
      "no-deadlock",
      "no-partial-publication"
    ]
  },
  {
    "id": "singleton-cross-task-initialization-cycle",
    "kind": "runtime",
    "requires": [
      "deterministic-cycle-error",
      "finite-completion",
      "no-partial-publication"
    ]
  },
  {
    "id": "singleton-import-alias-same-identity",
    "kind": "runtime",
    "requires": [
      "module-identity",
      "one-cell"
    ]
  },
  {
    "id": "singleton-domain-isolation",
    "kind": "runtime",
    "requires": [
      "distinct-domain-identity",
      "no-raw-cross-domain-authority"
    ]
  },
  {
    "id": "singleton-prepublication-self-escape",
    "kind": "compile",
    "requires": [
      "semantic-rejection",
      "stable-diagnostic-category"
    ]
  },
  {
    "id": "singleton-mutable-alias-publication",
    "kind": "compile",
    "requires": [
      "deep-immutability-check",
      "semantic-rejection"
    ]
  },
  {
    "id": "singleton-cancel-shutdown-no-duplicate-incarnation",
    "kind": "runtime",
    "requires": [
      "no-late-publication",
      "no-second-initializer",
      "finite-shutdown"
    ]
  },
  {
    "id": "table-caller-identity-not-guest-forgeable",
    "kind": "runtime",
    "requires": [
      "runtime-derived-caller",
      "opaque-incarnation-authority",
      "ffi-cannot-mint-context"
    ]
  },
  {
    "id": "table-stale-actor-incarnation-rejected",
    "kind": "runtime",
    "requires": [
      "restart-fence",
      "stale-capability-denied",
      "fresh-incarnation-no-implicit-authority"
    ]
  },
  {
    "id": "table-private-protected-public-rights",
    "kind": "runtime",
    "requires": [
      "private-owner-only",
      "protected-read-delegation",
      "public-explicit-delegation"
    ]
  },
  {
    "id": "table-concurrent-counter-exact",
    "kind": "runtime",
    "requires": [
      "linearizable-update",
      "checked-overflow",
      "no-lost-update"
    ]
  },
  {
    "id": "table-insert-new-single-winner",
    "kind": "runtime",
    "requires": [
      "one-winner",
      "linearizable-insert"
    ]
  },
  {
    "id": "table-cas-single-winner",
    "kind": "runtime",
    "requires": [
      "one-winner",
      "linearizable-cas"
    ]
  },
  {
    "id": "table-capacity-failure-preserves-contents",
    "kind": "runtime",
    "requires": [
      "bounded-slots",
      "no-partial-mutation"
    ]
  },
  {
    "id": "table-overflow-failure-preserves-value",
    "kind": "runtime",
    "requires": [
      "checked-i64",
      "no-partial-mutation"
    ]
  },
  {
    "id": "table-owner-retirement-revokes-access",
    "kind": "runtime",
    "requires": [
      "automatic-owner-lifecycle-registration",
      "bounded-lifecycle-resource-registry",
      "close-restart-destruction-retire-owned-tables",
      "inflight-operation-linearization"
    ]
  },
  {
    "id": "table-replacement-rejects-stale-capability",
    "kind": "runtime",
    "requires": [
      "table-generation-identity",
      "no-authority-resurrection"
    ]
  },
  {
    "id": "table-worker-isolate-shared-identity",
    "kind": "runtime",
    "requires": [
      "cross-worker-or-isolate-proof",
      "not-process-global-only",
      "same-domain-ordering-documented"
    ]
  }
];
const FROZEN_V1_SEMANTICS = {
  "singletonIdentityScope": "application-domain",
  "initialization": "exactly-once-complete-publication",
  "initializationFailure": "sticky",
  "mutableSharedState": "capability-checked-bounded-table",
  "callerIdentity": "runtime-derived-opaque-actor-incarnation",
  "tableAtomicity": "single-operation-linearizable",
  "staleAuthority": "must-not-authorize-replacement-or-restarted-actor",
  "singletonDeclarationIdentity": "compiler-resolved-module-and-declaration-id-not-guest-supplied"
};


export function verify(contract, evidence) {
  const errors = [];
  if (contract?.contract !== "singleton-shared-state-v1") errors.push("wrong contract id");
  if (evidence?.contract !== contract?.contract) errors.push("evidence contract mismatch");

  if (contract?.schemaVersion !== 1 || evidence?.schemaVersion !== 1)
    errors.push("singleton v1 schemaVersion must be 1");
  const targets = [...(contract?.backendTargets ?? [])].sort();
  if (JSON.stringify(targets) !== JSON.stringify([...REQUIRED_BACKENDS].sort()))
    errors.push("backendTargets must be exactly java, llvm, net, wasm, forge");

  const scenarios = contract?.scenarios ?? [];
  const ids = scenarios.map(x => x.id);
  if (ids.length !== 20) errors.push("contract must contain exactly 20 v1 cases");
  if (new Set(ids).size !== ids.length) errors.push("duplicate scenario id");
  for (const scenario of scenarios) {
    if (!scenario.id || !["compile", "runtime"].includes(scenario.kind))
      errors.push(`invalid scenario: ${scenario?.id ?? "<missing>"}`);
    if (!Array.isArray(scenario.requires) || scenario.requires.length === 0)
      errors.push(`scenario has no requirements: ${scenario?.id ?? "<missing>"}`);
  }

  // Treat v1 as a fixed semantic floor, not a mutable list of 20 arbitrary cases.
  if (JSON.stringify(scenarios) !== JSON.stringify(FROZEN_V1_SCENARIOS))
    errors.push("frozen v1 scenario ids, kinds and requirements changed");
  if (JSON.stringify(contract?.semantics) !== JSON.stringify(FROZEN_V1_SEMANTICS))
    errors.push("frozen v1 semantic contract changed");

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
    "executedJobStepsRequired",
    "wasmWorkerOrIsolateExecutionRequired",
    "noSleepBasedRaceProof"
  ]) {
    if (promotion[key] !== true) errors.push(`${key} must remain true`);
  }

  if (JSON.stringify([...(promotion.sanitizerPassRequiredForNativeBackends ?? [])].sort()) !==
      JSON.stringify(["forge", "llvm"]))
    errors.push("native LLVM and Forge sanitizer gates must be retained");

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
    if (new Set(executed).size !== executed.length)
      errors.push(`${name}: duplicate executed case id`);
    if (["pending-guest", "host-foundation-only"].includes(entry.status) && executed.length !== 0)
      errors.push(`${name}: pending/host-only backend cannot claim executed guest cases`);
    if (entry.status === "host-foundation-only") {
      const hostCases = entry.hostFoundationCaseIds ?? [];
      if (!Array.isArray(hostCases) || new Set(hostCases).size !== hostCases.length ||
          hostCases.some(id => !ids.includes(id)))
        errors.push(`${name}: invalid host-foundation case ids`);
    }


    if (entry.status === "guest-executed" || entry.status === "guest-partial") {
      if (entry.status === "guest-partial" &&
          (executed.length < 1 || executed.length >= ids.length))
        errors.push(`${name}: partial guest coverage must contain between 1 and 19 cases`);
      if (!SHA40.test(entry.sourceHead ?? "")) errors.push(`${name}: exact source head required`);
      if (!SHA40.test(entry.sourceTree ?? "")) errors.push(`${name}: exact source tree required`);
      if (!SHA256.test(entry.compilerSha256 ?? "")) errors.push(`${name}: compiler SHA-256 required`);
      if (entry.unsupportedSyntaxOnly === true) errors.push(`${name}: unsupported syntax is not guest evidence`);
      const run = entry.workflowRun ?? {};
      if (run.runnerAssigned !== true) errors.push(`${name}: runner assignment required`);
      if (!Number.isInteger(run.executedSteps) || run.executedSteps < 1)
        errors.push(`${name}: at least one executed job step required`);
      for (const field of ["runId", "runAttempt", "jobId", "runnerId"])
        if (!Number.isSafeInteger(run[field]) || run[field] < 1)
          errors.push(`${name}: positive GitHub ${field} required`);
      if (run.headSha !== entry.sourceHead || run.conclusion !== "success")
        errors.push(`${name}: successful exact-head GitHub job provenance required`);

      // Structural receipt validation is not independent runner attestation.
      // CI must verify the linked job, source, compiler, artifacts and case logs.
      const receipts = entry.caseReceipts;
      if (!Array.isArray(receipts) || receipts.length !== executed.length) {
        errors.push(`${name}: one guest receipt per claimed case required`);
      } else {
        const receiptIds = receipts.map(r => r?.id);
        if (new Set(receiptIds).size !== executed.length ||
            receiptIds.some(id => !executed.includes(id)))
          errors.push(`${name}: guest receipts must match exactly the claimed case ids`);
        for (const receipt of receipts) {
          if (!receipt || !ids.includes(receipt.id)) continue;
          const scenario = scenarios.find(s => s.id === receipt.id);
          const expectedMode = scenario.kind === "compile" ? "semantic-check" : "guest-execution";
          if (receipt.mode !== expectedMode || receipt.result !== "pass")
            errors.push(`${name}: ${receipt.id} lacks a passing ${expectedMode} receipt`);
          if (!SHA256.test(receipt.guestSourceSha256 ?? "") ||
              receipt.compilerSha256 !== entry.compilerSha256 ||
              receipt.workflowRunId !== run.runId || receipt.jobId !== run.jobId)
            errors.push(`${name}: ${receipt.id} receipt provenance mismatch`);
          if (expectedMode === "guest-execution" &&
              !SHA256.test(receipt.guestArtifactSha256 ?? ""))
            errors.push(`${name}: ${receipt.id} guest artifact hash required`);
          if (expectedMode === "semantic-check" &&
              (typeof receipt.diagnosticCategory !== "string" ||
               !receipt.diagnosticCategory.startsWith("ORES-") ||
               receipt.diagnosticCategory === "ORES-SINGLETON-UNSUPPORTED"))
            errors.push(`${name}: ${receipt.id} requires semantic, not blanket unsupported, diagnostic`);
        }
      }
      const missing = ids.filter(id => !executed.includes(id));
      if (entry.status === "guest-executed" && missing.length)
        errors.push(`${name}: missing executed cases: ${missing.join(",")}`);
      if (entry.status === "guest-executed" && name === "wasm" && entry.crossWorkerOrIsolateExecuted !== true)
        errors.push("wasm: cross-worker/isolate execution required");
      if (entry.status === "guest-executed" &&
          (name === "llvm" || name === "forge") && entry.sanitizersPassed !== true)
        errors.push(`${name}: ASan/UBSan evidence required`);
    }
  }

  // This static JSON verifier cannot independently authenticate GitHub runner,
  // compiler or guest execution evidence. Promotion is deliberately disabled
  // until a separate trusted artifact/job attestor is implemented and reviewed.
  if (evidence?.conformant === true)
    errors.push("conformant=true requires independent GitHub job/artifact attestation; structural JSON alone cannot promote v1");

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
  expectReject("same-count scenario substitution", (c) => {
    c.scenarios[0].id = "substituted-placeholder";
  });
  expectReject("weakened existing scenario requirement", (c) => {
    c.scenarios[0].requires = ["one-initializer"];
  });
  expectReject("changed shared-state authority", (c) => {
    c.semantics.callerIdentity = "guest-supplied";
  });
  expectReject("sleep-based proof enabled", (c) => {
    c.promotion.noSleepBasedRaceProof = false;
  });
  expectReject("host-only guest execution claim", (_c, e) => {
    e.backends.forge.executedCaseIds = [contract.scenarios[0].id];
  });
  expectReject("partial claim lacking case receipts", (_c, e) => {
    e.backends.java = {
      status: "guest-partial", sourceHead: "a".repeat(40),
      sourceTree: "b".repeat(40), compilerSha256: "c".repeat(64),
      executedCaseIds: [contract.scenarios[0].id],
      workflowRun: {runId: 100, runAttempt: 1, jobId: 200, runnerId: 300,
                    headSha: "a".repeat(40), conclusion: "success",
                    runnerAssigned: true, executedSteps: 2}
    };
  });
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
  expectReject("forged complete five-backend guest receipts cannot promote", (_c, e) => {
    e.conformant = true;
    for (const name of REQUIRED_BACKENDS) {
      const sourceHead = "a".repeat(40), sourceTree = "b".repeat(40);
      const compilerSha256 = "c".repeat(64), runId = 100, jobId = 200;
      e.backends[name] = {
        status: "guest-executed", sourceHead, sourceTree, compilerSha256,
        executedCaseIds: contract.scenarios.map(s => s.id),
        workflowRun: {
          runId, jobId, runAttempt: 1, runnerId: 300, headSha: sourceHead,
          conclusion: "success", runnerAssigned: true, executedSteps: 10
        },
        caseReceipts: contract.scenarios.map(s => ({
          id: s.id, result: "pass",
          mode: s.kind === "compile" ? "semantic-check" : "guest-execution",
          guestSourceSha256: "d".repeat(64), compilerSha256, workflowRunId: runId, jobId,
          ...(s.kind === "compile" ? {diagnosticCategory: "ORES-SINGLETON-SEMANTIC"} :
                                     {guestArtifactSha256: "e".repeat(64)})
        })),
        sanitizersPassed: true, crossWorkerOrIsolateExecuted: true
      };
    }
  });
  expectReject("false five-backend conformance", (_c, e) => { e.conformant = true; });
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
