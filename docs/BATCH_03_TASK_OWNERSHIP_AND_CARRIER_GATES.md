# Batch 03 — Task ownership, Send/Sync, actor RW and carrier budgets

**Date:** 2026-10-19 UTC. **Work items:** 21–30 of the 100-item Oreslang backlog.

**Trust boundary:** this PR supplies source-free executable **reference models and
adversarial conformance tests**. It does not enable Task guest syntax, mint
execution permits, run a compiler, change runtime production, or certify
any target backend. Boolean layout/provenance input is a synthetic fixture
assumption, **never** an authorization supplied by guest code.

## Work delivered

1. `CarrierBudgetModel`: enforces five minimum execution-domain reserves
   (CONTROL, PRIVATE, SHARED, UNTRUSTED, LIFECYCLE_OBSERVER), global caps
   5..256, reserve-preserving opportunistic borrowing and all-or-nothing
   nonblocking permit acquisition. A worker is not considered entered until
   `enter`; failed startup returns capacity; `exit` is legal only after
   physical entry; shutdown seals admission and requires all permits retired.
   No selector/reactor or JVM background threads are modeled.
2. `deriveSendSync`: conservative compiler-like structural traits for scalar,
   tuple/record, Option/List, Arc/Weak, Mutex, RwLock, Cell/RefCell, local Rc,
   opaque/FFI handles and shared/mutable borrowed values. Unknown types,
   recursive descriptors, unsafe guest trait flags and excessive type depth
   fail closed. In the model `RwLock<T>` is Send if T Send, but Sync only
   if T Send+Sync; `Mutex<T>` is Send+Sync if T Send.
3. `ScopedLoanModel`: checked read/write Task capture footprints over
   owner/domain/allocation/generation and trusted field/half-open range
   projections. Unknown aliasing conflicts, mixed actor owners reject,
   read requires Sync, write requires Send, and a shared borrow alone cannot
   confer write authority. Admission is atomic; cancellation never releases
   loans, only explicit **physically quiescent** child retirement does.
   Structural layout generations cannot advance with potentially aliasing
   live loans. This is **not** a verified caller-provided `ExecutionPermit`.
4. `ActorStateRwModel`: models `maxThreads=1` default and explicit
   `maxThreads=3`. A FIFO gate admits reader cohorts up to capacity, one
   exclusive writer, and prevents new readers bypassing a queued writer.
   Owner/incarnation identity and logical turn are pinned; STOP rejects queued
   admissions while active guest turns must physically retire. Loans crossing
   await/select/I/O fail closed. No guest callback runs under the model's
   scheduling metadata.

The models are OS-independent, but JavaScript's abstract state machines are
**not** the freestanding Oreslang `core` ABI or its LLVM implementation.

## Task-by-task executable release gates

| Task | Upstream | Still required beyond this PR |
| --- | --- | --- |
| 21 | [Java #1403](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1403) | Integrate real scheduler Task cancellation, actor/root scope authority, cancelled await deregistration, child physical retirement and owner supervision. |
| 22 | [Java PR #1407](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1407) | Run actual TaskHandle/TaskScope JUnit against exact stacked source head, with running cancellation and callback/reentrancy stress. |
| 23 | [Java #1437](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1437) | Derive trusted Send/Sync on compiler semantic AST, prove transitive capture and lifetime ownership, forbid unscoped borrowed escape, emit unforgeable permits. |
| 24 | [Java PR #1448](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1448) | Connect loan footprints to the actual OwnershipChecker Task AST, trustworthy alias layouts and runtime quiescence; validate with compiled guest. |
| 25 | [Java PR #1444](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1444) | Full Graal/JDK25 source test suite, actual async source compilation, no unsupported guest Arc exposure, JVM/native parity. |
| 26 | [LLVM #651](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/651) | Native continuation cancellation tree and Task join that retires after actual physical cleanup; ASan/TSan/native guest evidence. |
| 27 | [LLVM #636](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/636) | LLVM compiled actor `state {}` RW admission for max=3, STOP/CONTROL generation fencing and 10k real native stress/sanitizer checks. |
| 28 | [Java #1349](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1349) | Integrate sealed `handle_state` / `using state.read/write` with real fair gate; verify 1 vs 3 guest carriers and suspension safety. |
| 29 | [Java #1303](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1303) | Replace static runtime partition with work-conserving **physical** worker accounting in JVM/native startup/shutdown paths, excluding NIO reactor. |
| 30 | [Java PR #1410](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1410) | Run actual Graal JDK25 critical contention and nonparking ROOT/CONTROL Future tests with exact head and native-image checks. |

All ten are `PENDING_REAL_SOURCE_EXECUTION`, as recorded in
`audits/batch-03-task-ownership.json`.

## Checked contemporary source PR/CI evidence

Authenticated GitHub snapshot (the exact heads can change):

- [Java #1407](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1407) draft head `e9db87e80cd7524a4fb02503ee68206cb85e9ec9`,
  stacked on Task cancellation PR #1402; most recent inspected
  workflow `39199155641` failed, with job `steps:null`.
- [Java #1448](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1448) draft head `ff86a401c9f2f5b57cd885776cbf07260a1115d0`,
  stacked on Send/Sync #1439; workflow `39195142409` failed,
  job `steps:null`.
- [Java #1444](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1444) draft head `245db1999d5cc236759e8058ede52e72007acb97`,
  source-org workflow `39193408408` failed with `steps:null`.
  Prior isolated source-blob private carrier tests do **not**
  independently authorize cross-org transfers or qualify the full tree.
- [Java #1410](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1410) draft head `402fba3420d1dc14ba82edead42ac1936a93d21b`,
  stacked on the Critical callable base; workflow `39175867043`
  failed, job `steps:null`.

**Do not infer Actions billing cause, zero actually executed steps, or a
compiler regression from `steps:null`: job-step execution is unobserved.**

## Verification and CI contract

```sh
node --test tests/task-carrier-proof-models.test.mjs
node --test tests/batch-03-task-ownership.test.mjs
# Repository full source-free suite:
npm test
```

The tests are automatically picked up by the repo's Node 22 workflow once a
runner is assigned. At preparation time, **47/47 cases passed under an
isolated V8 evaluator with Node assertion shims**, *not* under an exact-head
Node `node --test` or GitHub Actions runner. They include 60,000 seeded
carrier acquisition/exit operations across caps 5–256. These are reference
oracle tests, not compiled Java/LLVM tests.

## Security holds and next integration order

1. Do not copy private source to any other org merely because its Actions
   minutes are available. Historical [incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22),
   [incident #77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77),
   source bootstrap [#69](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/69),
   reviewed exact destination ID and immutable snapshot admission remain
   mandatory before any cross-org source transfer.
2. Independently review Java staged prerequisites #1402 → #1407 and
   #1439 → #1448; don't merge a stacked child ahead of its parent.
3. Add actual parser/typechecker hooks, no-escape lifetime proof and source
   `nb scope` admission only after trusted compiler-created capability
   identities can feed an execution permit.
4. Attach Task outcome and child physical-exit receipts to actor/root scopes;
   propagate STOP, cancellation, control and supervisor outcomes exactly once.
5. Verify real source-local Java/Graal and LLVM guest execution on exact
   reviewed heads, including max=3 RW stress and carrier worker lifecycle.
6. Only then consider lifting syntax/runtime support flags from UNSUPPORTED
   to verified. Remain DRAFT until executed CI and independent review.

**No source export, issue closure, branch-protection mutation or runtime
enabling operation is performed by these reference tests.**
