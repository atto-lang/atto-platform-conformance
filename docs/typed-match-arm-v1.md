# Typed match/switch arm results: portable conformance v1

**State: 12/12 scoped Rust/Wasm fixture cases executable and PASS; Java, LLVM and .NET NOT_EXECUTED. This is NOT complete cross-backend parity.**

Specification: [atto-spec typed-arm contract](https://github.com/atto-lang/atto-spec/pull/53) (draft).
Compiler implementation (restricted Rust/Wasm definite-return profile): [atto-source.rs PR #233](https://github.com/atto-lang/atto-source.rs/pull/233) (draft).

The registry `contracts/typed-match-arm-v1.json` now pins **12 byte-identical `.atto` fixtures** copied from Rust/Wasm PR #233 using exact **Git blob SHA-1** identities: four match and eight switch/case sources. Positive cases cover typed `return switch<T>`, nested ADT payloads and statement-form `switch<T>` with definite returns. Negative cases cover header/case type conflicts, non-exhaustiveness, duplicate cases, typed-case fallthrough and malformed annotations.

`node --test tests/typed-match-arm-v1.test.mjs` validates fixture source integrity and requires explicit provenance for any recorded PASS. That Node test is still **host-only**; independent compiler execution receipts are required.

Before any backend becomes PASS, require all of:
- Build exact pinned source commit/tree and verify every compiled source blob.
- Compile each positive fixture to a genuine guest on its own backend and execute with result **42** and required stdout.
- Require negative fixtures to fail with the expected positioned diagnostic and **produce no guest artifact**.
- Independently execute async `await task` fixtures, `Future<int>`-returning arms, nested match/switch and suspension/ownership/error semantics when implemented. The v1 12-case registry does **not** cover awaited switch tasks, Future-returning arms, full expression-position switch values or cross-backend runtime semantics.
- Attach reproducible toolchain, command, source SHA, job steps and logs; admission failures without job steps remain **NOT_EXECUTED**.

**Verified Rust/Wasm scoped run:** [ClipTown Actions #43952883265](https://github.com/cliptown/cliptown-e2e/actions/runs/43952883265), job `133599741532`, mirror commit `210704c509ac1795b07bda56205cdb29e66cd40e`, source [atto-source.rs PR #236](https://github.com/atto-lang/atto-source.rs/pull/236) exact commit `3eb8e31c51b3188c0a1d8cee2e51e5c39c5248ad`. The private token-free mirror verified **50/50 Git source blobs** (scoped crate snapshot, not full repository). Real native Rust compiler tests **35/35 passed**; all 12 registered `.atto` programs were compiled: **5 positive guest Wasm programs executed and returned 42**, **7 negatives produced their expected diagnostics and no guest artifact**. The wasm32-compiled compiler and compiled guest ran in real Chromium JSPI, checking selected typed `match<int>` and `switch<int>` task arms each await once with exactly one cooperative handoff, and mismatched arms fail closed. Source-org Actions had zero-step admission failures; the stepful alternate run is the evidence instead.

**Independent full-tree Rust/Wasm mainline validation:** [anticaptrad Actions #43961398013](https://github.com/anticaptrad/atto-ci/actions/runs/43961398013), job `133629437258`, verified exact source commit `4b9b13337bfe626d4c15c4de393a6afa7c8f99c8` (atto-source.rs PR #233) and carrier commit `3acdc6314281e13e8387df97f3262a9f9d5fa047`. The full **729-source-blob Git tree** matches byte-for-byte at `96893a388eabdbdb37309fdf751444ebdf5a9d45`. Real Rust host `cargo test` passed, emitted native and Wasm compiler builds succeeded, guest conformance **495 passed / 0 failed**, with **447 native-vs-Wasm** comparisons, followed by successful real Chromium browser E2E and a pinned compiler artifact ID `14274501775`. The 12 registered typed match/switch fixtures are part of those positive guest-return and negative no-artifact checks. This validates the restricted mainline compiler independent of the earlier smaller async source snapshot.

**Independent native-cranelift formatting blocker:** a different job on the same carrier PR failed at `cargo fmt --all -- --check` and never reached its native tests. Two affected files (`native/tests/immutable_binding_parity.rs`, `native/tests/native_object_execution.rs`) have identical blob SHAs on source `main` and PR #233. This is a *baseline formatting gate*, not evidence of a typed-switch compiler failure. The overall carrier PR is not fully green and must not be merged merely because the browser compiler job passed.

**Still unverified:** Java, LLVM, and .NET compiler/runtime parity; general expression-position `switch<T>` / `match<T>` values; source-captured `task` closures such as `task { return match value over ... end; }`; generic `Future<T>` and fully typed Result/Option across suspension, ownership/cancellation/error propagation. PR #233's distinct mainline head is independently certified for the restricted 12-case scope by the full-tree anticaptrad run above; neither run establishes broader async or backend parity.

Never automatically mark a backend green because these host source checks pass.
