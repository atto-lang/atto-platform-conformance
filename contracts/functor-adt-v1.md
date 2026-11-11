# Functor ADT v1 conformance and evidence

**Partial Java/GraalVM proof only.** Source implementation: [draft #2830](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2830); normative specification: [draft #34](https://github.com/ores-truffle-oreslang/attolang-language-spec.md/pull/34).

The 11 exact-blob `.atto` files are copied from source commit `02fe4a3da37e0c8a9273ebe4f3f8d58eb9ec67b3`. No generated parser substitute is acceptable. The positive fixture performs 16 observable guest assertions on nested Option/Result map, transpose and flatten. The ten negatives must fail in the compiler before guest launch. Each backend must run this same source corpus and report separately. A compiler-host-only test or source-free oracle does not count as guest execution.

**Java verified:** private [GraalVM 25.3/JDK25 run #42954467116](https://github.com/numerics-atto/mirror-oreslang-source.java/actions/runs/42954467116) completed both actual guest JUnit tests (2 passed/0 failed) using exact-blob compiler main subtree, stdlib, selected JUnit, Maven POM and corpus, with 16 positive assertions and 10 compile-reject cases. Unrelated source-repo test/docs files were not an exact mirror. AOT was not verified by this JVM receipt.

**All other backends pending:** LLVM, Wasm, Forge, .NET Native AOT, Cranelift. Native Java AOT is also separately pending. Require immutable compiler/source tree and fixture hashes, actual typed guest output, negative diagnostics, actor/ownership boundaries, and AOT receipts before raising any parity status.

**Source-free contract tests** verify corpus integrity and status accounting, not executable guest semantics.
