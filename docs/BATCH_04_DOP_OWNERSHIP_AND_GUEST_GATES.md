# Batch 4 — DOP / ownership / compiler parity (tasks 31–40)

Status: implementation work on existing compiler drafts plus one new current-main compiler soundness PR; **no completed cross-backend release gates**. This inventory intentionally does not reuse the unrelated "batch 04" hot-upgrade/IPC draft.

## Target-specific implementation state

| Task | Canonical issue | Live implementation anchor | Remaining exact-source acceptance gate |
|---|---|---|---|
| 31 | [Java #1424](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1424) | [Java #1445](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1445): parser/AST and host SoA runtime; guest lowering intentionally gated | Typed guest InvertedArray source, field loans, compiler code generation, Java JUnit with stepful exact head |
| 32 | [LLVM #658](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/658) | [LLVM #720](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/720): typed native SoA, checked handles and loans | Actual Oreslang source -> native column IR, O0/O2 CTest, ASan/UBSan |
| 33 | [Java #1349](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1349) | SealedActorState and CriticalRwGate integration drafts | Proven logical RW continuation tickets and physical-exit cancellation with real compiled guest |
| 34 | [LLVM #635](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/635) | [LLVM #633](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/633): native sync reference | Real native source-level Mutex/RwLock linear guards, nonparking and sanitizer tests |
| 35 | [LLVM #636](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/636) | Native RW host gate | STOP/CONTROL + actor incarnation and 3-carrier compiled actor conformance |
| 36 | [Java #853](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/853) | **New current-main [Java #1675](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1675)** with Types/TypeChecker writable invariance fix and six JUnit tests. Supersedes conflicted [#1039](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1039). | Exact-head JDK25 Maven + source guest tests, review/merge |
| 37 | [Java #821](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/821) | [Java #1114](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1114) structural/tuple integration (currently conflicting) | Record schema vs owned struct closed-world AST, mutable field invariant and cross-backend source parity |
| 38 | [LLVM #579](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/579) | Native DOP/loan reference | Compiler-proven `noalias`/scoped aliases, actual SIMD optimization remarks, float ordering, sanitizer/benchmark |
| 39 | [LLVM #462](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/issues/462) | Java persistent actor data prototype | Native immutable HAMT/reducer with heap/actor lifetime proofs and source guest |
| 40 | [Data Science #9](https://github.com/ores-truffle-oreslang/oreslang-data-science/issues/9) | [Data Science #15](https://github.com/ores-truffle-oreslang/oreslang-data-science/pull/15) Oreslang guest matrix overflow checks | Canonical NdArray<dtype> shape/stride/ownership ABI, real compiled execution and all-target parity |

## What was actually changed in this turn

- Implemented a **real Java compiler type-soundness fix on fresh current-main branch**, PR #1675. Both general `Types.isAssignable` and `TypeChecker.structuralRecordAssignable` now protect writable members invariantly while retaining safe readonly width/covariant views. The previous issue-specific PR was not mergeable with current main.
- Committed six JUnit regression cases including 7×7 type variance, nested writable fields, unknown/generic readonly refusals, closed owned structs, and readonly width/numeric covariance.
- Corrected tasks 31–40 in machine-readable audit; added three source-free inventory validation tests. These **do not certify any runtime feature**.
- Independently retried Java source-local fast-ci earlier in this turn (run #39430138123); GitHub accepted the rerun, but job attempt again had `steps:null`. GitHub job logs returned missing blob. No evidence of Maven/JUnit execution. Do not infer Actions budget cause or promote synthetic tests as guest proof.

## Release policy

Task 31 requires Java compiler actual InvertedArray<T> guest source support; native host column storage alone does not qualify. Task 32 requires actual LLVM source-to-IR lowering; host C++ spans alone do not qualify. Task 36 has production compiler changes staged but remains blocked until independently reviewed actual execution. Tasks 38 and 40 require measured—not modeled—native SIMD and shape runtime receipts.

Do not copy private source to external organizations just to use available Actions minutes; an explicitly approved protected-main publisher and immutable destination/source identity are prerequisites. Never claim success from a workflow with unobserved steps.

## Follow-up code changes

- Java [#1675](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1675) now includes readonly structural-pattern and named structural-parameter protections on current-main `AggregateKind.CONTRACT`, with **10 committed JUnit tests** including Parser-to-TypeChecker source tests (head `45de298c719d9c7df0e9fe7e5821e198dae3daa0`). Not executed.
- Java [#1445](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1445) adds two actual JUnit regressions for IEEE signed zero/NaN storage and structural-loan fencing (head `062d96bf359d5f5c84038a1fe44207b8bcee3043`). Not executed.
- Data Science [#15](https://github.com/ores-truffle-oreslang/oreslang-data-science/pull/15) adds two **Oreslang guest-source** test fixtures for valid zero-row matrices, negative extents and out-of-bounds indexing, corrected to explicit Result bindings (head `216cd6ac064abe87e3b62662648a209922f90a1d`). Guest compilation not observed.
- A read-only local tool retry of LLVM source-org run `39359520937` was accepted, but its subsequent job still reported `steps:null`; no LLVM compiler execution can be claimed.

## October 20 validation follow-up: exact-head static correctness and CI

- [Java #1675](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1675) now carries **12** JUnit tests. The two negative guest fixtures separate `Parser.parse` success from `TypeChecker.check` rejection and require a readonly-specific diagnostic. Named structural trait testing covers denial of mutable field access and preservation of callable method dispatch. Source head `30d2190c977eca4b6cce284cd7a0fde5f97b3b43`.
- [LLVM #720](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/720) now offers an **opt-in C++20 AddressSanitizer+UndefinedBehaviorSanitizer** CMake/CTest target `dop_inverted_columns_asan_ubsan` with `-DORESLANG_DOP_ASAN_UBSAN=ON`. Source head `92a50bac0a397b3499f18fa580c0cc419c283e1e`.
- A **source-free local** GCC14 CMake option-wiring smoke executed successfully (1/1 CTest), using a trivial signed-zero sample rather than any Oreslang private compiler source. This does **not** qualify native SoA code or guest lowering.
- Real Actions reruns: Java [#39442505884](https://github.com/ores-truffle-oreslang/oreslang-source.java/actions/runs/39442505884) and LLVM [#39437133462](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/39437133462), both attempt 2, again reported failure with no steps. This is **infrastructure/unobserved execution**, not a JUnit/C++ test verdict. Source-local runner/billing/org-policy check required; GitHub blocker [Java #963](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/963) now contains the exact run metadata.

**Promotion gates unchanged:** independent protected-main review, exact-head JDK25/GraalVM guest compilation, LLVM actual compiler+CTest+ASan/UBSan, and source-language SoA lowering (rather than just host C++) are still missing. No private source copied to an unapproved CI destination.
