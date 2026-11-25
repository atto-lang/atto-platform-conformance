# AttoLang singleton and multi-actor shared-region hardening v1

Status: **source-free candidate; NO production compiler/runtime activation, NO guest conformance claims.**

## Core distinction

`define singleton` is a canonical, once-initialized, **deeply immutable application-domain** identity. It is not itself a globally mutable memory allocation and does not make a raw pointer visible across Graal isolates, WebAssembly workers or independent processes. Identity is resolved from compiler/linker-owned module+declaration identity, with exactly-once complete publication, sticky failure and cyclic-initialization rejection. Frozen payloads cannot contain mutable aliases or initializer `self` escape. The local reference model only covers synchronous immutable scalar/plain-data publication; it deliberately does not prove parallel first access or cross-task cycles.

Mutable cross-actor sharing is a *distinct runtime-owned shared region* backed by a generation-fenced capability and a logical-execution-scoped fair RW gate. Actor-private heap memory and sealed actor state are not reclassified as globally shared merely because several actors have access to the same singleton. The owning actor (or trusted runtime authority) remains the **one semantic allocation owner** until an explicit quiescent move. An exclusive writer borrow may be delegated without creating a second owner. Normal actor-to-actor mutations should still prefer typed message passing.

## Invariants to implement in every backend

1. Each region has one canonical backing allocation and one semantic owner (actor incarnation or trusted runtime); not one copy per memory slice.
2. `readers >= 0`, `writers in {0,1}`, and `writers==1 => readers==0`; the owner must acquire the gate too, with no raw-address bypass.
3. FIFO scheduling admits an initial contiguous reader cohort, puts a barrier behind queued writers, and cannot let late readers bypass an earlier writer. No carrier-thread parking or OS-thread-bound ownership proof.
4. Borrow authority comes from a runtime-authenticated actor/incarnation plus logical execution/slot/generation, bounded one-use delegation bound to a recipient **logical execution**, not merely actor identity, and an owner epoch. A guest-supplied ID or `has_lock` boolean is insufficient. A second region lease held by the same execution is rejected in V1 until a checked global order is proven.
5. Borrowed state cannot escape via closures, FFI, globals, channels, pub-sub, tasks or actor messages. The compiler must reject `await`, `select`, yield, cancellation continuation and hidden effects across a critical loan until suspension-safe loans are separately proven.
6. Recursive acquisition, unproven nested acquisition across different shared regions, read-to-write upgrade, duplicate release, stale execution, actor restart, foreign application-domain/isolate/host, and untrusted actor authority fail closed.
7. Queue, reader, grant ledger and shared-region bytes have enforceable quotas. Admission failure must not consume a one-use grant; terminal tickets must not be retained forever.
8. Owner transfer requires zero active readers/writers, pending reservations, live grants, guest turns and foreign pins. Epoch changes invalidate prior owner authority. Never move a sealed actor-state root.
9. STOP immediately seals new access and revokes logical authority. Physical reclamation waits for current guest turns, active loans, terminal Future observers, callbacks and FFI pins. A supervisor is not automatically entitled to a child's private state.
10. Cross-process, tenant, native isolate and Wasm Worker transport requires approved descriptors/copies and proven shared backing. Cross-slice is a logical region property, not a promise that every backend can share raw addresses.

## Source-free reference oracle included in the local artifact

`multi-actor-shared-region-v1.mjs` + `multi-actor-shared-region-v1.test.mjs` model immutable singleton publication and three trusted actors registered on distinct memory slices. The prior Node 22 local baseline ran 23 focused tests (including a bounded matrix of 12 queue/reader capacity combinations). The current branch authors 30 focused tests; the additional 6 are **not yet certified by executed current-head CI**. It catches singleton alias publication, cycle swallowed by initializer, forged/cross-host identity, stale delegated grants, writer/read conflicts, writer barriers, quotas, transfer during loans, stop during active access, stale incarnation, reclaimed memory and retained ticket maps.

The model is *not* a real concurrent RW lock, compiler/MIR borrow checker, native memory allocator, Java/Graal guest, LLVM compiled guest, Wasm cross-worker implementation, .NET NativeAOT, Forge/Cranelift JIT, or formal proof. The trusted host/test harness is deliberately **not** an interface that guest code may invoke. Its test introspection methods do not create production security authority.

## Required implementation order and exact-head evidence

1. Reconcile Java singleton candidate #2749 and existing singleton admission #2316. Preserve `define singleton` contextual spelling. Implement check-only type/effect/borrow soundness first; then domain-scoped once-registry and real guest lowering.
2. Reconcile Java logical RW loan #2747 (stacked on #2335) with `rt proxy` and SHARED/PRIVATE/UNTRUSTED actor-owned heap rules. Introduce distinct runtime-owned guarded shared region only after compiler and allocator provenance enforce its lifetime.
3. Reconcile LLVM singleton admission #1203 and native state-region/lease code; verify the compiled guest at exact SHA using CTest, ASan/UBSan, OS-level contention and zero-GC allocations. Hard real-time admission remains a separate claim.
4. .NET #267: enable checked semantics and CIL + NativeAOT, not merely unsupported-syntax diagnostics. Wasm #191: use pinned LLVM compiler with real Worker/isolate execution and memory-sharing capability checks. Forge #146/#159: prove compiled stage-0 guest and authenticated dispatch, with CTest and sanitizers.
5. Run frozen 20-case `singleton-shared-state-v1` matrix without weakening it, then add cross-slice three-actor tests as a separate additive gate. Keep experimental Cranelift/JS/Rust/HDL support as an explicitly separate inventory.
6. Require exact source tree, compiler checksum, nonzero runner/job steps, guest binaries/digests, sanitizer receipts, reviewer authorization, and fail-closed `NOT_EXECUTED` if infrastructure fails. No cross-org private source export without explicit approved destination and independent approval.

**Repository references:** conformance PRs #242, #255, #256, #651, #656; Java PRs #2316, #2747, #2749; LLVM #1203; .NET #267; Wasm #191; Forge #146 and #159.

## 2026-11-11 reconciliation with actor/supervisor model #656

This branch **does not supersede** #656. Its one-owner/many-reader or one-writer
rule, one-use authenticated grants, FIFO writer barrier, no read-to-write upgrade,
failure-atomic admission, STOP/logical revocation and physical retirement fences
must be interpreted identically. #656 additionally models lexical alias trees,
owner raw field access, supervisor physical turns and bounded model interleavings.
Those source-only proofs do **not** automatically carry over to this model.

The cross-slice multi-actor model adds the following explicit hardening:

- Ending a logical execution revokes all unused grants addressed to that exact
  execution handle. Otherwise a dead recipient could permanently occupy the
  grant quota and prevent a quiescent owner transfer. An execution's reuse of
  the same textual ID cannot revive the old capability.
- Cross-region nested loans are rejected in both acquisition orders, **before**
  consuming any authorization, until a common global lock-order proof exists.
  This remains a conservative denial, not a claimed ordered-lock implementation.
- Cancellation followed by actor STOP cancels queue reservations but never
  pretends an active writer's physical loan has unwound.
- A separate trusted-scheduler beginRegionTurn / endRegionTurn model pins
  physical activity even when the lexical loan has already been released.
  Owner move and STOP reclamation require this pin to reach zero. Duplicate
  completion, quota overflow and direct untrusted invocation are denied.
  This **models** guest turns; it is not an OS lock or host callback/FFI pin.
- Fairness tests exercise **3, 7 and 15** independent actor memory slices after
  an already queued writer, with assertions that none barges ahead of it.

**Current head evidence boundary:** 30 test cases are committed, not confirmed
executed. The new same-repository exact-head workflow records the head SHA,
Git tree, Git blobs and run ID and demands a nonzero-step Node 22 run with
30/30 passing and no skips/cancellations. Initial workflow run
[43030694512](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/43030694512)
finished as a runner-admission failure: job 130556649404 reported steps=null.
It is **NOT_EXECUTED**, not an implementation failure or success.
The #656 focused **44/44 hosted** source-free receipt is not a result for
this distinct PR head. Its general harness's **13 actual failures** remain
independent conformance blockers.

**Still missing:** actual Java/Graal singleton code generation, authenticated
runtime shared-region allocation, NLL/borrow and effect lowering, real scheduler
pin/FFI callback fencing, crash-safe native/Wasm/.NET admission, full-AOT guest
execution, independent review and a successful exact-head hosted runner.
No cross-organization private-source transfer is authorized by this PR.
