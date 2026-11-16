# Typed match/switch arm results: portable conformance v1

**State: candidate contract, no executed backend parity.**

Specification: [atto-spec typed-arm contract](https://github.com/atto-lang/atto-spec/pull/53) (draft).
Compiler implementation (restricted Rust/Wasm definite-return profile): [atto-source.rs PR #233](https://github.com/atto-lang/atto-source.rs/pull/233) (draft).

The registry `contracts/typed-match-arm-v1.json` now pins **12 byte-identical `.atto` fixtures** copied from Rust/Wasm PR #233 using exact **Git blob SHA-1** identities: four match and eight switch/case sources. Positive cases cover typed `return switch<T>`, nested ADT payloads and statement-form `switch<T>` with definite returns. Negative cases cover header/case type conflicts, non-exhaustiveness, duplicate cases, typed-case fallthrough and malformed annotations.

`node --test tests/typed-match-arm-v1.test.mjs` validates source integrity and protects evidence states. That is only a **host-side registry check**.

Before any backend becomes PASS, require all of:
- Build exact pinned source commit/tree and verify every compiled source blob.
- Compile each positive fixture to a genuine guest on its own backend and execute with result **42** and required stdout.
- Require negative fixtures to fail with the expected positioned diagnostic and **produce no guest artifact**.
- Independently execute async `await task` fixtures, `Future<int>`-returning arms, nested match/switch and suspension/ownership/error semantics when implemented. The v1 12-case registry does **not** cover awaited switch tasks, Future-returning arms, full expression-position switch values or cross-backend runtime semantics.
- Attach reproducible toolchain, command, source SHA, job steps and logs; admission failures without job steps remain **NOT_EXECUTED**.

Java / LLVM / .NET / Rust-Wasm are currently **NOT_EXECUTED** for this specific typed-arm feature. Rust PR #233's source workflow failed before recording job steps; it is neither a compiler conformance pass nor proof of compiler failure. PR #233 now contains a restricted compiler candidate for typed switch/case via the existing checked match dispatcher, but its latest guest execution remains **NOT_EXECUTED**. General expression-position `switch<T>` / `match<T>` and async source-captured tasks remain unverified. Async branch PR #236 includes scoped switch-case await tests, also pending real Chromium execution.

Never automatically mark a backend green because these host source checks pass.
