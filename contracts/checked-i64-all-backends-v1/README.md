# Checked signed-i64 parity — every `atto-source.*` repository

**Status:** candidate source-only conformance registry. **This does not certify compiled guest parity.** See [atto-spec draft #144](https://github.com/atto-lang/atto-spec/pull/144) for the proposed portable semantics; the spec is authoritative after review, not individual compiler behavior.

The corpus `cases.tsv` is byte-identical to the 15-case shared source in [Java #66](https://github.com/atto-lang/atto-source.java/pull/66) and [JavaScript #69](https://github.com/atto-lang/atto-source.js/pull/69).

- Git blob SHA-1: `71309fac2ab6b2191a0056c84d78987bd342dce0`
- Raw SHA-256: `e56dfccea11757ff18fc72a81ba5d643380e69184ab309eedf45e1e7b940e133`
- Seven in-range outputs, seven runtime-overflow cases (including intermediate overflow), one zero-divisor outcome
- Source expressions are portable test intentions. Every real backend must compile guest functions with parameters (so runtime-overflow checks cannot be replaced by constant-fold rejection), then report the observed value or terminal fault. The `ORES_I64_*` strings in this historical corpus are **provisional test classifications**, not an approved portable guest Error/CONTROL wire ABI.

## Eleven exact-main repository snapshot lanes

The `manifest.json` has every repository's GitHub `main` SHA at discovery, November 20, 2026. Each lane is deliberately `NOT_EXECUTED` **for this new 11-lane contract**, even if its repository has a separately scoped historical test receipt. The role column prevents a harness from impersonating an independent compiler.

| Repository | Role | Next implementation and verification milestone |
| --- | --- | --- |
| [atto-source.java](https://github.com/atto-lang/atto-source.java) | independent JVM/Graal compiler | Finish [#66](https://github.com/atto-lang/atto-source.java/pull/66); real Graal JVM and Native Image guests, linked-unit fail-closed profile |
| [atto-source.llvm](https://github.com/atto-lang/atto-source.llvm) | independent LLVM AOT compiler | Compile corpus with real source compiler and Clang O0/O2; preserve actor/arena and signed-fault boundaries; [frame domain #264](https://github.com/atto-lang/atto-source.llvm/pull/264) is a **separate security dependency** |
| [atto-source.net](https://github.com/atto-lang/atto-source.net) | .NET CIL / NativeAOT compiler | Real .NET NativeAOT guest and overflow diagnostics on Windows/Linux, not IL-only inspection |
| [atto-source.forge](https://github.com/atto-lang/atto-source.forge) | independent native Forge compiler | Connect existing C++ checked-i64 primitive to real source lowering and AOT/JIT guest results |
| [atto-source.rs](https://github.com/atto-lang/atto-source.rs) | Rust-hosted compiler | Reconcile [#439](https://github.com/atto-lang/atto-source.rs/pull/439); test runtime versus constexpr overflow through native/Wasm guests |
| [atto-source.js](https://github.com/atto-lang/atto-source.js) | independent JS compiler subset | Execute SHA-pinned [#69](https://github.com/atto-lang/atto-source.js/pull/69) compiled ESM guests; distinguish provisional legacy wrapping |
| [atto-source.cranelift](https://github.com/atto-lang/atto-source.cranelift) | independent Cranelift compiler | Real JIT/AOT guest and overflow/error classification |
| [atto-source.wasm](https://github.com/atto-lang/atto-source.wasm) | delegated compiler harness | Verify exact Rust-produced guest Wasm, Worker/isolate boundary; **not** a second independent source compiler |
| [atto-source.atto](https://github.com/atto-lang/atto-source.atto) | self-hosting bootstrap | No self-hosted compiler yet; establish Stage-0 trusted compiler and deterministic rebuild before claiming independent guest parity |
| [atto-source.hdl](https://github.com/atto-lang/atto-source.hdl) | experimental HDL target | Define synthesizable checked-int subset; unsupported runtime fault behavior must be rejected at compile time, not silently wrapped |
| [atto-source.realtime](https://github.com/atto-lang/atto-source.realtime) | planned real-time backend | Compiler bootstrap and bounded deterministic fault/quota model; no hard-real-time certification without executed target timing evidence |

These are **target responsibilities**, not claims that the indicated implementations or guest tests are already complete.

## Source-only gate

```bash
node scripts/verify-checked-i64-all-backends-v1.mjs
node --test tests/checked-i64-all-backends-v1.test.mjs
```

The verifier independently evaluates all 15 nested scalar expressions using checked `BigInt` and ensures the reference results and fault categories are arithmetically consistent. It verifies the exact content-addressed corpus (SHA-1 Git blob and raw SHA-256), all eleven pinned repo identities and immutable main snapshots, no duplicate/unknown identities, no symlinked inputs or duplicate JSON keys, and **no forged `PASSED` status**.

**A successful source-only test is not a guest execution receipt.** Future runtime results must be kept as separately authenticated, exact-head, target-scoped evidence; this static source manifest intentionally cannot be edited to say `PASSED`. Promotion must bind compiled artifacts to source hashes, toolchain, executable guest observations, negative compiler outcomes, nonzero runner steps and independent review. No cross-organization transfer of private source is authorized by these files.

## Phased parity beyond signed integers

1. **P0 signed scalar semantics:** shared `int` operators, constexpr-vs-runtime overflow, division zero, `Option/Result` error boundaries, actor-local fault containment.
2. **P1 actor semantics:** sealed state access, `ActorRef.send -> Result`, mailbox FIFO/admission and priority supervisor CONTROL, parent/child lifecycle, per-TenantVM memory and capability isolation. Existing [conformance actor state #113](https://github.com/atto-lang/atto-platform-conformance/pull/113), [Task/cancel #115](https://github.com/atto-lang/atto-platform-conformance/pull/115) and [LLVM issue #80](https://github.com/atto-lang/atto-source.llvm/issues/80) are the integration queue; do not duplicate them.
3. **P2 suspension and resources:** compiler-owned pinned continuation frames for `await`/`select`/`readch`, one-shot validated WAKE, stale-generation denial, cancellation and physical retirement; exact Java/LLVM executable guest comparison first, then others.
4. **P3 platform gates:** NativeAOT, JIT, Wasm Workers, Forge, Cranelift, self-bootstrap, HDL and real-time capabilities with explicit `UNSUPPORTED` evidence for impossible targets.

No source-repo `main` is to be merged, rewritten, or considered feature-complete from this corpus. Exact-SHA evidence and an approved independent CI/security review are required.
