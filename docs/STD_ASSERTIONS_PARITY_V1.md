# Atto standard assertions v1 — eleven-backend source candidate ledger

**Scope: not compiled guest parity.** This ledger links the exact initial source-branch commits for all eleven `atto-lang/atto-source.*` repositories. Each target has **source-only** readback evidence. All compiler/guest/AOT/test-runner outcomes remain `NOT_EXECUTED` until independently authenticated stepful receipts.

The canonical proposed interface is `import module assert from pkg "std.assert";` and `assert.true/false/equal/not_equal/fail`, with checked `AssertionError extends Error`; a separate nonthrowing test-result API returns `TestOutcome`. Equality is statically type-restricted and expected-first; do not optimize away calls. The 20-case inventory adds runtime failures, static rejections, evaluation order, actor isolation, release/AOT retention, safe diagnostics, and two target-specific capability cases.

The `.atto` and `.realtime` repositories do not contain working compilers. Hardware synthesis has no ordinary guest dynamic throw; hard-real-time profiles must reject unbounded allocation/unwind. Neither should silently drop failed assertions. Emulated/hosted checks are not hardware/hard-RT guest parity.

## Provenance and next gates

- Source shapes and existence checked via authenticated GitHub connector readbacks at the listed exact heads, not executable tests.
- The standalone Node test `node --test tests/std-assertions-v1-source-parity.test.mjs` checks this **manifest only** and must not be reported as a guest compiler run.
- Do not mark any status `PASSED` by editing this manifest. First build a trusted checker for signed, SHA-bound compiler/source/tree/toolchain, independent runner admission, nonzero executed steps, compiled output digest, observed guest result/error and profile evidence.
- Private cross-org CI mirrors require independently authorized exports, validated readers/retention, active source guard, all blob modes/SHA equivalence and matched root Git tree; none was used here.
- This draft does not supersede existing [atto-source.llvm#317](https://github.com/atto-lang/atto-source.llvm/pull/317), [atto-source.rs#401](https://github.com/atto-lang/atto-source.rs/pull/401), or Java native testing PRs [#1365](https://github.com/atto-lang/atto-source.java/pull/1365) and [#1394](https://github.com/atto-lang/atto-source.java/pull/1394).
