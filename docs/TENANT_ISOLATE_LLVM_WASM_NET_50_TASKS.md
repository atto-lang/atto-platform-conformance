# 50 executable steps: Java-led LLVM / WASM / .NET parity and IsolateVM (2026-10-31)

**Status: implementation backlog and NON-CERTIFYING structural receipt contract.** None of the 50 tasks is marked complete by this document. No source trees or private Git objects may be exported to another organization by these files. Reuse existing issues/PRs; don't spawn duplicate backends, a second parity oracle, or new language keywords.

## Boundaries
- **Java:** reference *where actual source-compiled guest behavior is verified*; Graal Native Image has C isolate/attach APIs but compiling an evaluator alone is not guest AOT. General Java soft-RT, not strict hard-RT.
- **LLVM:** custom native OresVM/IsolateVM, actor-owned nontracing arenas, deterministic drops, strict closed AOT, formally bounded hot paths on named hardware for *qualifiable* hard RT. Native arenas are not by themselves OS security boundaries.
- **WASM:** native Wasmtime `Engine` may share precompiled immutable modules; each tenant owns a distinct `Store` and `Instance`, with explicit host capability broker, quotas, and generation fence. Wasmtime in-process Store is not an OS process boundary. Browser/Node use separate host adapters. WASM guest doesn't require a tracing GC; do not conflate host/runtime allocations with a guest GC promise.
- **.NET:** full Windows/Linux Native AOT, statically generated CIL, OresVM tenant hosts, actor-owned unmanaged guest arenas and distinct tenant mutable globals; host CLR allocations/GC are separate and observable. Neither `AssemblyLoadContext` nor NativeMemory alone is a security boundary. No runtime `Assembly.Load`, `Reflection.Emit`, or JIT fallback.
- **Untrusted tenants:** enforce OS-level sandboxed-process boundary, authenticated permissions and bounded host resource budgets. In-process isolates remain useful for trusted execution.
- **Virtual actors:** remain opt-in and coexist with explicit `spawn`; one tenant-scoped stable logical ActorRef admits zero or one fenced activation at a time. Preserve per-actor message turn, generation and supervisor semantics.
- **Status vocabulary:** host-only/reference, source-rejected, compiled-not-executed, executed-partial, verified by independently authenticated evidence, and not-executed. This receipt validator **cannot** authenticate a run or certify any status on its own.

## P0 shared contract and executable evidence (1–10)
1. Pin Java/LLVM/WASM/.NET main and relevant draft PR source/tree SHA to an immutable reconciliation ledger; track merge status separately.
2. Use existing Rust compiler parity harness and 49-case source corpus; add isolate/RT cases with stable fixture IDs and exact source hashes, not a second oracle.
3. Define stable OresVM, tenant IsolateVM, actor execution/stop, generation and capability vocabulary; preserve source-level `spawn`.
4. Specify tenant-private globals, actor-private heap ownership, resource limits and no cross-tenant writable handles at every ABI.
5. Specify supervisor-priority CONTROL, DATA FIFO, failed-send ownership rollback and exact STOP/retirement receipts.
6. Define `critical-read`/`critical-write`, borrowed state and await/select pin lifetime as identical semantic obligations in each backend.
7. Define permission/broker ABI including flags-2-env CLI parsing, `+/path` import roots, symbols and nonparking channel/Task/Future behavior.
8. Add real positive/negative source-generated guest fixtures: tenant A/B isolated state, restart generation, forged reference, borrow escape, fatal handler and quiescent teardown.
9. Record exact source tree/compiled binary/compiler binary hashes, real workflow steps, expected diagnostics, full-width values, target run traces and independent provenance review.
10. Require protected-source CI and independent destination/privacy/authorization approval before **any** cross-org source export; never treat runner minute exhaustion as approval.

## P0/P1 LLVM native zero-GC + hard RT (11–25)
11. Bind existing native `OwnedHeap`/`EpochArena` to **real compiled** actor instance/state/frame allocation, not host-only arenas (issue #1170).
12. Implement authoritative tenant IsolateVM registry with private mutable module globals, generation and terminal state.
13. Make ActorRef tickets authenticated, generation-scoped and pointer-free on transport; reject forge/replay/cross-tenant reuse.
14. Compile sealed state `handle_state(critical-read|critical-write)` with real read/write admission and safety diagnostics.
15. Wire compiled actor mailboxes, DATA admission, reserved supervisor CONTROL slots, physical turn exclusivity and reliable panic/raise/throw notices.
16. Lower `await`/Task/Future/channel/select continuation ownership; pins survive suspension and unwind only after quiescence (issue #45).
17. Require verified source ownership/borrow `rt take/borrow/share/copy`, check use-after-take and illegal aliasing before LLVM IR.
18. Enforce import/permission and I/O capability checks at guest entry/FFI, including `_blocking` naming rule for synchronous user-facing APIs.
19. Add `strict-hard-rt` target profile admission via target configuration/CLI, not a new syntax keyword (issue #688).
20. Reject strict RT effects: unbounded recursion/loops, unknown FFI/blocking, heap growth, unbounded locks, exceptions without bounded cleanup, dynamic code.
21. Verify **whole-linked** ELF/runtime/FFI image is JIT/interpreter/tracing-GC-free, and trace zero hot-path dynamic allocations after boot.
22. Budget WCET, stack, mailbox, arena, scheduler wake/interrupt, cancellation and STOP cost; reject unknown bounds.
23. Run source-generated actor workload on named Zephyr/RTOS or specifically configured real-time Linux; collect worst-case and deadline evidence, not just average jitter.
24. Implement precompiled/hot-version handoff with actor-state migration and generation-fenced draining; never silently patch code while active loans live.
25. Prove real LLVM guest parity with Java corpus under Clang/GCC, O0/O2, ASan/UBSan, cancellation/tenant fault injection and target-specific hard-RT gates.

## P0/P1 WASM full backend / Wasmtime (26–38)
26. Finish security upgrade to reviewed Wasmtime 49.0.5 **and both real Cargo.lock graphs**, rerun native checks before admitting Wasmtime AOT (issue #213, PR #214).
27. Keep deny-all host imports for zero-I/O core; add versioned, explicitly granted WASI/HTTP/socket imports only after negative security tests.
28. Complete separate Store + Instance per tenant with shared only immutable compiled Module/Engine; enforce generation-fenced tenant host registry (PR #173).
29. Enforce **aggregate host** plus guest memory/stack/table/handle/instance limits, fuel/epoch and hostcall elapsed-work budgets; test denial/fairness.
30. Reject cross-store/engine typed reference substitution and borrowed resource memory escape; bound component-model and cancellation lifetimes.
31. Authenticate precompiled Wasmtime AOT artifacts and exact compiler/runtime pins; no unauthenticated deserialization or production debug caller bypass.
32. Run malicious/untrusted guests in OS-sandboxed child processes, not merely Wasmtime Stores or Node Workers; prove kill/restart budget handling.
33. Compile >=40 stateful Oreslang source actors sharing <=2 bounded carrier Workers with separate actor-private state, fair FIFO and exclusive turns (issue #152).
34. Lower async actors, pinned continuations, cooperative checkpoints and cancellation without losing borrow/ownership invariants.
35. Implement canonical typed MessagePack DATA, supervisor CONTROL admission, atomic ownership on failed send and bounded backpressure.
36. Execute >=1000 LLVM-native ↔ Wasmtime guest typed exchanges, including broker auth, schema errors, epoch rotation, replay and shutdown.
37. Add real browser Worker and Node Worker adapters with separate trust-profile claims; verify no accidental ambient I/O or shared-realm authority.
38. Run actual pinned LLVM→wasm32 compiled `.ores` source fixtures for numeric, structures, Option/Result, match, actor state and imports; no optional compiler skips in required lanes.

## P0/P1 .NET strict Native AOT / tenant VM (39–50)
39. Enforce independent real Windows/Linux CIL→Native AOT compiler and app publication with no JIT/interpreter/dynamic assembly loading.
40. Finish OresVmHost/tenant IsolateVM registry, monotonically fenced handle identity, lifecycle and concurrency-safe stop (PR #243).
41. Generate **tenant-keyed private mutable globals** and source program entry rather than invoking one stateful process-global CIL singleton for all tenants.
42. Lower actor-owned unmanaged heaps, deterministic drops and aggregate RSS/pin budgets; separate native guest storage from host CLR GC (issue #116).
43. Compile async actor continuation frames, await/select pinning, cancellation and quiescent resource retirement into real Native AOT guest code.
44. Enforce one actor logical turn lease, safe cross-actor scheduling, race-free mailbox transfer and STOP between wake/publish.
45. Compile DATA FIFO and authenticated CONTROL failure paths, supervisor panic notices, closure and exactly-once resource retirement.
46. Enforce source ownership and sealed critical state diagnostics, generational borrows and use-after-move rejection before CIL generation.
47. Wire Task/Future/channels, async-only nonparking core I/O, permissions broker/flags-2-env and canonical `+` package import semantics.
48. Introduce signed/authenticated sandboxed **process-per-hostile-tenant** worker mode with IPC capability broker and OS resource quotas; do not claim ALC security.
49. Support hot replacement using precompiled Native AOT versions and generation-fenced process/tenant reactivation; classify in-process binary swap as unsupported until proved.
50. Execute exact-head Windows/Linux real `.ores` guest plus negative fixture matrix, independent Java/LLVM/WASM differential traces, heap/GC/RSS measurements and lifecycle fault injection.

## First strict promotion ladder
- **G0 host-substrate:** unit tests may be real and useful but do not demonstrate compiled guest parity.
- **G1 compiled guest:** real `.ores` source generated to target, run with full-width result witness and compiled negative fixture.
- **G2 tenant:** two independently initialized tenant globals, generation rotation, leak and forged-capability negatives, stop pins and bounded resource enforcement.
- **G3 RT, LLVM only:** fully closed hot-path call graph, no tracing GC/no hot-path dynamic allocation, measured + reasoned WCET under named hardware/RTOS configuration and deadline, proof artifact and independent review.
- **G4 release:** exact-head stepful CI, independent provenance authentication, security review and source-privacy approval. The receipt script only checks shape; a structurally valid receipt is **not** G4 certification.

## Existing work (reconcile, don't duplicate)
- Platform parity: [#209](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/209), [#188](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/188), virtual actors [draft #227](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/227).
- LLVM: [#1170](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/1170), [#688](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/688), [#45](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/45).
- WASM: [#152](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/issues/152), [#203](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/issues/203), [PR #173](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/173), [PR #214](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/214).
- .NET: [#116](https://github.com/ores-truffle-oreslang/oreslang-source.net/issues/116), [PR #243](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/243).
- Security: [platform issue #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) and [#69](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/69): no new private-source export without independent preauthorization.
