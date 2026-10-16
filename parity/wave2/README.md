# Oreslang parity batch 2 — tasks 6–10

**Status: target-source contracts with unverified compiler evidence.** This is not a claim of source-language, runtime, JIT/AOT, actor safety, or cross-platform parity.

This is additive to the established `fixtures/manifest.json` harness and separate from [wave 1 PR #47](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/47). All five source backends are enumerated; Wasm inherits LLVM's source compiler, so a Wasm test must exercise actual LLVM→Wasm source compilation and guest execution, not a synthetic independent Wasm frontend. Source-org Actions may fail before test execution; do not report such jobs as failed/passed compiler tests.

## Tasks and concrete source acceptance

| Task | Source fixtures | Acceptance gate | Upstream work to reuse |
| --- | --- | --- | --- |
| 6 — primitive/aggregate value semantics | `value-i64-evaluation`, `value-int-division-reject` | Execute guest to produce exact signed integer 76; reject `int / int` assigned to `int` because source division produces a float, **not** because division syntax is unsupported. Further work: strings, tuples, records, exact float/decimal/complex, layout. | [Java #1033](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1033), [LLVM #427](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/427), [Common IR #28](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/28) |
| 7 — match/switch return destinations | `dispatch-value-match`, `dispatch-do-match`, `dispatch-nonexhaustive-reject` | Execute guest values **43** (value arm result then +1) and **42** (procedural function return); reject incomplete value arms with an **exhaustiveness** error. Next: equivalent `switch`/ `do switch` and ADT patterns. | [Common Source #20](https://github.com/ores-truffle-oreslang/oreslang-common-source/pull/20), [Java #901](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/901), [Java #907](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/907) |
| 8 — receiver/lambda capture | `capture-allowlist-execution`, `capture-implicit-self-reject`, `capture-escaping-self-reject` | Executed capture allow/deny demo produces `79`; unlisted `self` never resolves; explicitly listed borrowed receiver still cannot escape. Add heap-retention / shared method-image tests in each backend. | [Java #1087](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1087), [LLVM #479](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/479), [.NET #40](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/40), [Forge #36](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/36), [Wasm #38](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/38) |
| 9 — ownership and borrow | `ownership-state-read`, `ownership-loan-escape-reject` | Real parser/type/ownership checker accepts bounded scalar read and rejects state loan escape for the **loan** reason. Native LLVM must also prove lifetime, move, and cleanup at executable boundary; compile-only checks do not certify runtime. | [Java #760](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/760), [Java #443](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/443), [LLVM #264](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/264) |
| 10 — effects, critical and scoped grants | `effects-state-write`, `effects-read-mutate-reject`, `effects-loan-suspend-reject` | Accept `with state.read, state.write` with scoped `using state.write(critical ...)`; deny mutation through read grant and `rt cooperate` in a live state loan. Follow with real concurrent actor runtime turn tests. | [Java #760](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/760), [Java #765](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/765), [Java #789](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/789), [LLVM #264](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/264) |

**Source-version caution:** the match fixture originates from Common Source's target contract and is not automatically accepted by every current compiler. Actor-state fixtures follow Java #760's draft language. The `candidate` list in `manifest.json` identifies a test target only, not confirmed support, and `UNSUPPORTED` is not a passing reject.

## Usage

```sh
node --test parity/wave2/tests/wave2.test.mjs
node parity/wave2/bin/wave2.mjs --list
node parity/wave2/bin/wave2.mjs --backend=llvm
```

The unconfigured CLI returns nonzero (3). A backend adapter needs two entrypoints:

- `--check-argv='["/absolute/path/to/check-adapter","{file}"]'`: real compiler + semantic/type/borrow/effect checks, successful admission status 0, and negative cases status **exactly 1** with a primary `error: ...` diagnostic in stderr that names the correct semantic issue. An unsupported parser error is not ownership/effect parity.
- `--execute-argv='["/absolute/path/to/guest-adapter","{file}"]'`: genuine compiler + guest execution; the trusted adapter normalizes the observed guest return value or stdout as the **single JSON object** `{"result":"76"}`, with process status 0 and no stderr. For `main(): int`, do not conflate OS exit truncation with a typed 64-bit Oreslang result. Java must prove actual Graal execution; LLVM must compile/link/execute; .NET Native AOT, Forge native code and Wasm need their own truthful pipelines.
- `--source-sha=40_HEX_CHARS`: a caller-declared source pin only. This tool reads and hashes the executable, validates fixture Git blob identities, and normalizes observations; **it does not independently attest the compiler's source tree, toolchain dependency closure, runner, or provenance**.

Example:

```sh
node parity/wave2/bin/wave2.mjs \
  --backend=java --task=7 \
  --check-argv='["/absolute/path/to/java-check-adapter","{file}"]' \
  --execute-argv='["/absolute/path/to/java-guest-adapter","{file}"]' \
  --source-sha=0123456789abcdef0123456789abcdef01234567
```

This example specifies an API shape, not known installed binaries or a claimed successful run. The test runner has a fake process adapter strictly for unit tests. Even if every candidate case says `OBSERVED_PASS`, the report preserves `verified:false`, `parityVerified:false`, `provenanceVerified:false`. `--require-all` fails if any selected case was unsupported/unconfigured.

## Before merging or claiming parity

1. Independently run the exact committed Node suite on a real allocated runner. Confirm no skipped required test and review stderr and exit code.
2. Pin and execute real source-backend compiler builds with independent source/tree and artifact provenance. Expand backend adapters as needed without loosening diagnostic categories.
3. For each category, test positive *guest execution* where relevant and required semantic rejection (not generic unsupported syntax). Ensure negative tests still fail if the compiler rejects every file.
4. Add native lifetime/race tests for ownership/effects and Graal AOT/hybrid vs LLVM AOT checks. Verify that pending Java draft branches are reconciled before claiming mainline behavior.
5. Do not copy private source into unapproved cross-org carriers or treat a failed zero-step GitHub Actions run as a compiler test outcome.

There are no changes to source compiler implementations in this PR. It is a concrete executable conformance candidate suite and gap ledger, **not** completion of all five implementation tasks.


## 2026-10-16 implementation integration: shared arithmetic-76

The exact source bytes in `fixtures/value-i64-evaluation.ores` are Git blob
`a8165323a8aa40e7cec613fdb7e645c41a901965`.

| Backend | Candidate implementation gate | Evidence still required |
| --- | --- | --- |
| Java ([#1087](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1087)) | Same bytes in `scripts/ai-conformance-smoke.py` `ARITHMETIC`; compile + execute expected native process exit 76 | Real Java/Graal and Native Image Actions jobs |
| LLVM ([#479](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/479)) | Same bytes in the byte-identical smoke script; LLVM IR → Clang → executable exit 76 | Full LLVM CTest and real native-guest Actions run |
| .NET ([#37](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/37)) | Typed AST checks nested `100 - (3 + 2) - 19` association and operands | Native AOT compiled guest execution (AST admission is not execution) |
| Forge ([#30](https://github.com/ores-truffle-oreslang/oreslang-source.forge/pull/30)) | Same bytes in the C++ raw-string source; interpreted Oreslang result must be 76 | Exact-head Forge native build and tests, and independently compiled native guest |
| Wasm ([#35](https://github.com/ores-truffle-oreslang/oreslang-source.wasm/pull/35)) | `examples/arithmetic-76.ores` has the exact Git blob; pinned real LLVM→Wasm zero-import guest is required to produce 76 | Compiler-provenance-pinned real Wasm job and runtime execution |

The shared runner has also been hardened to check the first compiler error,
reject malformed/duplicated JSON result fields and compiler-crash diagnostics,
and recheck local executable and fixture hashes after the batch. Existing scalar
runners in .NET/Forge/Wasm and shared Java/LLVM smoke runners now reject invalid
UTF-8 compiler output instead of replacing undecodable bytes.

**This is test implementation, not confirmed feature parity.** Source-organization
Actions still report failures with no executed steps. The protected private CI
destination allowlist remains empty. Do not use another organization's Actions
or promote `OBSERVED_PASS` to certified without explicit authorization and
genuine exact-source execution evidence.
