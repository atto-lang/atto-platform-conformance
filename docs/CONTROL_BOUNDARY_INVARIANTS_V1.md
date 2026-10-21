# Cross-feature control-boundary invariant model v1

**Evidence class:** bounded, source-free JavaScript reference model. This is NOT proof that any Oreslang frontend, scheduler, GraalVM runtime, LLVM runtime, AOT image, or foreign interop implementation obeys the modeled rules.

## Scope and current contract conflicts

1. **`trap`:** Java `main` currently describes callable `trap fnc(): T` as yielding `Option<T>` (`Some(v)` / `None` on an escaping ordinary throw). Existing draft Java PR #1316 instead implements a nominal `TrapResult<T>` with independently projected success/error slots. **These are incompatible result ABIs; this model pins the `main` behavior for comparison only, not an unreviewed language decision.** No release or merge should claim both are the same source ABI. The model also distinguishes `Some(None)` from `None`, and treats `Result.Err`, tuples and records as opaque successful values.
2. **`recover`:** The stricter `docs/EXCEPTION_EFFECT_ADMISSION.md` contract permits a one-use **direct deferred** recover of same-invocation `throw` or `raise`. It forbids recovering `panic`, runtime cancellation and host-fatal control. Java PR #1316 describes a different `recover { ... } catch(...)` mechanism, so its authority scope must be explicitly reconciled; this model is not source grammar admission.
3. **Task cancellation:** `cancel()` requests cancellation; it is not physical termination. Only a terminal result, completed exactly-once cleanup, and observed carrier quiescence may establish `get_done()`. Scope completion requires sealed child admission and physical retirement of *all* children. The bounded model treats a scheduler checkpoint as the point at which a running Task acknowledges cancellation; it does not promise wall-clock cancellation deadlines.
4. **Refinements:** a string length interval `gte 4 and lte 3` is contradictory at definition time and must also fail if dynamically supplied by a schema. The reference model checks bounded nonnegative safe integers only; exact compiler constant normalization and Unicode scalar length remain separate implementation duties.
5. **Failure precedence:** `hostFatal > cancellation > panic > raise > throw`; a lesser failure from `defer`/cleanup is retained as a bounded suppressed diagnostic rather than overwriting a stronger in-flight failure.

## Executable reference checks

`node --test tests/control-boundary-invariants.test.mjs` exercises six independent tests:
- nested `Option`, tuple/record, `Result.Err`, and nontrappable control;
- allowed and forbidden direct recovery;
- all ordered pairs of failure-priority classes;
- bounded exhaustive enumerations of launch, cancellation, suspension, resumption, terminal cleanup and carrier exit;
- deliberately unsafe mutants (early DONE, missing cleanup, double cleanup) plus parent-child completion;
- satisfiable and impossible string length constraints.

The model is deterministic and never reads private compiler source. Existing `npm test` includes these Node tests. A model pass is not a substitute for executing **the same source Oreslang fixtures** with Java/GraalVM and LLVM, across await, generator close, actor teardown, timer/select cancellation, affine moves, and actual scheduler carrier retirement.

## Promotion gates

Before claiming any of these as language features, attach exact source-blob/tree SHA, compiler and runtime SHAs, tool versions, backend name, actual executed step results, source fixture identifiers, and failing-mutant diagnostics to the cross-backend evidence ledger. Keep every unsupported backend explicitly marked not-run/unsupported. CI failure before runner allocation is infrastructure failure, not a positive or negative compiler test.

Current blockers: Java #883/#1132/#1402/#1407; Java PR #1316 trap ABI mismatch; LLVM #143/#651; platform conformance #85/#108; source-local private CI and source-export security gate #962. Do not export private source to unapproved CI carriers merely to get an Actions green indicator.
