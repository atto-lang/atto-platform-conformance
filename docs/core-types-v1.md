# Core types v1 — cross-backend source-only contract

Nine independent draft `atto-source.*` PRs stage `core/types.atto` with scalar value-width constants, signed-i64 extrema and checked range admission for signed-int inputs. All source file Git blob SHA-1s, exact PR heads and guest fixture SHAs are recorded in `contracts/core-types-v1.json`.

`node tests/core-types-v1-source-model.test.mjs` verifies the source ledger and BigInt boundary oracle, **not** the actual AttoLang compiler, linker, guest runtime or AOT. The portable positive and negative fixtures currently live in the backend PRs. The positive fixture must link `core/types.atto` and return 0; the negative fixture must reject a `void` local without an artifact.

A `passed` status can be recorded only after actual compiled guest execution or compiler negative diagnostic, pinned to the **current** head and target/toolchain, with nonzero runner steps. Zero-step GitHub Actions failures are `NOT_EXECUTED`. No cross-org private source export was performed.

This registry does **not** claim first-class `Unit`, opaque `TypeId`, metadata `TypeInfo<T>`, ABI layout or real sized integer type support. Those require compiler changes. The backend-owned `.atto` source remains independent; this is a shared behavioral registry, not a canonical implementation.

## Expanded test suite (2026-11-22)

Every compiler PR now contains `tests/core-types-source.test.mjs`, which parses a deliberately restricted form of the real `.atto` function bodies and checks i64/unsigned range predicates against a BigInt boundary oracle, including values beyond IEEE-754 safe integers. The oracle has mutation controls (shifted endpoint, changed visibility, duplicate export, hosted import) and is explicitly **SOURCE_ONLY**, not compiled guest execution.

The shared `contracts/core-types-v1.json` pins the positive fixture, **four compile-negative fixtures**, and source-model test Git blob SHAs at the current nine compiler PR heads. Java, LLVM and Rust include additional compiled guest test gates; the other backends currently stage source-only checks and fixtures, without pretending their subset compilers support the import/linker path. All nine compiled guest statuses remain **NOT_EXECUTED** until exact-head stepful test evidence exists.
