import fs from "node:fs";

const expectedOperations = ["lookup", "insert", "insert_new", "compare_exchange",
  "update_counter", "erase", "delegate", "close"];
const requiredCases = ["singleton-prepublication-self-escape",
  "singleton-mutable-alias-publication"];

export function verify(candidate, contract) {
  const errors = [];
  if (candidate?.schemaVersion !== 1 || candidate?.status !== "proposal-not-admitted" ||
      candidate?.parityClaim !== false) errors.push("proposal must not assert admission or parity");
  if (candidate?.normativeContract !== contract?.contract || candidate?.normativeContract !== "singleton-shared-state-v1")
    errors.push("wrong normative contract");
  const ids = (contract?.scenarios ?? []).map(x => x.id);
  if (ids.length !== 20 || JSON.stringify(candidate?.contractCaseIds) !== JSON.stringify(ids))
    errors.push("must preserve all 20 ordered v1 scenario ids");
  const entry = candidate?.sharedTable ?? {};
  if (entry?.callerIdentity !== "runtime-derived-from-active-scheduler-lease")
    errors.push("caller identity must come from the live runtime lease");
  if (entry?.capabilities?.opaque !== true || entry?.capabilities?.forgedOrStale !== "Denied")
    errors.push("table capabilities must be opaque and stale/forged handles denied");
  for (const key of ["ActorContext", "SingletonDeclarationId", "raw-pointer", "native-owner-stopped"])
    if (!entry?.prohibitedGuestInputs?.includes(key)) errors.push("missing guest prohibition: " + key);
  if (entry?.capacity?.kind !== "positive-compile-time-bounded" ||
      entry?.semantics?.overflow !== "checked-i64-and-no-partial-mutation" ||
      entry?.semantics?.atomicity !== "single-operation-linearizable")
    errors.push("bounded atomic i64 table guarantees weakened");
  const names = (entry?.operations ?? []).map(x => x.name);
  if (JSON.stringify(names) !== JSON.stringify(expectedOperations))
    errors.push("guest operation surface changed");
  for (const op of entry?.operations ?? [])
    if (!op.return?.startsWith("Result<") || !Array.isArray(op.inputs))
      errors.push("all guest operations require typed Result returns and typed inputs");
  const oracles = candidate?.compileOracles ?? [];
  if (JSON.stringify(oracles.map(x => x.id)) !== JSON.stringify(requiredCases))
    errors.push("the two original compile cases must be present");
  const expected = ["ORES-SINGLETON-SELF-ESCAPE", "ORES-SINGLETON-MUTABLE-ALIAS"];
  if (JSON.stringify(oracles.map(x => x.diagnostic)) !== JSON.stringify(expected) ||
      oracles.some(x => x.kind !== "compile" || x.expected !== "semantic-reject" || x.requireAST !== true))
    errors.push("compile oracles must require AST-based semantic diagnostics");
  const policy = candidate?.executionPolicy ?? {};
  for (const key of ["compilerBacked", "runtimeBackendEvidence",
                    "semanticOraclesExecuted", "hardRealtimeClaim"])
    if (policy[key] !== false) errors.push("design candidate cannot assert execution: " + key);
  for (const key of ["noSleepBasedRaceProof", "hostFoundationNotGuest",
                    "unsupportedDiagnosticNotSemanticProof", "explicitReviewBeforeSyntaxFreeze"])
    if (policy[key] !== true) errors.push("safety policy missing: " + key);
  if (!Array.isArray(policy.executedGuestCaseIds) || policy.executedGuestCaseIds.length)
    errors.push("candidate cannot attach executed guest cases");
  return errors;
}

function checkSelfTests(candidate, contract) {
  const mutate = (label, change) => {
    const draft = structuredClone(candidate);
    change(draft);
    if (!verify(draft, contract).length) throw Error("failed to reject " + label);
  };
  mutate("guest authority spoof", x => { x.sharedTable.callerIdentity = "guest-supplied"; });
  mutate("missing capability check", x => { x.sharedTable.capabilities.opaque = false; });
  mutate("weakened overflow", x => { x.sharedTable.semantics.overflow = "wrap"; });
  mutate("unsupported diagnostic", x => { x.compileOracles[0].diagnostic = "ORES-SINGLETON-UNSUPPORTED"; });
  mutate("fabricated execution", x => { x.executionPolicy.compilerBacked = true; });
  mutate("case-floor deletion", x => { x.contractCaseIds.pop(); });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const contract = JSON.parse(fs.readFileSync(process.argv[2] ??
      "contracts/singleton-shared-state-v1.json", "utf8"));
  const candidate = JSON.parse(fs.readFileSync(process.argv[3] ??
      "contracts/singleton-shared-state-guest-abi-candidate-v1.json", "utf8"));
  const errors = verify(candidate, contract);
  if (errors.length) {
    for (const error of errors) console.error("ERROR:", error);
    process.exit(1);
  }
  checkSelfTests(candidate, contract);
  console.log("PASS: guest ABI candidate retains all 20 cases and fail-closed semantic gates; no guest parity claimed");
}
