# AttoLang 19-case scalar parity, five-backend candidate ledger

This ledger is a **candidate plan and independently inspected source-byte inventory**, **not a compiler result**. The exact 19-case `.atto` manifest from [common-source PR #217](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/217) is pinned to Git blob `43c4d295a237e483f70722bd90ec10d273b73854`. On November 3, 2026 all 19 individual fixture Git blobs were read back and matched on the current PR branches in Java, LLVM, Wasm, .NET and Forge.

| Source/compiler | Proposed guest lane | PR | State |
|---|---|---|---|
| Java/GraalVM | 10 compiler admissions + 5 negative compiler admissions, typed guest pending | [#2501](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2501) | NOT_EXECUTED |
| LLVM | 7 native executable assertions + 3 removed-operator compiler denials, full i64 witness pending | [#1348](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1348) | NOT_EXECUTED |
| Wasm | 10 full typed i64 isolated wasm32 guest assertions + 3 compiler denials | [#278](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/278) | NOT_EXECUTED |
| .NET NativeAOT | 2 Linux native published executable assertions + 3 CIL-denial compiler cases | [#350](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/350) | NOT_EXECUTED |
| Forge | 10 stage-0 linked native guests + 9 negatives in all 3 source modes | [#178](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/178) | NOT_EXECUTED |

The separate **Cranelift JIT** source backend is not equivalent to Forge or Wasm and is outside this five-backend contract. Scalar parity must not be confused with complete language, ownership, actors, `critical`/`suspends`, JIT/AOT, or platform parity.

`node --test tests/atto-scalar19-candidates.test.mjs` and `node scripts/verify-atto-scalar19-candidates.mjs` inspect only a pinned, source-free *manifest*. They do not query GitHub, authenticate stored SHA values, execute compiler tests or prove that GitHub Actions actually admitted a runner. Source-only pass never promotes a backend to passing.

**Next promotion gate:** Each respective backend must run original-repository exact-head compilation/linked guest positives and negatives, supply runner allocation and nonempty ordered steps, real source/compiler/output digests, backend-specific i64 witness (not process status alone), stable error category, and an independent reviewer. Zero-step Actions means runner admission failure. Private-source cross-org mirror remains held without explicit independent authorization.
