# Option / Result / trap — native Oreslang differential fixtures v1

These files contain **29 positive guest assertions**, **7 negative compiler fixtures**, and **one non-trappable panic fixture**. They are authored candidates, **not compiler-backed evidence**.

The source-level reference is the canonical Java/GraalVM `docs/TRAP.md`: `trap` maps ordinary thrown failures to `None` and successful values to `Some(T)`; `Result.Err` stays `Some(Err)`. Panic, raise, cancellation and termination bypass `trap`. Nested `Option` never auto-flattens.

- Run `positive.ores` with **a real backend compiler plus guest runtime**, and compare the entire stdout against `manifest.json` with no extra output and exit 0.
- Each `negative/*.ores` must be rejected **during compiler type checking**, with a recognized diagnostic and without starting guest execution; parse errors not attributable to the intended rule must not pass.
- Run `panic_bypasses_trap.ores` separately. A native guest panic must preserve its domain and never print the forbidden marker or turn into successful `None`.
- Pin exact source tree, stdlib/tree digest, compiler executable SHA256, runtime ABI/version, fixture blob SHA and executed runner/job steps. Zero-step/host-only evidence never promotes parity.

Backend status at authoring: all **not_run**. A rejection of an unsupported feature is not a positive semantic pass. Java, LLVM, Wasm, Cranelift, and .NET must produce independent provenance and diagnostics. The baseline `.NET` and Cranelift backends have documented narrow scalar subsets; do not describe these fixtures as already supported there.

Unimplemented follow-up cases: `async trap` across suspension, typed postfix `?`, optional chaining `?.`, throw/raise/cancellation/supervisor isolation, actor-owned move/borrow payloads, and `Option<void>` across FFI. These require verified backend grammar and runtime support. Do not silently turn an unsupported case into a passing rejection.

Expected exact stdout for positive fixture: `ORT1:11111111111111111111111111111:END`.
