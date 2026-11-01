# ORT v3 — scalar-return native guest differential profile

**All nine fixtures are candidate source tests, NOT verified compiler-backed passes.**

Unlike ORT v1/v2, each native Oreslang program exposes `pub fnc main(): int` and must return the integer `0` when its semantic checks are satisfied. The runner must inspect that actual compiler-generated guest result. A successful shell exit, a mock evaluator, `--check` alone, or a host-side hardcoded zero are **not valid observations**.

The nine cases isolate `Some`, `None`, nested absence, `Ok`, `Err`, successful trapped calls, nested trap results, trapped `Err` as ordinary data, and eligible cast failure. Cases deliberately do not require guest stdout. A backend that cannot lower the source must report `unsupported`, not pass.

- `manifest.json`: nine case IDs, source paths, `expected_return: "0"`, target types, and five backend target labels
- `fixture-lock-v3.json`: Git blob locks for all nine source files plus manifest
- `tests/option-result-trap-v3-integrity.test.mjs`: integrity and result-receipt mutation checks
- `bin/verify-option-result-trap-receipt.mjs`: fail-closed `guest_i64` result checks; note that shape validation cannot authenticate an external CI run

Execution partners: [Java/GraalVM #2434](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2434), [LLVM #1297](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1297), [Wasm #265](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/265), [Cranelift #71](https://github.com/ores-truffle-oreslang/oreslang-source.cranelift/pull/71), [.NET NativeAOT #328](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/328).

**Acceptance:** pinned exact source SHA/tree, compiler hash, runtime ABI, independent runner/job/attempt and executed-step evidence; guest `main` returns exactly zero; no source-only or zero-step CI promotion. Do not mirror private source across organizations without independent transfer authorization.
