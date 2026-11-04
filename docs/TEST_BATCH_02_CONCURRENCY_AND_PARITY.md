# Oreslang Batch 02 — Original tasks 11–20

**Status: implementation-in-progress, all 10 release gates remain OPEN.**
This is a source-free contract/testing branch. It cannot authorize source export, independently authenticate GitHub Actions or establish real Oreslang guest execution.

## Implemented or hardened in this batch

- Restored the **exact user-requested task identities** in `audits/batch-02-test-work.json`. The older draft incorrectly substituted runner diagnosis, test CLI PRs and Java/JS parity for several requested tasks.
- Preserved existing `src/concurrency-observation-oracles.mjs`: vector-clock memory trace reference, conservative wait-cycle audit, Task physical-exit and owner checks, bounded/redacted causal diagnostics. Synthetic trace interpretation is **not runtime instrumentation**.
- Added `src/batch-02-replay-contract.mjs`: bounded trace and dependency-closure shape checking; rejects missing imported units, stale source/runtime closure identity, partial/incomplete decisions, unknown alternatives, time regressions and untrusted fields. It does **not** compute the import closure from a guest compiler or prove actual scheduler replay.
- Added `src/batch-02-evidence-admission.mjs`: separates software benchmarks from FPGA/ASIC PPA, measured from modeled results, and L0–L4 assurance layers. Independent post-merge reviews, protected branch claims and executed merge-head CI metadata are checked structurally, but results always return `benchmarkCertified:false`, `assuranceCertified:false` and `releaseCertified:false` without independent external authentication.
- Added 21 evidence-admission adversarial tests and 13 replay contract tests. Updated inventory tests with the original ten issue URLs.
- Added an actual **transitive imported-source digest regression** to Java [test mode PR #1427](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1427), commits `9fdb4fe63295756b4dae0f807edf75b64a664d8c` and `43756989f64ff69170b912918c85b9ea0e135767`. It changes a file two imports from the entry and independently tests import rebinding; Java JUnit exact-head execution still pending.

## Correct batch tasks and release gates

| Task | Source issue | Current progress | Mandatory missing runtime/release evidence |
| --- | --- | --- | --- |
| 11 | [Java #1417](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1417) | Host-side vector-clock reference; Java [#1415](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1415) deliberately refuses unsound `--race` success | Compiler-generated guest memory/actor/FFI reads+writes, genuine HB edges and Java/LLVM positive/negative races |
| 12 | [Java #1418](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1418) | New strict synthetic replay trace validator; existing Java [#1427](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1427) handles bounded CriticalGate input traces | Actual deterministic guest actor/Task scheduler choices, virtual time, complete replay, shrinking and source/runtime pins |
| 13 | [Java #1446](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1446) | Java SourceClosureFingerprint and new transitive-import regression in #1427 | JDK25/JUnit and executable replay refusal when only reachable imported source changes |
| 14 | [Conformance #108](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/108) | Source-free Task cancellation/quiescence oracle, unsupported guest cases must fail closed | Source-compiled Java and LLVM Task spawn/cancel/physical exit/owner adoption/get_done tests |
| 15 | [Conformance #92](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/92) | Versioned bounded redacted diagnostic shape oracle | Actual guest await/actor/select/RPC failure lineage, source maps, immutable budgets and differential Java/LLVM receipts |
| 16 | [Conformance #44](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/44) | Existing independent draft [#88](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/88) snapshots compiler executable around each fixture | Full harness integration and exact-head CI; hashing around spawn does **not** eliminate kernel exec TOCTOU |
| 17 | [Conformance #80](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/80) | New strict software/hardware, unit, provenance and heldout-sample admission oracle | Independently authenticated measured compiler/RTL output, environment/toolchains and raw evidence; never compare modeled PPA with measured runtime |
| 18 | [Common #58](https://github.com/ores-truffle-oreslang/oreslang-common-source/issues/58) | Existing nonpromoting five-backend ledger [conformance #58](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/58) | Current immutable heads, actually executed Java/LLVM/.NET/Wasm/Forge guest workflows, verified results and artifacts |
| 19 | [Conformance #85](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/85) | New L0–L4 assurance metadata oracle with no false promotion | Independent TypeSpec/JSON/WIT/IR hash proofs, solver/model-checker traces, implementation-level L4 receipts |
| 20 | [Conformance #19](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/19) | New identity- and merge-SHA-bound independent-release shape oracle | Authorized live review identities, real protected main/ruleset state, tested merge-tree and independently verified executed CI receipts |

## Verifying only what was actually tested

- The new evidence module was evaluated in an isolated V8 sandbox from the **committed GitHub source**: **21/21 synthetic tests passed**.
- The new source-free replay module was similarly checked: **13/13 synthetic tests passed**.
- The existing 42 race/Task/causal and 5 corrected inventory checks were also run in the isolated V8 evaluator. Total: **81/81 isolated synthetic checks passed** (42 + 5 + 21 + 13).
- These are neither Node 22 `node --test` tests nor a GitHub Actions job or compiler execution. All 81 tests still require native Node 22 exact-head execution before promotion.
- Run on an authorized source-local runner: `node --test tests/batch-02-test-work.test.mjs tests/concurrency-observation-oracles.test.mjs tests/batch-02-evidence-admission.test.mjs tests/batch-02-replay-contract.test.mjs`. Run `npm test` for full conformance coverage.
- Java exact-head JDK25 Maven/JUnit must run `SourceClosureFingerprintTest`, `OresTestTraceTest` and source-compiled guest replay rejection. Native LLVM load/store races are separately required.
- **No imported source tree or compiler binary was copied to another GitHub organization.** Conformance private-exposure incidents [#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) and [#77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77) and Java private CI protection [#962](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/962) still govern any future transfer.

## Promotion policy

Only independently reviewed, authorized and stepfully executed exact-head or exact merge-tree evidence can turn these cases into release-eligible results. A synthetic passing oracle, valid JSON payload, green setup-only Actions job, caller-supplied proof hash, runner availability, or private carrier visibility does **not** certify race freedom, deterministic replay, formal proof or release approval.
