# Core/Option — 11-backend conformance parity dashboard

**Snapshot:** 2026-11-22 · **Scope:** source inventory / authored guest tests only · **Verified guest passes: 0**

This is not live CI and does not certify compiled Atto guests. An observed main SHA is distinct from the PR candidate head. Source-only and zero-step workflow results cannot promote a gate.

| Backend | Observed main SHA | Option candidate head | Parse/typecheck | Positive guest | Negative guest | JIT | AOT | Sanitizers / memory safety |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `java` | `189c73b88502c451e50494f738ae11a1de8c9211` | [PR](https://github.com/atto-lang/atto-source.java/pull/1767) `7385b682ff28239d1ce1c52fa6d7aedcb4f6b337` | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `llvm` | `553154ac83c060f9182edf751ee6ba6aa192dd3b` | [PR](https://github.com/atto-lang/atto-source.llvm/pull/870) `cae1f89e5a10b2feabe36808c0b07263b4c5a07d` | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `rs` | `877bd9f8d61c598137c8627f73fa5ed2a497d9e8` | [PR](https://github.com/atto-lang/atto-source.rs/pull/533) `e1310a921d41f0fc4ab18b28b7ce4f297b95b754` | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `net` | `75830ed371ec386d2c7ebe162410258d3e9fdbf2` | [PR](https://github.com/atto-lang/atto-source.net/pull/217) `2b4bc19a87c81545a0dd154e35d6e53b7f0e63c7` | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `wasm` | `16ba74ab9f9959cc15d21dcb6e54a18e1c325fef` | [PR](https://github.com/atto-lang/atto-source.wasm/pull/279) `d7642727c43147c83d6c594389080f83993c5b8e` | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `forge` | `f5dd299c277376cabe9e536edbbb4e662a267ad4` | [PR](https://github.com/atto-lang/atto-source.forge/pull/226) `1a892433ba615af863523701d310eace9513028c` | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `cranelift` | `e867c0a5cf8b94f98ce9b1212d2c735b76bc4120` | [PR](https://github.com/atto-lang/atto-source.cranelift/pull/90) `9dc2ee61c1d75815b80460a22c860916a8f147b2` | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `js` | `b8e48b19c33b61e5faa4628bf03bddf2823f403d` | [PR](https://github.com/atto-lang/atto-source.js/pull/132) `b5d4358e50828012512eb95fcc96cff1ba39490a` | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `hdl` | `023455e496bb9cfbdd157ccc94bb69f31eec44ea` | [PR](https://github.com/atto-lang/atto-source.hdl/pull/61) `0ae7590bef154ae6501f87189de116bb371a0770` | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `atto` | `5b9a274490a4567ed9d1088fd1ff304dbe383357` | No candidate identified | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |
| `realtime` | `4f6449470ab075cdad17884c7a1aee2a6e2ab54c` | No candidate identified | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED | NOT_EXECUTED |

## Java core/option source and tests

- Candidate: [atto-source.java #1767](https://github.com/atto-lang/atto-source.java/pull/1767) at `7385b682ff28239d1ce1c52fa6d7aedcb4f6b337`
- Root Git tree: `03981bf0f0540f913a45cbc951934783b61794b5`
- JUnit command (proposed, **not executed**): `mvn -B -ntp -Dtest=CoreOptionResultSourceTest,CoreOptionResultBorrowSafetyTest,AutomaticPreludeTest -DfailIfNoTests=true -Dsurefire.failIfNoSpecifiedTests=true test`
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
| `readOnlyQueriesPreserveBorrowerAndCarrier` | borrow_positive | — | NOT_EXECUTED |
| `borrowedNestedOptionCannotFlattenIntoAnOwner` | borrow_negative | — | NOT_EXECUTED |
| `borrowedOptionCannotExtractOwnedAffineValue` | borrow_negative | — | NOT_EXECUTED |
| `borrowedResultCannotExtractOwnedAffineValue` | borrow_negative | — | NOT_EXECUTED |
| `borrowedOptionCannotRepackageAffineOwnedValue` | borrow_negative | — | NOT_EXECUTED |
| `borrowedOptionCannotEscapeThroughEagerFallback` | borrow_negative | — | NOT_EXECUTED |
| `copyableNestedOptionCanStillReadWithoutStealingOwnership` | borrow_positive | — | NOT_EXECUTED |
| `linkedBorrowedCoreQueriesMustNotConsumeOwner` | compiled_positive_guest | `42` | NOT_EXECUTED |
| `coreTypeRegistryIsTheCanonicalOwnershipAndDropSource` | compiler_admission | — | NOT_EXECUTED |
| `coreRegistryGenericArityIsEnforcedByTheRealTypeChecker` | compiler_reject | — | NOT_EXECUTED |
| `coreProfileRejectsAllocatorTypesWithoutMisclassifyingLegacyString` | compiler_reject | — | NOT_EXECUTED |

## Exact Java file blobs

- `core/option.atto` · `4400fae94588587fbb85474256e82cac6c26256c`
- `core/result.atto` · `6bae249740af1088e069c3592ff8fb2bc72f1216`
- `tests/core_option_result/scalar_roundtrip.atto` · `9d91f9945ad1010b35ecae1f112d405fb8b815d3`
- `tests/core_option_result/lazy_callbacks.atto` · `dce245f73a77fc1717c1fe087bbb3fd273c0c08e`
- `src/test/java/dev/oreslang/CoreOptionResultSourceTest.java` · `ef08bcc9f3165a04a8e57a59525769ad66e7116f`
- `src/test/java/dev/oreslang/CoreOptionResultBorrowSafetyTest.java` · `d44dfe085ed6728e5f5b50be889a1c56bf78bc39`
- `tests/core_option_result/borrowed_queries.atto` · `35f77b9020812364d1d0885e35f53a071cb50134`
- `src/main/java/dev/oreslang/types/OwnershipChecker.java` · `6be88b5f3717f70759440be6a3012a0411f2315b`
- `src/main/java/dev/oreslang/types/TypeChecker.java` · `3c1061d47c087d701f578e39a71ff34ce3197341`
- `.github/workflows/core-option-result-jvm-borrow-exact-head.yml` · `1821c6732b79c090f9cfc93121e3ea20e7a40fc2`
- `src/main/java/dev/oreslang/types/CoreTypeRegistry.java` · `bc9c3574f0e653218ea8a68f85d4effbd6722eeb`
- `src/main/java/dev/oreslang/compiler/OresCompiler.java` · `c60883bf73abf36b89343a2b18feb11565c11c03`
- `src/test/java/dev/oreslang/AutomaticPreludeTest.java` · `0e354f5478a0651127f746e63e86bb5a591bca74`

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

## Rust Copy-carrier correction

The current Rust candidate treats only the existing concrete `Option<int>`,
`Result<int,string>` and nested scalar Option profile as Copy because their
payloads are Copy. A `borrow!` marker in that restricted guest is lowered
through the ordinary value path; it proves reusable Copy values, **not** a
lifetime-bearing borrow or generic affine Option/Result loan. The unchecked
call-argument bypass has been removed. The affine class-owner escape remains
a real `E_BORROW` negative; `Option<Payload>` remains explicitly
`E_UNSUPPORTED_TYPE`. No compiled guest result is promoted before the exact
Rust source-local workflow executes.
