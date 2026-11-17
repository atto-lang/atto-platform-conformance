# Lazy ADT `when` dispatch and exact-source AOT proof (v2)

**Status:** scoped Rust/Wasm browser compiler and real guest PASS. Java/GraalVM Native Image, LLVM native, .NET NativeAOT: **NOT_EXECUTED**. This draft is stacked on [Atto conformance #53](https://github.com/atto-lang/atto-platform-conformance/pull/53) and compiler [#259](https://github.com/atto-lang/atto-source.rs/pull/259).

`match` / `switch` must evaluate the scrutinee exactly once. For each arm in source order, check its pattern; only if the pattern matches, bind its payload; then evaluate `when` exactly once. A failed guard continues to the next arm. A successful arm suppresses all later patterns, guards and bodies — even when a statement arm does not return. A bound `Some(n)` / `Ok(value)` / `Err(error)` value exists only in its arm. Wrong-tag payloads cannot be projected. Guarded variants cannot prove exhaustiveness without an unguarded fallback or provable exhaustive coverage. A fully exiting exhaustive match must retain definite-return checking while nonreturning statement matches continue.

## Exact copied browser source fixtures

The four `.atto` sources under `fixtures/adt-lazy-guard-v2/pass/` were copied byte-for-byte from exact compiler browser test harness source blob `99575ede7416c1d6a7b28d9af49e785614eeb73d`. They cover selected-arm suppression of an unselected side-effect guard; exactly one reached guard and output `GUARD_ONCE`; wrong-tag nonprojection and no `WRONG_TAG` output; and nonreturning statement-arm first-match semantics. All return 42, and their Git blob SHAs are pinned in `contracts/adt-lazy-guard-v2.json`.

The compiler fixes also hardened deep binary chains. In the real Chromium browser run, a 250-term checked expression executed and returned 250 while 3,000 terms failed with `E_NESTING` before guest execution. This is not a generic unlimited-depth guarantee.

## Guest and source evidence

**[GitHub Actions #43984239737](https://github.com/gha-indie-worker/atto-ci/actions/runs/43984239737)**, job `133708155341`: private, token-free carrier `gha-indie-worker/atto-ci` at commit `cb4200ce4f3450eb469907ef6cb178b0d498b026`; exact source compiler head `1cced72561fed3a92b4607aa22f197f3a97f8a7b`, exact whole source tree `3a28e4d0912a5a2bc797b37706608e1825ba56ee`. All 609 source blobs and the complete root Git tree SHA match the private source; all 300 Rust tests passed in 46 successful summaries, native compiler CLI built, Rust/Wasm compiler built, and real Chromium JSPI guests passed lazy-guard and stack-depth tests. No shared GitHub token or cross-org secrets were required.

`tests/adt-lazy-guard-v2.test.mjs` is a **HOST-ONLY** fixture/receipt validity check, not a compiled guest test. It explicitly rejects pretending Java/LLVM/.NET parity. Those backends require independent exact-source full-AOT compiled guests, evaluated return/side effect results, guard/exhaustiveness negative diagnostics with no artifacts, and real CI job steps before their status can change.
