# Inverted class, inverted struct and explicit collection hardening audit — 2026-10-30

**Disposition:** NOT RELEASE READY. Host-oracle security fixes staged in [conformance PR #249](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/249); separate native checked-loan slice in [LLVM PR #1212](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1212). Neither establishes actual compiled Oreslang guest parity.

## Frozen audited main heads

| Backend | `main` commit at audit | Principal gap |
| --- | --- | --- |
| Java | `241bd67c39443cc2ef18df7e4ed456454af378c7` | Checked inverted-class/struct parsing, typed IR and executable `InvertedArray<T>` guest lowering not in main; draft host/runtime references exist |
| LLVM | `31b2fff390adac994d270d6fcbf2f65beb980d2c` | `DopInvertedColumns.hpp` provides scalar host storage only, not source compiler row lowering; `Loan::span()` escape hazard |
| Wasm | `be268bee832956fb8ca399f9c6fbc495e3066b73` | No independently established inverted source → LLVM IR → wasm32 guest execution or packed fixed-record ABI |
| .NET | `276c157fd3e760184b9782d90d1b014276d9c1ef` | `ActorShardColumns` is a homogeneous actor-owned `double` host shard, **not** general actor-independent typed inverted arrays or CIL Native AOT codegen |
| Forge | `a98a5e0abec222862278a52e7aaadbb2c674ec97` | No verified guest `inverted struct` / `InvertedArray<T>` typed parsing and emitted native code |
| Shared conformance | `bffe4a84f5d16a443cfaec80bac9e7661a273ef9` | Contract only until the new PR merges, exact-head CI runs, and real guest compiler results are authenticated |

The Java and LLVM `main` branch API returned `protected=false`. Both private-CI destination files lack any uncommented approved carrier. Do **not** mirror private sources to other organizations without explicit governance authorization, exact repository ID, allowlist enforcement and independent review.

## P0: Reference-model bugs remediated on #249

1. **Untrusted layout forgery:** `new InvertedReferenceStore({...layout})` previously accepted a superficially matching descriptor; a module-private layout witness now rejects non-issued descriptors.
2. **TOCTOU descriptor mutation:** scalar descriptors were not frozen; all descriptors and container topology are now immutable and compiled independently of caller-owned declaration maps.
3. **Effectful schema/payload getters:** accessors could execute during schema check or row admission; only own data descriptors are accepted, including nested packed values.
4. **Prototype/symbol field confusion:** schema member keys `__proto__`, `constructor`, `prototype` and symbol keys are rejected; row shape also checks `Reflect.ownKeys` (no hidden extra fields).
5. **Unsupported field semantics:** root and nested declarations now reject extraneous modifiers; nested inverted types are rejected with an explicit fixed-struct diagnostic; recursive records stay denied.
6. **Resource exhaustion:** logical packed-row width capped at 64 KiB and capacity × row width at 16 MiB in this **host-only reference**. This does not reserve native memory or prove a real ABI.
7. **Loan privilege coercion:** non-boolean write flags reject, preventing accidental truthy elevation in the reference API.
8. **No aliasing of packed cells:** read/snapshot/loan getter values are detached; failed row admission cannot publish partial store changes.

**Regression evidence:** 23 `tests/inverted-layout.test.mjs` cases including a 2,000-operation seeded differential oracle passed in an isolated strict-mode V8 evaluation of the PR's exact referenced source and test content. This is not a genuine `npm test`, hosted CI run, full source graph, native sanitizer, or compiled Oreslang guest result.

## P0: Native loan escape still open

LLVM `Loan::span()` exposes a raw C++ `span`, which can outlive the loan and can become dangling after structural reallocation/owner retirement; `shared_ptr<State>` keeps a loan's state alive only while the loan itself exists, not after its raw span escapes. The independently staged [LLVM #1212](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1212) adds lock-protected `size_checked/read_at/write_at` accessors with boundary, released-loan and owner-closed checks. **Raw `span()` remains for legacy trusted host consumers**; do not lower untrusted guest borrows to it. Guest admission must prove non-escape and avoid emitting invalidated raw addresses, or the remaining unsafe API must be removed after a complete callsite migration.

## CI / provenance gate

- Conformance current audit-head pull-request [run #41133798766](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/41133798766): job `124331121688` reports **zero executed steps** and `failure`.
- LLVM checked-loan head [run #41134019351](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/41134019351) (target ABI) and [run #41134019311](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/actions/runs/41134019311) (native LLVM): sampled jobs `124331856789` and `124331856055` report **zero executed steps** and `failure`.
- These failures do **not** demonstrate that source code compiled or tests failed. No approved alternative carrier was used. No compiler test was executed by the GitHub jobs.

## Exact promotion requirements

1. Agree and freeze source grammar, fixed-width scalar and nested fixed-struct eligibility, and prohibitions on non-explicit recursive inversion, implicit `Array<T>` substitution, inheritance, pointer-containing/value-resource fields and lossy ABI coercion.
2. Implement both `define inverted struct` and `define inverted class` through named type declarations, checked `InvertedArray<T>` owner, HIR/MIR row projections, field-sensitive loan effects, generational handles, and class methods lowered to (owner,row) operations. Non-inverted eligible struct/class types may be explicitly inverted **only** via the collection.
3. Prove one authoritative allocation; fixed-stride packed *ordinary* nested struct is one top-level column per immediate field. Avoid copied mutable row proxies, raw native pointers and transitive recursive flattening.
4. Run shared positive and compiler-negative `.ores` sources from #249 with source-correct diagnostics in Java, LLVM native, Wasm32, .NET Native AOT and Forge independently; JS backend is optional sixth parity target.
5. Exact-head stepful tests include failed insertion rollback, stale/foreign/reused identities, alignment/bool canonicalization/i64 exactness, IEEE signed zero/NaN, 32-bit multiplication and pointer overflow, loan conflicts, unsafe suspension/actor escape and teardown while live borrows exist.
6. Confirm branch protection and source-private approved destination policy before any cross-org testing; require independent review, pinned whole-tree/provenance and compiled Oreslang runtime artifacts (not just host/oracle green checks).

**Until these gates pass, every backend remains UNVERIFIED for executable inverted-struct/inverted-class/explicit-inverted-collection parity.**


### Experimental executable-guest source track (draft LLVM #1213)

The separate opt-in `oreslang-llvmc --experimental-inverted-i64` source adapter now emits actual physical stack-resident i64 SoA LLVM IR for an `inverted struct` and an explicitly allocated `InvertedArray<T>`. This is intentionally a **pre-HIR experimental subset** and not the production source parser, general `DopInvertedColumns` ownership-checked handle ABI, or proven guest execution. It supports signed i64 literals, capacity 1..256, positional push, checked get, and checked set only for explicitly `let` fields; implicit `val` fields are immutable after insertion. Unsupported dynamic indices, row deletion, nesting, actor/state/lifetime/borrow semantics and cross-backend execution stay rejected. The new three exactly SHA-matched `.ores` fixtures are pinned under `fixtures/inverted-layout/experimental-i64/` with `contracts/experiments/inverted-i64/manifest.json`, preserving every backend's `NOT_EXECUTED` state.

The shared JS oracle now models **implicit immutable val** and explicitly mutable direct field bindings; 23/23 isolated strict-mode V8 reference tests passed on the audited implementation and test blobs. Exact-head hosted Node, actual LLVM compiler/Clang native guest tests and five-backend parity remain unverified.
