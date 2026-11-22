# Core types v1 — cross-backend source-only contract

Nine independent draft `atto-source.*` PRs stage `core/types.atto` with scalar value-width constants, signed-i64 extrema and checked range admission for signed-int inputs. All source file Git blob SHA-1s, exact PR heads and guest fixture SHAs are recorded in `contracts/core-types-v1.json`.

`node tests/core-types-v1-source-model.test.mjs` verifies the source ledger and BigInt boundary oracle, **not** the actual AttoLang compiler, linker, guest runtime or AOT. The portable positive and negative fixtures currently live in the backend PRs. The positive fixture must link `core/types.atto` and return 0; the negative fixture must reject a `void` local without an artifact.

A `passed` status can be recorded only after actual compiled guest execution or compiler negative diagnostic, pinned to the **current** head and target/toolchain, with nonzero runner steps. Zero-step GitHub Actions failures are `NOT_EXECUTED`. No cross-org private source export was performed.

This registry does **not** claim first-class `Unit`, opaque `TypeId`, metadata `TypeInfo<T>`, ABI layout or real sized integer type support. Those require compiler changes. The backend-owned `.atto` source remains independent; this is a shared behavioral registry, not a canonical implementation.
