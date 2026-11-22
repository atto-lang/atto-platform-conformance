# ORT v4: `Option<Result<T,E>>` trap-envelope conformance

**Every fixture is AUTHORED_NOT_EXECUTED / NOT_CERTIFIED.** V4 is an incremental, stacked companion to conformance PR #290; it does not alter V1–V3.

- `None` means an eligible ordinary Ores `throw` escaped the trap boundary (the thrown error detail is lost).
- `Some(Ok(value))` means normal return of typed success.
- `Some(Err(error))` means normal return of typed application error **as data**.
- `Some(None)` means successful return of an absent Option payload.
- `Some(Ok(None))` means a successful typed Result carrying absence.
- `panic`, `raise`, cancellation, forced termination and host-fatal conditions are NOT converted to `None`.
- `trap checked()` where `checked()` is already `Option<Result<T,E>>` must be `Option<Option<Result<T,E>>>`; never implicitly flatten.

For ordinary error-aware lookup APIs prefer `Result<Option<T>,E>`. Use `Option<Result<T,E>>` specifically when **a lossy trap wrapper** is required outside a typed Result API; do not use it as a universal error-return type.

V4 has seven scalar-return guest cases, one panic-bypass guest case, and three semantic compile-reject cases; each source must be verified against its Git blob lock. Scalar guest success requires actual compiler-produced `main(): int` return `0`, NOT just process exit 0. Negative semantic type checks must not be counted when an unsupported parser token is rejected. Any signed evidence receipt is shape-checked locally but still requires independent exact-head source-tree, compiler, runner, job, executed-step and guest-log provenance.

Targets: `java`, `llvm`, `wasm`, `cranelift`, `net`, `forge`, `js`, `rust`, `hdl`. These are requested coverage targets, NOT backend feature or parity claims. Forge and JS have separate unsupported-syntax admission PRs, not executed guest semantics. No private source mirroring is authorized by this change.

## V4 hardening addendum (2026-11-08)

The receipt verifier now rejects internally contradictory outcome claims: a guest panic
or semantic compile reject cannot also contain scalar return fields. Scalar success
must explicitly report `runtimeControl=normal` and empty stderr; the Result.unwrap
panic must report `guestPanicCode=RESULT_UNWRAP_ERR` and an unwrap-related diagnostic.
A V4 negative compile case must report `runtimeControl=not_launched`,
`diagnosticOrigin=typechecker` and a nonempty diagnostic code. Explicit
`parserOnly` / `unsupportedFeature` receipts fail.

For **review lookup only**, V4 reports must provide `workflowRunId`, `jobId`,
`sourceTreeSha` and an executed `compilerStep` distinct from the guest step.
These fields are self-reported and **do not authenticate a run**. Reviewers must
independently fetch the matching GitHub job, confirm nonzero actual steps and
verify source-tree/compiler provenance and real diagnostic/guest logs. Host-only
source-shape tests check that source test cases still contain the intended
expressions, but are NOT compiler tests. This stacked PR remains draft.
