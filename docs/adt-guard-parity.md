# ADT guarded-match parity: source corpus v1

This is a **source identity, semantics and admission gate**, not a claim of Java/LLVM/.NET parity.

The 24 immutable `.atto` inputs are byte-identical to Atto Rust/Wasm PR [#219](https://github.com/atto-lang/atto-source.rs/pull/219) at `e2d18c418c9d46dde3e7bf4b1936d39139ffefee`. The 12 positives exercise executed guards, exactly-once subjects, tag-before-extract, nested layers and fallthrough; the 12 negatives exercise type, family, exhaustiveness, scope and duplicate-arm soundness.

The [exact-tree private carrier run](https://github.com/cliptown/atto-ci/actions/runs/43926119524) is real **Rust/Wasm** execution evidence only. Java, LLVM and .NET must compile/exe their own real guest for every portable positive and reject each portable negative with the correct semantic category. A parser failure, unknown syntax, or generic unsupported feature is not semantic rejection evidence.

**Important portability correction:** Rust's two negative cases `adt-option-bool-unsupported` and `adt-result-int-error-unsupported` reflect a restricted Rust backend type profile. Both `Option<bool>` and `Result<int,int>` are valid canonical ADT instantiations, and a richer Java compiler must not be required to reject them. Backends must report `SUPPORTED` / `UNSUPPORTED` / `NOT_EXECUTED` explicitly.

Cross-backend parity requires:
1. Identical tagged semantics, first-match guard ordering and lexical binding.
2. Semantic negative diagnostics, correct type scope and no emitted guest artifact after compile rejection.
3. Real Java/GraalVM guest and AOT, LLVM native generated code, and .NET NativeAOT guest execution at exact source/commit digests (not stand-in host shims).
4. Checked ownership/drop of active payload, boundaries on nested layouts, and supervisor/actor message transfer after the pure-ADT slice.
5. Independent review before converting `parityCertified` to true.

Run immutable local corpus checks: `node --test tests/adt_guard_parity.test.mjs`.
