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
// Closed-world, canonical expectations. An altered fixture is NOT allowed
// to turn a negative control into a parser-accepted source while keeping its ID.
export const expectedCases = Object.freeze([
  {
    "id": "plain",
    "kind": "valid-declaration-nonexecutable",
    "javaParser": "accept",
    "source": "define supervisor S1 as on_panic(f: Failure): void { return; } end"
  },
  {
    "id": "pub",
    "kind": "valid-declaration-nonexecutable",
    "javaParser": "accept",
    "source": "define pub supervisor S1 as on_panic(f: Failure): void { return; } end"
  },
  {
    "id": "brace",
    "kind": "valid-declaration-nonexecutable",
    "javaParser": "accept",
    "source": "define supervisor S1 { on_panic(f: Failure): void { return; } }"
  },
  {
    "id": "extends-actor",
    "kind": "invalid-inheritance",
    "javaParser": "reject",
    "source": "define supervisor S1 extends Actor as on_panic(f: Failure): void { return; } end"
  },
  {
    "id": "extends-class",
    "kind": "invalid-inheritance",
    "javaParser": "reject",
    "source": "define supervisor S1 extends BaseClass as on_panic(f: Failure): void { return; } end"
  },
  {
    "id": "extends-supervisor",
    "kind": "invalid-inheritance",
    "javaParser": "reject",
    "source": "define supervisor S1 extends Supervisor as on_panic(f: Failure): void { return; } end"
  },
  {
    "id": "implements-interface",
    "kind": "invalid-interface-composition",
    "javaParser": "reject",
    "source": "define supervisor S1 implements Observer as on_panic(f: Failure): void { return; } end"
  },
  {
    "id": "impl-interface",
    "kind": "invalid-interface-composition",
    "javaParser": "reject",
    "source": "define supervisor S1 impl Observer as on_panic(f: Failure): void { return; } end"
  },
  {
    "id": "conforms-contract",
    "kind": "invalid-interface-composition",
    "javaParser": "reject",
    "source": "define supervisor S1 conforms Policy as on_panic(f: Failure): void { return; } end"
  },
  {
    "id": "with-trait",
    "kind": "invalid-trait-composition",
    "javaParser": "reject",
    "source": "define supervisor S1 with RestartPolicy as on_panic(f: Failure): void { return; } end"
  },
  {
    "id": "trait-direct",
    "kind": "invalid-trait-composition",
    "javaParser": "reject",
    "source": "define supervisor S1 trait RestartPolicy as on_panic(f: Failure): void { return; } end"
  },
  {
    "id": "actor-hook-throw",
    "kind": "invalid-actor-hook",
    "javaParser": "reject",
    "source": "define supervisor S1 as on_panic(f: Failure): void { return; } on_throw(f: Failure): void { return; } end"
  },
  {
    "id": "actor-hook-raise",
    "kind": "invalid-actor-hook",
    "javaParser": "reject",
    "source": "define supervisor S1 as on_panic(f: Failure): void { return; } on_raise(f: Failure): void { return; } end"
  },
  {
    "id": "mutable-failure",
    "kind": "invalid-failure-binder",
    "javaParser": "reject",
    "source": "define supervisor S1 as on_panic(f: Failure mut): void { return; } end"
  },
  {
    "id": "structural-failure",
    "kind": "invalid-failure-binder",
    "javaParser": "reject",
    "source": "define supervisor S1 as on_panic(structural Failure f): void { return; } end"
  },
  {
    "id": "forged-annotation",
    "kind": "invalid-hook-annotation",
    "javaParser": "reject",
    "source": "define supervisor S1 as @GrantControl on_panic(f: Failure): void { return; } end"
  }
]);
export const expectedNormalCompiler = Object.freeze({
  java:"reject-unlowered-control",
  llvm:"reject-unlowered-control",
  wasm:"reject-before-wasm-artifact",
  cranelift:"reject-before-clif",
  net:"reject-before-nativeaot-cil"
});

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
  if (!contract.backendGate || !contract.evidencePRs ||
      Object.keys(contract.backendGate).length !== expectedBackends.length ||
      Object.keys(contract.evidencePRs).length !== expectedBackends.length)
    fail("missing or unexpected backend gate/evidence references");
  for (const backend of expectedBackends) {
    const gate = contract.backendGate[backend];
    if (!gate || gate.guestSourceParity !== false ||
        gate.normalCompiler !== expectedNormalCompiler[backend])
      fail("backend guest execution must remain denied until execution evidence: " + backend);
    const prefix = "https://github.com/ores-truffle-oreslang/oreslang-source." +
        backend + "/pull/";
    const url = contract.evidencePRs[backend];
    if (typeof url !== "string" || !url.startsWith(prefix) ||
        !/^[1-9][0-9]*$/.test(url.slice(prefix.length)))
      fail("wrong backend or missing reviewable PR: " + backend);
  }
  for (let i = 0; i < expectedCases.length; i++) {
    const c = contract.cases[i], expected = expectedCases[i];
    if (!c || c.id !== expected.id || c.kind !== expected.kind ||
        c.javaParser !== expected.javaParser ||
        c.source !== expected.source || Object.keys(c).length !== 4)
      fail("fixture identity/source/admission mismatch: " + expected.id);
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
