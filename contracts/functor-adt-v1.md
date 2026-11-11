# Functor ADT v1 — 17-case conformance and scoped evidence

**Partial Java/GraalVM proof; not cross-backend parity.** Source [draft PR #2830](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2830); normative [specification draft #34](https://github.com/ores-truffle-oreslang/attolang-language-spec.md/pull/34).

All 17 checked-in `.atto` fixtures are byte-identical Git blobs from source commit `faa149c6bcc7510a659c86499f614efdaffcc4e8`, subtree `be201b1c667057582a6e7e53025bb1d1938179c6`. Two positives contain **36** tagged guest assertions; fifteen negatives require compiler/type/ownership rejection. Three-layer nested shapes, exact error-domain preservation, one-layer flattening and dormant callbacks are covered.

**Current Java JVM guest execution passed:** [GraalVM 25.3/JDK25 private run #42957069176](https://github.com/numerics-atto/mirror-oreslang-source.java/actions/runs/42957069176), 3 actual JUnit tests, 0 failures, Maven BUILD SUCCESS. Exact-blob scope: all `src/main`, `stdlib`, `pom.xml`, entire selected 17-fixture subtree, and selected real JUnit source. Unrelated source files were not fully mirrored.

**Historical Native Image AOT proof — previous source head ONLY:** [successful run #42954808209](https://github.com/numerics-atto/mirror-oreslang-source.java/actions/runs/42954808209) compiled no-fallback Native Image and executed 1 positive and 2 negatives using previous pinned source `02fe4a3...`. This is **not** current-head AOT evidence. New current-source 2-positive/15-negative Native Image gate has been triggered separately; never promote it until the gate succeeds.

**LLVM, Wasm, Forge, .NET Native AOT and Cranelift:** not executed. Per-backend parity requires compiler guest execution, negative diagnostics, ownership and AOT checks, and immutable fixture/source hashes. The Node integrity test is deliberately **source-free** and must not be accepted as guest proof.
