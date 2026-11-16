# Guarded ADT guest AOT conformance — starter milestone

This first executable-feature milestone backs [Atto full-AOT matrix PR #55](https://github.com/atto-lang/atto-spec/pull/55) and [conformance tracker #51](https://github.com/atto-lang/atto-platform-conformance/issues/51). This is a **candidate source/expectation corpus**, not proof of native AOT parity.

It records **five positive and five negative** original `.atto` guest fixtures copied byte-for-byte from [Rust/Wasm PR #219](https://github.com/atto-lang/atto-source.rs/pull/219), source commit `e2d18c418c9d46dde3e7bf4b1936d39139ffefee`, root tree `24035e0b26d52b56c770792cc7d6771e98262ec3`. `contracts/aot-adt-guarded-guest-v1.json` records every original Git blob SHA and exact exit/stdout or compile-error expectation.

The positive fixtures cover guarded nested `Option<Result<int,string>>`, forbidden mismatched-tag payload reads, once-only subject evaluation, nested Err without flattening, and exhaustive enum matching. Negative fixtures include non-boolean guards, insufficient exhaustiveness, unsupported generic Result, wrong constructor payload, and duplicate unguarded match arms.

**No current backend is marked PASS.** Rust/Wasm PR #219 reports no executed exact-head CI run on its latest head. Java, LLVM and .NET native-AOT parity is also not established by these copies. `Result<Option<int>,Error>` must be considered a **separate, currently unproven** extension rather than falsely introduced as an already compilable fixture.

To count as native AOT acceptance:
- Java must execute a GraalVM Native Image executable, LLVM a compiled linked native binary, and .NET a published NativeAOT binary; Rust/Wasm must execute its precompiled guest without Atto source interpretation.
- Require exact source commit/tree and per-blob identity, compiler commit/tree, toolchain, target, build flags, complete positive guest execution results and negative no-artifact diagnostics.
- No required runtime Atto compiler, JIT, code generation, or dynamic generic instantiation. A CLI or reference model may prove parser semantics but not native guest behavior.
- When source GitHub Actions lacks minutes, verify the *entire compiler Git tree* and every blob through a private alternate carrier; this selected-fixture copy is not a substitute for compiler tree mirroring.

The `tests/test_aot_adt_guarded_guest.py` host check validates fixture integrity and prevents accidental status promotion; a later compiled guest runner must consume the same manifest. An executed schema test is not AOT compiler parity.

## Portability correction (normative language vs candidate limitation)

The negative fixture `adt-result-int-error-unsupported` is **specific to the November 2026 Rust/Wasm candidate**, not a permanent AttoLang requirement. A fully specialized AOT compiler should eventually admit `Result<int,int>` when its generic payload/ABI layout is implemented. Other backends record this candidate-only row as `NOT_APPLICABLE` (with no guest execution claim) and must not be forced to reject a valid type. This avoids falsely rewarding incomplete generic implementations. Cross-backend conformance therefore uses the nine `portable-language` cases; the one Rust-candidate case remains separately tracked. Unsupported `Result<Option<int>,Error>` still needs its own positive/negative implementation fixtures.
