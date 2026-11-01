import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

export const contractPath = new URL("../fixtures/supervision/v1/type-boundaries.json", import.meta.url);
export const expectedBackends = Object.freeze(["java", "llvm", "wasm", "cranelift", "net"]);
export const expectedCaseIds = Object.freeze([
  "plain", "pub", "brace", "extends-actor", "extends-class",
  "extends-supervisor", "implements-interface", "impl-interface",
  "conforms-contract", "with-trait", "trait-direct", "actor-hook-throw",
  "actor-hook-raise", "mutable-failure", "structural-failure",
  "forged-annotation"
]);
export const requiredEvidence = Object.freeze([
  "exact-source-commit", "compiler-binary-hash", "nonzero-step-run",
  "compiler-exit-diagnostic", "actual-guest-control-turn",
  "generation-fenced-lifecycle-effect"
]);

/**
 * Static fixture/claims gate only. This intentionally NEVER invokes a
 * compiler, fabricates a passing result, or certifies guest supervision.
 */
export function validateSupervisorTypeContract(contract) {
  const fail = reason => { throw new Error("supervisor type contract: " + reason); };
  if (!contract || typeof contract !== "object" || Array.isArray(contract) ||
      contract.schemaVersion !== 1 || contract.scope !== "supervisor-type-boundaries-v1")
    fail("invalid schema or scope");
  if (contract.guestSupervisorExecution !== "unimplemented")
    fail("guest execution must not be asserted by a fixture inventory");
  if (JSON.stringify(contract.backends) !== JSON.stringify(expectedBackends))
    fail("missing/extra/reordered backend");
  if (JSON.stringify(contract.requiredEvidence) !== JSON.stringify(requiredEvidence))
    fail("missing provenance or guest CONTROL execution gate");
  if (!Array.isArray(contract.cases) ||
      JSON.stringify(contract.cases.map(c => c.id)) !== JSON.stringify(expectedCaseIds))
    fail("missing, duplicate, or reordered supervisor regression case");
  if (!contract.backendGate || !contract.evidencePRs)
    fail("missing backend gate/evidence references");
  for (const backend of expectedBackends) {
    const gate = contract.backendGate[backend];
    if (!gate || gate.guestSourceParity !== false ||
        typeof gate.normalCompiler !== "string" ||
        !gate.normalCompiler.startsWith("reject-"))
      fail("backend guest execution must remain denied until execution evidence: " + backend);
    if (!/^https:\/\/github\.com\/ores-truffle-oreslang\/oreslang-source\.(java|llvm|wasm|cranelift|net)\/pull\/\d+$/.test(contract.evidencePRs[backend]))
      fail("missing reviewable backend PR: " + backend);
  }
  for (const c of contract.cases) {
    if (typeof c.source !== "string" || c.source.length > 1024 ||
        !/^define (?:pub )?supervisor S1\b|^define supervisor S1\b/.test(c.source))
      fail("invalid supervisor source: " + c.id);
    if (c.javaParser !== (c.kind === "valid-declaration-nonexecutable" ? "accept" : "reject"))
      fail("invalid Java parser fixture expectation: " + c.id);
    if (!c.kind || (c.kind !== "valid-declaration-nonexecutable" && !c.kind.startsWith("invalid-")))
      fail("unclassified case: " + c.id);
  }
  return {cases: contract.cases.length, backends: expectedBackends.length, status:"static-fixture-contract-only"};
}

export function readSupervisorTypeContract() {
  return JSON.parse(readFileSync(fileURLToPath(contractPath), "utf8"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.stdout.write(JSON.stringify(validateSupervisorTypeContract(readSupervisorTypeContract()))+"\n");
  } catch (error) {
    process.stderr.write(String(error.message)+"\n");
    process.exitCode = 1;
  }
}
