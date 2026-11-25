# Actor finalization v1 — cross-backend promotion gate

Status: **candidate / unattested**. This is a contract and a **source-free** reference oracle, not compiler or guest execution evidence. Native implementations remain separate.

## Contract and target mapping

The canonical scenario IDs are AF01–AF20 in [actor-finalization-v1.json](../contracts/actor-finalization-v1.json). The five requested backends are Java/GraalVM, native LLVM, Wasm, independent Cranelift, and .NET Native AOT. Forge is a **sixth, independently experimental C++ backend**, not an alias for Cranelift. Do not collapse the two.

| Backend | Current evidence slice | New draft | Promotion status |
|---|---|---|---|
| Java | ActorRuntime self-stop / mailbox-turn tests | oreslang-source.java#2409 | no exact-head JUnit / GraalVM guest proof |
| LLVM | ActorResourceRegistry native close/loan/panic supervisor model | oreslang-source.llvm#1263 | no exact-head CTest / sanitizers / source-guest proof |
| Wasm | Core-Wasm guest actor admission is denied; host ActorArena tests | oreslang-source.wasm#232 | not a compiled source actor runtime |
| Cranelift | Scalar JIT only, explicit negative actor guest admission | oreslang-source.cranelift#33 | not an actor runtime or actor parity |
| .NET | Host mailbox TryStop(ActorRef) nonce+generation fencing | oreslang-source.net#294 | not actor-source lowering or Native AOT guest proof |
| Forge (additional) | Bounded host finalizer / actor lease / table retirement | oreslang-source.forge#146 | draft, no stepful native tests or guest execution |

Backends with only fail-closed *unsupported-source* coverage may report a
**safety gate**; they must not report AF runtime parity. Likewise, a Node
reference-model pass does not establish WebAssembly guest actor behavior.
A project may pass AF07 locally while remaining unverified for AF18 and AF19.

## Required promotion receipt per backend and scenario

An AF guest-runtime claim requires the source and compiler SHA, exact runner
assigned and non-empty executed job steps, named test command and binary
digest, native/guest-executed behavior, observable result and independent
verifier. LLVM/Cranelift/Forge also require sanitized native evidence; Java
must distinguish JVM/Native Image; .NET must demonstrate strict Native AOT;
Wasm requires actual worker/isolate execution. A host-only test is a separate
receipt class.

Do not equate synthetic or shape-valid artifacts with independently verified
execution. Zero-runner or zero-step failed GitHub Actions jobs are **runner
admission blockers**, not compiler test results. This is particularly
important while private-repository Actions eligibility is unresolved.

## Security and source handling

Conformance security issue #22 and source Java issue #963 record private-source
mirroring and runner-admission blockers. Do not copy private source across
organizations without independently approved security clearance. A successful
source-free admission canary alone does not override incident restrictions.
Prefer authorized same-organization private runners.

## Next proof order

1. Finish source-free contract test review and run Node 22 tests.
2. Obtain a stepful exact-head runner for each new draft without private
   cross-org source export.
3. Execute backend-local negative admission and runtime test slices.
4. Verify actual actor supervisor CONTROL signals, callback-free stop,
   generation/nonce fencing, panic priority, and exactly-once retirement.
5. Validate cancellation, worker/isolate boundaries, ETS give_away/heirs,
   then promote individual AF scenario IDs only with authenticated receipts.

All five requested backends and Forge remain **unverified** under this contract.

## AF20 fail-closed local evidence shape gate (2026-11-01)

`src/actor-finalization-evidence-v1.mjs` and
`tests/actor-finalization-evidence-v1.test.mjs` reject zero-runner/zero-step
runs, unmatched head/tree SHAs, absent named guest test steps, duplicated job
IDs, forged SHA-256 digests, unbounded job/step/scenario arrays, coerced
object IDs, unsupported-only results and host-model-only receipts. The
module returns `parityCertified: false` for every self-reported receipt,
and its offline `actorFinalizationReleaseGate()` always returns
`ready: false`, even with a caller-provided `independentlyAuthenticated`
flag. Only a separately provider-authenticated verifier may promote a
specific executed AF scenario; JSON shape is never proof.

These tests are source-free and do not require private source mirroring.
The corresponding independent local oracle suite passed 26/26 Node 22 tests
during the November 1 review, but that local result is NOT an exact
GitHub-head test receipt. Source conformance CI runs
[#41340364032](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/41340364032)
and [#41340358112](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/41340358112)
had `runner_id=0`, zero executed steps. No native/guest parity claim is made.
