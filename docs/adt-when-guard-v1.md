# Guarded ADT match/switch conformance (v1 candidate)

**Evidence state:** scoped Rust/Wasm compiled-guest PASS; Java, LLVM, and .NET NativeAOT are **NOT_EXECUTED**. This contract is stacked on [typed arm/task capture conformance #52](https://github.com/atto-lang/atto-platform-conformance/pull/52), [language spec #57](https://github.com/atto-lang/atto-spec/pull/57), and [Rust/Wasm compiler fix #247](https://github.com/atto-lang/atto-source.rs/pull/247).

## Contract

`Ok(value)`, `Err(error)`, and `Some(item)` introduce an immutable arm-local binder available in `when` and the chosen body. Guard evaluation must occur **after** the matching tag is confirmed and the binder is initialized; the guard must be `bool`. When a guard is false, evaluation proceeds to the next arm. Guarded arms do **not** count as unconditional exhaustive coverage. A later unguarded arm for a variant completes that variant's coverage. Unguarded `default` covers all remaining variants. Any case following already unconditional coverage must be rejected as unreachable.

`Ok()`, `Err()`, `Some()` and wildcard payload variants `Ok(_)`, etc., match the tag but do not bind its payload. Constructors still require payloads. In the currently executed Rust/Wasm subset, `Result<int,string>` has `error` as a string with no `.code` property. The comparison operator is `!=`, not `!==`.

## Pinned executable evidence

The five files under `fixtures/adt-when-guard-v1/` remain byte-identical to the Chromium test sources of the **fully integrated** exact compiler stack head `eb8be6be78dbb180ea84fd49602c9869c9a46802` (browser source blob `8d7d6ec382a9c4fc6b5d09fe2605702ada52ccb8`). They cover 4 positive compiled guests (returned `42`, `10`, `0`, and `42`) and 1 negative unguarded-coverage rejection (`E_MATCH` without guest). Source blob SHA pins in `contracts/adt-when-guard-v1.json` are verified by the independent host-only test `tests/adt-when-guard-v1.test.mjs`.

**Executed Rust/Wasm receipt:** [anticaptrad/atto-ci Actions #43975793243](https://github.com/anticaptrad/atto-ci/actions/runs/43975793243), job `133679293949`, carrier commit `2957aff81a1c91f9b859b32f7dd5ab9d06d4f8bc`. The carrier verified **59/59 selected source Git blobs** (not a whole-repository Git tree), passed **53/53 native Rust regression tests**, executed all **18/18 compiled guest positive/no-artifact negative fixtures**, and compiled the Rust browser compiler to Wasm and ran actual guest Wasm under Chromium JSPI. Browser JSPI checked `Ok(value) when value > 5` with copied task capture and one handoff, `Err(error) when` true/false fallback, repeated `Some(n) when` cases, and guarded-only nonexhaustiveness.

## Native parity gates

Java/GraalVM Native Image, LLVM native and .NET NativeAOT need separate exact-source stepful runs compiling and executing these same five source fixtures. Positive guest results, correct guard ordering, one-time scrutinee evaluation, no unselected-arm side effects, and the negative diagnostic with zero artifacts are required. Check effect/ownership semantics across suspension. Host-only source/receipt tests **never** certify execution or full-AOT. Until such runs exist, retain `NOT_EXECUTED` for those backends.
