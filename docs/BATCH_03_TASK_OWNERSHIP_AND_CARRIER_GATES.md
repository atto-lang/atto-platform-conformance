# Oreslang Batch 3 — original tasks 21–30

**Updated:** October 20, 2026. **Status:** 10 upstream issues remain open. This draft contains source-free safety references, verified only with isolated JS checks. It does not enable Oreslang guest capabilities or establish Java/LLVM parity.

## Implemented in this batch

- Corrected `audits/batch-03-task-ownership.json` and its test to use the exact original ten issue identities, replacing earlier unrelated Task/carrier work item substitutions.
- Retained the existing `task-carrier-proof-models.mjs`: bounded Send/Sync derivation, scoped loans, quiescent cancellation, actor RW admissions and carrier budget references.
- Added `batch-03-ets-stm-reference.mjs`: bounded SET-style table permissions, same-domain heir, owner death revocation, no mutable alias payloads, entry quotas, versioned per-key compare-exchange to reject stale/ABA values, plus declarative STM read/write version checks and all-or-nothing multi-cell commit. This is **not a guest ETS/STM implementation**, concurrent runtime or proof of nonparking.
- Added `batch-03-ffi-channel-reference.mjs`: native downcall leases survive cancel/timeout until return and disposal; STOP/unload/arena reclamation remain fenced. Native callbacks and affinity violations fail closed. Task Channel handoff is affine and restricted to data-only payloads; actor boundary and unknown imports remain rejected.
- Added `batch-03-cfg-suspension-reference.mjs`: bounded conservative control-flow dataflow for live read/write loans, owned frame pin markers, suspension, moves/drops, exits and conflicting branch joins. The synthetic pin marker **cannot** prove a real compiler-issued pinned frame, native lowering or leak freedom.
- On actual Java compiler draft [#1631](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1631), commit `71ba2a471908d654033620eb9423ba26f0583b2e` expands the fail-closed auto-trait capability denylist for unlowered Arc/Weak, ETS/STM, Task, ThreadBound and native pointer types; follow-up commit `8fb24096b3a8332ead50f587de5720815c4872fe` adds a JUnit regression that also prevents laundering through `Option<T>`. JUnit is **not executed** at the Java exact head in this review.

## Exact issue and release-gate matrix

| Task | Existing GitHub issue | Progress | Outstanding proof |
|---|---|---|---|
| 21 | [Java #1437](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1437) | Reference Send/Sync and scoped loan oracle; Java #1631 denylist hardened | Compiler-derived structural traits, ownership-sensitive captures, unforgeable permits and guest positives/negatives |
| 22 | [Java #1403](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1403) | Preserved physically quiescent cancellation model | Real scheduler/actor TaskScope teardown, cancel/await/select race and get_done JUnit |
| 23 | [LLVM #651](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/651) | Cancellation/exit oracle informs native backend | Native continuation frames, cancellation tree, source executable parity, sanitizers |
| 24 | [Java #1434](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1434) | Shared-state types denied auto traits before verified ABI | Real Arc/Weak/Mutex/RwLock and shared-class AST/runtime lowering |
| 25 | [Java #1435](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1435) | ETS capability SET reference, per-key generations, stale handle/owner revocation | Authenticated, nonparking typed guest tables, heir/STOP/ACL stress and quotas |
| 26 | [Java #1436](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1436) | Declarative atomic STM reference and effect rejection | Compiler-checked pure retry effects, Task suspension, concurrency-safe guest TRef/Ref |
| 27 | [LLVM #659](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/659) | Shared-state source-free contract and Java deny rules for parity | Native ABI, Clang/LLVM lowering, alloc/borrow/sanitizers and guest ETS/STM tests |
| 28 | [Common #80](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/80) | FFI cancellation/timeout/physical return/disposal reference | Verified real FFI generation leases, failure quarantine, safe unload and native IPC boundary |
| 29 | [Java #400](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/400) | Affine data-only Channel transfer and strict linked-import reference | Real TypeChecker async-only Channel case, linked type signature resolution and source tests |
| 30 | [LLVM #45](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/45) | Conservative CFG loan/await/select/static-join reference | Native typed HIR, pinned frames, select cancellation, all-path destruction and ASan/UBSan |

## Verification boundaries

The *committed source-free tests* are in:
`tests/task-carrier-proof-models.test.mjs`, `tests/batch-03-task-ownership.test.mjs`, `tests/batch-03-ets-stm-reference.test.mjs`, `tests/batch-03-ffi-channel-reference.test.mjs`, and `tests/batch-03-cfg-suspension-reference.test.mjs`.

The modules' synthetic cases passed an isolated V8 evaluator (not an executed source-repository Node 22 workflow). Verify the current exact head again with:

```sh
npm test
```

Then require independent reviewed Java JDK25/GraalVM/JUnit, LLVM native CMake/CTest, source-compiled Oreslang tests, and sanitizer runs. **CI jobs that end without visible steps are UNKNOWN, not executed compiler test failures, and do not prove billing exhaustion.**

Private source may not be transferred to an alternate GitHub organization based solely on available Actions budget or private visibility. Incidents [#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22), [#77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77), approval and protected policy gates must be resolved independently before any cross-organization source transfer.

Keep PR #118 and Java #1631 in draft pending actual exact-head CI plus independent review. No unreviewed source import, runtime enablement, branch protection bypass, merge or issue closure is authorized by this batch.

## Additional scalar trait conformance

The synthetic trait model previously accepted `void` as transferable. This disagreed with Java `ThreadSafetyTraits`, which rejects `Primitive.VOID`. The model and an explicit regression have now been updated. Isolated JS results: 45 trait/Task/carrier checks, 7 ETS/STM, 9 FFI/Channel, 10 CFG, and 4 inventory checks: **75/75 passed**. This is not native Node or compiler evidence.
