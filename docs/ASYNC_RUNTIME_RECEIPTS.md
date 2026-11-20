# Async runtime v1 evidence receipts (shape verifier only)

**Status:** auxiliary evidence format; **not** an executable runtime test, compiler adapter, attestation, or parity certificate.

This file accompanies [common-source draft contract #169](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/169), the existing [portable NIO contract](../contracts/v1/NIO_ACTOR_EXECUTION_V1.md), and [NIO ratification #173](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/173). Never promote a capability because its receipt passes this checker.

Run:

```sh
node --test test/async-runtime-receipt.test.mjs
node bin/verify-async-runtime-receipt.mjs /path/to/async-receipt.json
```

The verifier checks **internal consistency only**: recognized case IDs `ASYNC-01` through `ASYNC-15`, backend, Git source commit/tree and contract blob identities, reported stages, and for claimed executable observations a specific `.ores` fixture hash, compiler binary SHA-256, nonzero executed steps, actual argv, exit status and assertion count. Native-AOT claims additionally need the native executable's SHA-256. A GitHub Actions report must identify a concrete run URL. The tool does **not** download or authenticate those URLs, recompute hashes, inspect job logs, run a compiler, prove physical carrier retirement, or confirm output assertions. Local runner metadata is also self-reported.

Top-level format:

```json
{
  "schema": "oreslang.async-runtime-receipt/1",
  "backend": "llvm",
  "sourceCommit": "<real 40-character source commit SHA>",
  "sourceTree": "<real 40-character Git tree SHA>",
  "contractBlob": "<real 40-character reviewed contract blob SHA>",
  "cases": [
    {
      "id": "ASYNC-01",
      "claim": "pending",
      "evidence": "contract-only"
    }
  ]
}
```

The illustrative `<...>` placeholders above are **not valid input**. Capture real SHAs at the exact qualifying run. The only valid `claim` values are:

- `pending`: `contract-only`, `host-model` or `source-compiled`, never an advertised runtime feature.
- `unsupported`: `not-implemented`, explicit feature gap; no positive conformance claim.
- `guarded`: `rejected-as-required`, with an executed negative `.ores` compiler fixture proving fail-closed admission.
- `supported`: `guest-executed` or `native-aot-executed`, with an executed positive guest fixture and complete declared provenance.

An executed case adds:

```json
{
  "fixturePath": "fixtures/async/task_scope.ores",
  "fixtureSha256": "<real lowercase 64-character SHA-256>",
  "execution": {
    "runnerKind": "gha",
    "runUrl": "https://github.com/OWNER/REPO/actions/runs/REAL_RUN_ID",
    "executedSteps": 3,
    "command": ["./actual-compiler", "fixtures/async/task_scope.ores"],
    "exitCode": 0,
    "assertionCount": 2,
    "compilerSha256": "<real lowercase 64-character SHA-256>",
    "nativeExecutableSha256": "<required only for native-aot-executed>"
  }
}
```

For `rejected-as-required`, the `execution` block additionally MUST contain `compilerExitCode` (a nonzero integer from the actual negative compiler invocation) and `expectedDiagnostic` (a 3–512 character diagnostic asserted by the harness). The generic `execution.exitCode: 0` is the **harness** success status and does not erase the compiler rejection. Merely seeing a nonzero compiler exit without checking its expected diagnostic is insufficient.

Here the nonzero numbers and paths are structural examples only; they are **not evidence of any Oreslang run**. For `runnerKind: "local"`, `runUrl` may be omitted but execution evidence still needs independent review.

Important: the verifier's success exit means `RECEIPT_SHAPE_ONLY_NO_PROMOTION`, **not** `backend PASS`. `shapeValidCases` and `missingCases` are inventory fields, not proof grades. A partial receipt is always partial; unsupported or pending cases must never be summarized as implemented. Case semantics live in the draft common-source contract, not in this JSON checker.

Independent release verification must fetch exact commit/tree/blob, authenticate reporter/runner/toolchain, inspect actual executed steps and logs, reproduce guest-source positive **and negative** tests, and inspect native artifacts for true guest AOT. A static verifier, host model, zero-step workflow, or native C ABI probe cannot establish source-level parity.

**Security:** no cross-organization private-source mirroring is authorized by this format. Open CI security blockers, protected source provenance, reviewed numeric private destination identity, and snapshot allowlists remain separate fail-closed gates.
