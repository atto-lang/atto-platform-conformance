# Structured-source conformance v1

This is a byte-pinned, limited i64 class conformance contract. The three fixtures match the original files in oreslang-wasm, including their Git blob hashes.

## Executed backend evidence

- [LLVM→Wasm32](https://github.com/akrion-sim/akrion-sim-e2e/actions/runs/38113193431): the shared-read fixture and original mutable-borrow fixture returned 42, while overlapping exclusive/shared loans were rejected.
- [GraalVM 25](https://github.com/zed-pkg-test/java-app/actions/runs/38154510801): the exact shared-read fixture returned 42 and overlapping loans were rejected. Four focused JUnit tests passed; full Java Maven verification passed 1,413 tests.
- The exact original mutable class fixture is **NOT portable**: it declares `let Player player` but requests `rt borrow mut player`. GraalVM correctly rejects this immutable owner; LLVM/Wasm currently admits it. A separate Java source variant `let mut Player player` returned 42 but lacks an identical-source LLVM/Wasm proof.

The manifest lists backend confirmation **per case**. Promoting the unmarked mutable fixture to GraalVM-confirmed would be false. Fix the LLVM explicit-mutability admission, then verify a byte-identical explicitly mutable fixture on all backends before changing that case's status.

Static conformance tests check source bytes, manifest fields, and explicit backend statuses; execution evidence is supplied by the linked exact-source runs. This is not proof of native heap-backed objects, actor ownership, suspension, or a public structured-value Wasm ABI.
