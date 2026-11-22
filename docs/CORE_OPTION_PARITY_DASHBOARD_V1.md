# Core/Option — 11-backend conformance parity dashboard

**Snapshot:** 2026-11-22 · **Scope:** source inventory / authored guest tests only · **Verified guest passes: 0**

This is not live CI and does not certify compiled Atto guests. An observed main SHA is distinct from the PR candidate head. Source-only and zero-step workflow results cannot promote a gate.

| Backend | Observed main SHA | Option candidate head | Parse/typecheck | Positive guest | Negative guest | JIT | AOT | Sanitizers / memory safety |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `java` | `189c73b88502c451e50494f738ae11a1de8c9211` | [PR](https://github.com/atto-lang/atto-source.java/pull/1767) `2314988a9ade22f5d0a3284f69b142b7e1800914` | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `llvm` | `553154ac83c060f9182edf751ee6ba6aa192dd3b` | [PR](https://github.com/atto-lang/atto-source.llvm/pull/870) `216c4222414d34f43ed2a6dbd4e6c640f25dae20` | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `rs` | `877bd9f8d61c598137c8627f73fa5ed2a497d9e8` | [PR](https://github.com/atto-lang/atto-source.rs/pull/533) `9e4af78f2115f9ea260394929c125c930fab94fc` | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `net` | `75830ed371ec386d2c7ebe162410258d3e9fdbf2` | [PR](https://github.com/atto-lang/atto-source.net/pull/217) `496dddbb595ea5e61489eab8c2b4eac8c86a2d19` | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `wasm` | `16ba74ab9f9959cc15d21dcb6e54a18e1c325fef` | [PR](https://github.com/atto-lang/atto-source.wasm/pull/279) `85de1a3032c78ce1dea080d7c28953c692b610d3` | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `forge` | `f5dd299c277376cabe9e536edbbb4e662a267ad4` | [PR](https://github.com/atto-lang/atto-source.forge/pull/226) `b3d79e3191fd32f155d57c1a272af6b13b7f9172` | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `cranelift` | `e867c0a5cf8b94f98ce9b1212d2c735b76bc4120` | [PR](https://github.com/atto-lang/atto-source.cranelift/pull/90) `f24d89ecf2a0384a51b1c6a5dec955ecdfab1727` | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `js` | `b8e48b19c33b61e5faa4628bf03bddf2823f403d` | [PR](https://github.com/atto-lang/atto-source.js/pull/132) `2bd0febcb4b94bc57f426a7d551af0bd72e860cd` | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `hdl` | `023455e496bb9cfbdd157ccc94bb69f31eec44ea` | [PR](https://github.com/atto-lang/atto-source.hdl/pull/61) `a69b9c62424e560ac15b682c96309be78f124fad` | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `atto` | `5b9a274490a4567ed9d1088fd1ff304dbe383357` | No candidate identified | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `realtime` | `4f6449470ab075cdad17884c7a1aee2a6e2ab54c` | No candidate identified | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |

## Java core/option source and tests

- Candidate: [atto-source.java #1767](https://github.com/atto-lang/atto-source.java/pull/1767) at `2314988a9ade22f5d0a3284f69b142b7e1800914`
- Root Git tree: `eb1541cbd7d3798bea8610a2010326d82c6cdbca`
- JUnit command (proposed, **not executed**): `mvn -B -Dtest=CoreOptionResultSourceTest test`
- AOT: Not provided by this PR; require independent GraalVM Native Image exact-head build and guest receipt.
- Sanitizers/memory safety: Java: ownership/poison/drop assertions; LLVM/native: ASan/UBSan or equivalent; non-native profiles: target-specific memory safety gates.

| Authored Java test | Kind | Expected stdout | Status |
| --- | --- | --- | --- |
| `libraryModulesMustParseAndTypecheck` | compiler_admission | — | NOT_EXECUTED |
| `coreNamespaceIsSourceIdentityNotImplicitImportAuthority` | negative_admission | — | NOT_EXECUTED |
| `linkedGuestMustExecuteNestedSumRoundtrip` | compiled_positive_guest | `42` | NOT_EXECUTED |
| `sourceLinkedCallbacksMustSkipInactiveVariants` | compiled_positive_guest | `M42:Etrue:true:true` | NOT_EXECUTED |
| `resultAndOptionMustRemainNominalDisjointVariants` | compiler_reject | — | NOT_EXECUTED |
| `nestedOptionMustNotImplicitlyUnwrapTwice` | compiler_reject | — | NOT_EXECUTED |

## Exact Java file blobs

- `core/option.atto` · `08bacaaf1c12510909931e20829d4867653793ae`
- `core/result.atto` · `0f07d8f50187495d2846f8773c306b649ab4b89b`
- `tests/core_option_result/scalar_roundtrip.atto` · `9d91f9945ad1010b35ecae1f112d405fb8b815d3`
- `tests/core_option_result/lazy_callbacks.atto` · `dce245f73a77fc1717c1fe087bbb3fd273c0c08e`
- `src/test/java/dev/oreslang/CoreOptionResultSourceTest.java` · `4d4950a2d3b1970499ba6eccbd5552143f4023da`

## Capability limitations (NOT verified as supported or unsupported)

- **java:** Compiler-owned generic ADT extraction and linked package import are unverified. (UNVERIFIED)
- **llvm:** Generic sum lowering and native drop semantics remain unverified. (UNVERIFIED)
- **rs:** Generic ADT extraction and Rust-to-Wasm import linkage remain unverified. (UNVERIFIED)
- **net:** NativeAOT source adapter guest integration remains unverified. (UNVERIFIED)
- **wasm:** Typed Wasm sum lowering and independent runtime guest execution remain unverified. (UNVERIFIED)
- **forge:** Bootstrap sum lowering may reject the proposed adapters. (UNVERIFIED)
- **cranelift:** Generic ADT admission and native compiled guest remain unverified. (UNVERIFIED)
- **js:** Current candidate targets concrete scalars; generic callbacks, affine ownership and nested transpose need separate proof. (UNVERIFIED)
- **hdl:** Candidate tagged sum RTL lowering and synthesis are not verified; no scalar-source test implies hardware support. (UNVERIFIED)
- **atto:** No dedicated core/option candidate PR identified in this snapshot. (UNVERIFIED)
- **realtime:** No dedicated core/option candidate PR identified; deterministic runtime/zero allocation proof needed. (UNVERIFIED)

## Evidence admission and no-fake-PASS gate

- All six execution checks for every backend remain `not_executed` with a null receipt. Unsupported capability claims also remain unverified.
- A real guest result requires independently authenticated repository ID, exact compiler head and root tree, exact fixture blob, job/run/attempt and executed compiler + guest steps with observed outputs and failure diagnostics.
- Native AOT and ASan/UBSan or equivalent memory-safety evidence must be independent, profile-specific checks; they cannot be inferred from source-only or JIT execution.
- The source-only v1 validator rejects all claimed PASS, UNSUPPORTED or attached self-authored receipts. A separately reviewed authenticated evidence importer is required before promoting any result.

_Generated deterministically by `lib/core-option-parity-dashboard-v1.mjs`; do not edit the table by hand._
