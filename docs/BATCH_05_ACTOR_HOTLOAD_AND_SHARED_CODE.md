# Batch 5 — actor hot reload, supervision and shared immutable code (tasks 41–50)

**Status: in-progress, not a release.** Ten real open issue links were verified against GitHub on October 20, 2026. The association of 41–50 with the precise original 100-task ordering is **partly reconstructed**: tasks 44–47 match the previously described original sequence; other rows are the closest verified open issues in the same workstream, **not a claim of historical equivalence**.

## Target, source work and remaining gate

| Work item | GitHub issue | Existing implementation anchor | Missing mandatory evidence |
|---|---|---|---|
| 41. Hotload capability monotonicity | [Java #478](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/478) | [Java #1270](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1270) staged-validation/security gate | Guest same-AOT+JIT capability policy comparison, terminal close and cold-source checks |
| 42. Native compiler actor-turn leases | [LLVM #606](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/606) | [LLVM #597](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/597) and #602 host lifecycle | Real Oreslang DATA/await/select/FFI lowering, proof of physical cleanup under STOP |
| 43. Native unload failure quarantine | [LLVM #610](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/610) | [LLVM #595](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/595) RAII reclamation | Failed dlclose/ORC unload must become durable, supervisor-visible non-successful retirement |
| 44. Shared immutable code images | [LLVM #603](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/603) | LLVM PIC/ORC staging and Java SharedCodeImageStore | Domain-separated immutable code-image lifetime; untrusted JIT pool; separate private actor heaps; exact memory measurements |
| 45. Single-consumer transfer | [Java #1341](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1341) | [Java #1270](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1270) already has OPEN→CLAIMED→PUBLISHED/ROLLBACK_PENDING state | Same-transfer dual restore concurrency, failed rollback, exact candidate publish and source-level regression |
| 46. Output-reader registration | [Java #1342](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1342) | #1270 registers `outputs().next()` while holding route lock | Real pending registration versus concurrent route publication/timeout/cancel JUnit |
| 47. Logical address identity | [Java #1343](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1343) | #1270 models stable logical actor/incarnation and independent routeEpoch | IPC/supervisor source tests rejecting stale epoch without conflating restart |
| 48. OTP supervisor CONTROL | [Java #476](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/476) | [Java #1476](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1476) host-only bounded CONTROL lane, production and smoke fixes in this batch | Real guest six OTP modules, compile/test priority CONTROL, restart trees, physical-exit fencing |
| 49. Module hotload ABI | [Java #494](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/494) | Compile-time conforms validation and staged hot-reload code | Supervisor-owned versioned structural ABI fingerprint and source guest hot reload rejection |
| 50. Executable Java CI | [Java #963](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/963) | Same-org source-local workflows | Runner-assigned stepful exact-head Maven/JDK25/JUnit/GraalVM proof; no zero-step success claims |

## Concrete implementation changes in this batch

On [Java PR #1476](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1476):
- Added **512 ACK vs terminal-STOP/quarantine stress iterations** on the actual Java `OtpSupervisorCommandLaneV1`, ensuring exactly one settled/quarantined outcome, no post-STOP admission, no leaked queue/lease and no double-retirement.
- Hardened actual CONTROL-lane metrics with saturating `long` accounting. Telemetry cannot wrap negative and confuse monitoring, while authoritative command sequence/epoch and slot reservation remain independently monotonic/fenced.
- Added near-`Long.MAX_VALUE` fault-injection regression for success, retry, duplicate/full rejection, abort and terminal quarantine paths.
- All changes are committed, but **no Maven/JUnit guest or host execution has been observed**. Host-only tests do not establish guest OTP/CONTROL behavior.

Batch 4 concurrent progress: [LLVM #720](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/720) received IEEE signed-zero, NaN and loan-fenced structural erase C++ tests. Batch 4 already holds [Java #1675](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1675) writable record compiler repairs. Those tests remain unexecuted in source-local CI.

## Exact-head release gate

Recent sampled [OTP source-local workflow run #39437268931](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/39437268931) reported `failure`, with `control-host-and-actor.steps:null`. Sampled [LLVM SoA workflow #39437133131](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/39437133131) likewise had `steps:null`. This cannot be called a compiler test verdict, and does not prove budget exhaustion.

Run from authorized reviewed source heads: Java JDK25 `mvn test` with OtpSupervisorCommandLaneV1Test and hot-upgrade guest tests; native CMake/CTest with ASan/UBSan for native actor hot-upgrade and DOP SoA; conformance `node --test tests/batch-05-actor-hotload.test.mjs`. Inspect job steps/logs, tested exact head SHA, imported source closure, machine/compiler hashes, and independent review. No unapproved private-source cross-org mirroring, secrets, branch protection bypass or merges.

## Native unload-failure progress (#610)

The existing native [PR #595](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/595) has a new production source change: `NativeSupervisorCodeSlot` now increments a **saturating, atomic per-policy process-lifetime observation counter** when a `noexcept` reclamation callback throws (commit `3edca37e8e75842e882ee20f608aa5f0980967bb`). A new native host test (commit `5afbcf47e289e4d1f088222cec7f05d519de47aa`) injects a throwing callback, checks that the rejected image did not publish, and requires the failure to become observable.

This fixes **silent suppression of callback failure telemetry**, not durable per-supervisor quarantine, guaranteed memory reclamation or LLVM ORC/dlclose execution. Task 43 remains open until the runtime stores an independently verified durable unload-failure receipt, blocks physical completion/restart/STOP release as required, and native source-local sanitizer/CTest executes.
