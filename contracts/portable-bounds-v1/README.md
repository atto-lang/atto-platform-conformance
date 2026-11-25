# Portable bounds v1 — candidate conformance contract

This is a **source-level** candidate aligned to Java/GraalVM draft [#3133](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/3133), not a five-backend verified feature.

The pinned `bounds.atto` file is byte-identical to `stdlib/bounds.atto` on Java draft commit `092745f1491aaf0f0cf0d847b4641a1c9b9a081b`. Expected Git blob SHA-1: `a8ae98d0de39596ffad3a00be02d8f1e255de777`.

Semantics for signed i64 inputs:

- `valid_index(index,length)`: accept exactly if `0 <= index < length`.
- `valid_slice(offset,count,length)`: accept exactly if `offset >= 0`, `count >= 0`, `length >= 0`, and `offset + count <= length` **mathematically**. Implement using validated subtraction, never overflowing addition.
- `valid_strided_slice(offset,stride,count,length)`: require `stride > 0`, `count >= 0`, `length >= 0`, `0 <= offset <= length`. Empty slices are valid. For nonempty slices, require `offset + (count - 1)*stride < length` **mathematically**, checking by division in finite signed i64.

`vectors.tsv` contains 43 exact signed-input acceptance cases. The Rust oracle uses std only, reads the pinned TSV and checks small-range exhaustive equivalence against i128 math.

Run:

```sh
cargo fmt --manifest-path tools/portable-bounds-oracle/Cargo.toml --check
cargo clippy --manifest-path tools/portable-bounds-oracle/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path tools/portable-bounds-oracle/Cargo.toml --offline
```

**NOT EXECUTED.** No actual Java/LLVM/.NET/Wasm/Forge/Cranelift/etc `.atto` compiler, linked guest, NativeAOT, runtime memory or browser test is certified by this reference. Independently compile and execute the identical AttoLang function and acceptance corpus, and record exact source Git blob/tree, compiler artifact, platform, exit code and stepful runner job before promotion. Bounds predicates do **not** grant buffer ownership, allocation, or memory capability.
