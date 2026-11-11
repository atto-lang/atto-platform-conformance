# AttoLang functional value-pipe tuple ABI v1 — exact guest-source conformance

Canonical semantics: one value enters `|>`. A single lambda binder receives it whole (including a tuple); two or more binders destructure exactly one statically typed `Tuple[T1,...,Tn]` with the same arity. `Tuple` return values are one value, not automatically spread as callable arguments; named stages continue to receive exactly one value. No implicit `Option`, `Result`, or `Future` flattening.

## Oracle
- `positive.atto` must compile and execute on the real guest backend with exact observable stdout `39\n` and exit 0, preserving `Tuple[int,int,int]` to `Tuple[int,int]` to scalar results.
- Every `negative/*.atto` must be **rejected during compiler/type/ownership admission** without publishing a guest executable: scalar input passed to a two-parameter binder; 2-tuple to a 3-binder lambda; a named two-parameter function used as a pipe stage (no auto-flatten); and wrong declared tuple return shape.
- Additional Java/GraalVM `ValuePipeOperatorTest` assertions in https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2798 cover nested tuples, fixed arrays, source order, checked output, moved-owner reuse, borrowed values, explicit binder types and typed tuple returns.

## AOT parity gates
Must execute exact same fixture across **real guest compilers**: Java/GraalVM, LLVM native, .NET NativeAOT, Wasm AOT, Forge/Cranelift. For each backend record source fixture blob SHA, exact backend commit and tree, compiler binary identity, actual runner/job non-zero steps, guest stdout/exit and negative diagnostics, *and native artifact evidence where applicable*. Executed host-only/source-free canaries do NOT prove guest execution, nor does a zero-step run.

Currently LLVM native frontend explicitly rejects tuple literal lowering; .NET structured compiler requires tuple ABI lowering; Wasm bridge rejects tuple v2; Forge stage-0 is scalar i64 only. These are implementation blockers, **not parity**. Do not weaken their fail-closed behavior while implementing tuple layout and ownership.

## Java candidate tested with scoped source-exact private mirror
- Source HEAD: `1a5aef1eca85f50f17b55e6926a6f49e23a4e28c`
- Source tree: `9ba464bf23ab816e41586f2c2fcda773ecfacbc8`
- Mirrored 276/276 original source file blobs by Git SHA in private `scintilla-run/scintilla-run-e2e` branch `verification/atto-java-tuple-2798-532b1161`. This is file-exact selected compiler slice, NOT whole repository-tree identity.
- Funded Java proof: https://github.com/scintilla-run/scintilla-run-e2e/actions/runs/42935528933 (30 JUnit passed, positive CLI `39`, 4 negative CLI rejects). Host runtime logs version warnings; no checks disabled.
- NativeAOT proof in same run FAILED during Truffle startup: `ClassNotFoundException: com.oracle.truffle.api.impl.TruffleLocator` with GraalVM 25.0.4 vs Truffle 25.3.4.1. New version-aligned candidate being checked; until native binary runs, status AOT NOT VERIFIED.

Coordination issue: https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/673

No CI check name or docs publication may mark native parity as passed without non-zero-step exact-head receipts.
