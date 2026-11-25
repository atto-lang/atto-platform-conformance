# Critical/suspends stage-0 execution gate (2026-11-02)

**Status:** prepared source-head snapshot, **no compiler guest receipts**. This is a bounded incremental admission plan, not certification of the 34-case target.

## Source identities / historical evidence

- The **point-in-time** PR heads, root Git trees and representative zero-step job IDs captured during this audit are in `evidence/critical-suspends-current-head-preflight-20261102.json`. Later branch advances require a new attested snapshot; never assume the captured heads are live.
- A byte-exact immutable archive of the original zero-step ledger is `evidence/critical-suspends-zero-step-original-20261101.json` (Git blob `cf71c6e3f538f61cd52a3e179eb6b219af3bdf5c`). Other agents may update the rolling `critical-suspends-backend-evidence-20261101.json`; those later jobs are separate observations, not retroactive evidence for old heads.
- A byte-exact immutable archive of the original Java stage-1 fixture manifest is `evidence/critical-suspends-java-stage1-original-manifest-20261101.json` (Git blob `396b376c5d0020a6bc09a011f28bca06190a3d6a`). The rolling manifest may be repinned separately, but the four `.ores` fixture blobs were checked unchanged at the frozen Java source snapshot. Updating tests or manifest metadata cannot make historical CI jobs newly executed.
- `bin/verify-critical-current-head-preflight.mjs` and `bin/verify-critical-stage0-receipt.mjs` are offline data-consistency checks only. Both reject purported CI attestations from unexecuted jobs. Even a matching nonzero-step partial receipt returns **UNATTESTED** until independently checked against GitHub job attempt, logs, exact tree and compiler artifact.

## Minimal stage-0 matrix (run in each source repository unless an independently authorized private carrier exists)

| Backend | First execution gate | What a pass establishes | Not yet established |
| --- | --- | --- | --- |
| Java/Graal #2433 | Run `CriticalSuspensionAdmissionV1Test` through the real Graal/JUnit test class at exact head; execute the 4 pinned `.ores` source inputs | One genuine interpreted Graal guest must emit exactly `31` and three first diagnostics match exactly | Graal native-image AOT, actor continuation, FIFO guest parity |
| LLVM #1289 | Build actual native compiler and execute `tests/critical_suspends_source_admission.py --compiler <path-to-built-compiler>` plus `critical_gate_test` and `critical_gate_retirement_stress_test` CTest targets, sanitizer-backed when supported | Real LLVM frontend control and both modifier-order negative diagnostics; separate native gate substrate race tests | Compiler-generated critical guest, queued await, actor turn |
| .NET #320 | Compile actual .NET verification project and execute `CriticalSuspendsAdmissionV1Tests` through its module initializer with both modifier orders, `async fnc` and positive scalar controls | Scalar bootstrap source admission with stable exact diagnostics | NativeAOT executable guest or critical lowering |
| Forge/Cranelift #168 | Build native C++ frontend and run registered `critical_suspends_admission` CTest with GCC/Clang | Real source parser rejects unsupported declarations with specified codes, scalar controls still work | Cranelift-generated critical guest |
| Wasm #258 | Run Node 22 `tests/critical-suspends-zero-capability.test.mjs` against its actual host admission module | Host capability deny-by-default only | Source frontend, LLVM-to-Wasm compiler, Wasmtime guest |

The `positive-try-critical-named-mutex.ores` Java input checks both an uncontended admission and busy fallback, producing **exact** stdout `31`. For negative Java fixtures use the *first* actual compiler diagnostic code, never just the `E_CRITICAL_` prefix.

**Stage-0 evidence granularity (hardened):** Java's JUnit test runs `.ores` source using GraalVM `Context.eval`, so an independently verified pass is `GRAAL_POLYGLOT_GUEST` evidence; it is **not** a Graal Native Image executable and must set `native_guest_executed: false`. The stage-0 verifier requires `guest_executed: true`, `guest_mode: GRAAL_POLYGLOT`, and exact output `31` for its positive case; a native-executable claim is rejected. LLVM, .NET, and Forge stage-0 tests are compiler/source admission only; Wasm stage-0 checks are host capability admission only. Native executable guest certification is a separate acceptance gate.

## Evidence capture after real execution

1. Before execution re-fetch PR and compare exact 40-hex **head commit** and complete root **tree**, not just branch name or blob equivalence. Abort on movement.
2. Record run ID, **run attempt**, job ID, runner ID, concrete executed step summaries (at least one), workflow/test-plan digest, toolchain and compiler executable SHA-256.
3. Record each actual compiler invocation, exit code, stderr's first diagnostic, stdout, output object/IR presence, and actual guest invocation/exit/stdout where applicable. Reject a compiler-negative result if it emitted an object or IR.
4. Use the partial stage-0 verifier for machine-readable consistency; it returns `UNATTESTED_STAGE0_RECORD` even for synthetically complete data. Have a second independent pass check remote run/attempt/log and tree values before crediting execution.
5. Promote individual evidence only to its observed class: **OFFLINE_MODEL**, **HOST_ONLY**, **COMPILER_ADMISSION**, or **GUEST_EXECUTION**. No stage-0 result marks full five-backend parity or auto-merges drafts.
6. Run the full 8 compile-pass, 12 exact compile-reject, 14 native guest cases after stage-0 execution and semantic lowering exist.

## Private-source CI capacity and security

A stepful source-free canary in another organization is evidence of runner **capacity only**. It never authorizes mirroring private `.ores`, compiler source, Git trees, blobs, caches, artifacts, or a private PR head. No cross-org checkout token is needed for an authorized connector-based exact-tree transfer, but the connector does **not** waive source governance.

LLVM main remains reported unprotected and its approved-destination list empty. The platform-conformance incident gates #22, #77 and #127 were open when this snapshot was captured. Java/.NET/Forge/Wasm approved-destination lists were also empty. Until the source's reviewed allowlist, independent approvals, protected-main rules, incident gates, destination privacy/numeric ID, approved workflows and retention policies are satisfied, **do not export private source to any alternate GitHub organization**. No bypass via source-free canaries or manual GitHub connector Git-object writes.

## Target-contract fixture drift that stays unresolved

- The proposed 34-case JSON contains non-executable fragments with unbound gate/callee symbols; expand them into canonical pinned compilation units before using exact diagnostic oracles.
- The canonical `try-critical-in-sync` example returns from inside a protected region, while Java's stage-1 call-free body deliberately rejects return; retain the difference and add cleanup-on-return coverage after implementation.
- The `unguarded-state-escape` negative returns from a `void` function; correct type context before expecting a borrow-escape diagnostic.
- `lock-order-self-await-rejection` currently has runtime phase despite its name implying a compile-time failure; explicitly decide whether the oracle is static rejection or runtime cycle detection.
- Generator grammar (`async gen*`, `async generator fnc`, `suspend gen*`) and legacy Java `async fnc` Future semantics need a separate migration gate.

**Release hold:** #292 and all five backend PRs remain draft pending independently attested exact-head execution and guest receipts.
