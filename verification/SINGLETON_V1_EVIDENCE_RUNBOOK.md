# Singleton/shared-state v1: exact-head guest evidence boundary

This document describes **required evidence**, not an implementation or a parity claim. The v1 contract remains `conformant: false` and all five backend guest case lists remain empty.

## Evidence classes

| Class | Evidence | Permitted claim |
| --- | --- | --- |
| Admission | Production parser rejects `define singleton` with `ORES-SINGLETON-UNSUPPORTED` | Unsupported syntax is safely rejected; **zero** v1 guest semantic cases |
| Host foundation | Standalone C++/JVM/.NET/JS runtime unit tests | Host infrastructure works for covered cases; **zero** compiled guest cases |
| Compiler-backed guest checking | Actual Oreslang guest source accepted or rejected by the *shipping* compiler with a semantic diagnostic | Only the corresponding compile-kind cases, after exact-head execution |
| Runtime guest execution | Compile and run the Oreslang guest fixture under its backend and check its oracle | Only the corresponding runtime-kind cases, after exact-head execution |

The verifier now freezes the 20 case IDs, kinds, and required properties; a substitution of a hard case with a placeholder fails even if 20 cases remain.

## Guest receipt structure (future positive claims)

Each `guest-executed` backend entry needs:

- `sourceHead` and `sourceTree`: exact 40-character Git commit and tree hashes.
- `compilerSha256`: actual compiler executable digest.
- `workflowRun`: `runId`, `runAttempt`, `jobId`, `runnerId` (positive integers), `headSha` matching sourceHead, `conclusion: "success"`, `runnerAssigned: true`, and positive `executedSteps`.
- `guest-partial` may record **1–19** compiler-backed or executed guest cases with matching receipts, but is never a parity pass. `guest-executed` requires **all 20**. Pending/host-only backends must keep an empty guest-case list.
- `executedCaseIds`: the exact IDs claimed (no duplicates), matching the case receipts. Any full parity claim requires all 20.
- `caseReceipts`: one receipt per claimed guest scenario. Each includes `id`, `result: "pass"`, `guestSourceSha256`, `compilerSha256` matching the backend compiler, `workflowRunId`, and `jobId`. Compile cases use `mode: "semantic-check"` and a specific `diagnosticCategory` that is **not** the blanket `ORES-SINGLETON-UNSUPPORTED`; runtime cases use `mode: "guest-execution"` and `guestArtifactSha256`.
- LLVM and Forge must additionally demonstrate real sanitizers; Wasm must demonstrate real cross-worker/isolate execution. Sleep-based race proofs are prohibited.

**Security limitation:** These are *structural* checks over reported fields. JSON text cannot authenticate GitHub job metadata, source/binary hashes, stdout, generated guest artifacts, scheduler identity, sanitizer runs or the absence of sleep. A future CI collector must verify each receipt against the GitHub Actions job/attempt and execute the actual binaries; externally obtained evidence must be independently reviewed before any `conformant: true` claim.

## Smallest execution sequence

1. Source-free runner canary, with an actual assigned runner and at least one executed step. Determine why current jobs fail before running steps. No private source transfer to another organization without explicit authorization, independent review and incident clearance.
2. Exact-head admission tests: Java #2316, LLVM #1203, .NET #267, Wasm #191 after pinning the built LLVM compiler; Forge #146 release plus sanitizer profiles. Store runner IDs, attempts, step names and toolchain digests. These results do **not** change the 20-case guest count.
3. Freeze the minimal typed guest table API and error vocabulary under review. Implement the two compile cases against real guest AST/type/effect checking (prepublication self-escape and mutable alias publication), without enabling unsupported runtime declarations.
4. Implement the first guest runtime slice for `singleton-concurrent-first-access-once` and `table-concurrent-counter-exact`. Derive authority from scheduler-owned actor incarnation, not guest arguments. Use deterministic barriers; prohibit sleep-based race proofs.
5. Expand fixtures to all 20 cases across the five backends. Collect source, compiler, execution and artifact provenance from each exact-head job and independently verify it. **No promotion** until every required gate passes.

For Wasm, the source compiler must be LLVM's verified/pinned head. Forge's host-foundation test IDs remain distinct from its empty guest-executed list.

The verifier is intentionally a policy checker, not a claim that steps 1–5 have already executed.
