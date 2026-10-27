# Future ↔ Task v1 conformance fixtures

Status: **proposal; not executable test passes**. The source examples illustrate intended guest syntax for both directions and the canonical `Future.from_task(task { ... })` inline expression. Parser admission, static ownership proofs, runtime behavior and cross-backend AOT are pending. Negative fixtures must reject for the **intended error**, not merely fail to parse for unrelated reasons.

Read `docs/FUTURE_TASK_INTEROP_V1.md` for the complete typed contract, including observer-only cancellation, single-owner result claims, scheduler confinement, physical quiescence, generational fencing and effect propagation. `manifest.json` provides 22 non-green acceptance vectors and an empty evidence array.

For each backend (Java/GraalVM, LLVM, WASM, Forge, .NET) record exact source SHA, compiler and executable identities, real executed commands with logs, runner id and steps, positive/negative results and physical-retirement evidence. Do **not** set `runtimeVerified=true`, `verified=true`, or backend statuses to `pass` based on host-only models, parser-only checks, zero-step Actions or documentation.

Suggested validation order: parser/formatter and type/ownership rejection → scheduler host single-carrier race tests → real guest compile and execution → failure/cancellation/actor STOP and physical join → LLVM/GraalVM full native AOT → remaining backend parity. Do not mirror private source across GitHub organizations until independently authorized by the origin repository's security policy.

Companion bridge: `docs/OBSERVABLE_FUTURE_TASK_INTEROP_V1.md` and `fixtures/observable-future-task-interop/v1/manifest.json` add the `Observable.from_future/from_task`, `to_obs`, and explicit `Future/Task.from_observable(..., mode=#single|#first)` API vectors. Companion vectors are pending, not executed.
