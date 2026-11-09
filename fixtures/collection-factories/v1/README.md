# Collection factory Type.of v1 — candidate conformance corpus

**Status: TARGETS ONLY / 0 EXECUTED BACKENDS / NOT CERTIFIED.**

This manifest is an exact source snapshot of
[oreslang-common-source #257](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/257),
source blob **`8c9388325e6d5f762e03b5a14c9292d848f90dee`**.
It contains 37 source expectations covering Map, Entry, Pair, Tuple,
Array, List, Vector, Set, Record and legacy aggregate syntax.

For each backend, expand a candidate into a genuine AttoLang guest
translation unit and check parser/type/ownership/lowering plus actual
compiled guest evaluation where its expected phase is `guest`.
A `REJECT` at `runtime` requires a compiled guest and a checked
runtime failure; a source-only rejection cannot earn a runtime pass.
Where a feature is not implemented, record `NOT_SUPPORTED`
separately from `PASS`, `FAIL`, `NOT_EXECUTED`, or `SKIPPED`.
Do not convert an unsupported frontend into a success using an
independent regex/token heuristic or host-language stand-in.

Concrete backlog:
- Java/GraalVM draft factory slice: Java #2735 (stacked; no certified execution).
- LLVM: #1629
- Wasm: #451
- Forge: #238
- .NET Native AOT: #434
- Cranelift: #100
- JS: #237
- Rust: #51
- HDL: #32 (hardware-only profile, fail closed for unrepresentable
  allocator-dependent collections)

`collection-factory-manifest.test.mjs` verifies only this static
metadata and cannot run a compiler. Required promotion evidence:
source HEAD+tree+blobs, real runner/job steps, compiler artifact
identity, nonzero guest test counts, negative and duplicate-key tests,
ownership/actor safety and backend-specific Native AOT checks.

Existing `[1,2]`, `(1,true)`, `tuple {...}`, `Array[T]`,
`Vector[T]`, `Tuple[A,B]` and fixed/repeating shapes must not
be replaced or silently collapsed into a different type identity.
