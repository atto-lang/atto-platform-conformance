# Oreslang test and conformance — batch 02 (tasks 11–20)

**Status:** source-free reference-oracle implementation plus ten-item work inventory, **NOT** ten completed runtime fixes.

## What is actually implemented here

- A bounded, executable vector-clock reference oracle (\`src/concurrency-observation-oracles.mjs\`) for supplied synthetic READ/WRITE, spawn/join, mutex, channel, completion, and cancellation events. It derives clocks instead of trusting timestamps or caller-supplied vectors.
- A conservative observed-wait graph oracle: AND/ALL dependencies may form an observed cycle, while OR/select, timeouts, cancellations and external producers cannot become false definite-deadlock claims.
- A scoped-Task lifecycle automaton that rejects \`get_done\` or scope completion before physical exit, plus duplicate exits, unowned children, cancellation-as-exit, and post-scope events.
- A structured bounded causal-diagnostic shape check. Whitelisted error codes, relative source paths, typed boundary names, opaque correlations, strict fields, and explicit truncation prevent accidental inclusion of raw payloads/host stacks.
- Regression fixtures for observed wait cycles, OR-select/timeouts, true and false race positives, data generation reuse, independent scheduling, sync edges, cancellation, physical quiescence, and diagnostic redaction.
- An independently tracked ten-item JSON backlog (\`audits/batch-02-test-work.json\`) that explicitly leaves every **guest-execution release gate pending**.

These reference oracles **cannot prove** actual source instrumentation, correct runtime scheduling, the absence of races in an Oreslang program, exhaustive deadlock freedom, or cross-backend parity. Host-only synthetic success must not be reported as Oreslang \`--race\` passing. The Java and LLVM compiler integration issues remain open.

## Observed GitHub state from current PR heads

| Batch item | Current draft | Inspected PR head | Latest relevant workflow and response |
| --- | --- | --- | --- |
| 12 | [Java #1429](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1429) | \`f987fb16dd5fa73b0e83b1c4544c194106b62491\` | run \`39195148885\`, native CLI job failure, \`steps:null\` |
| 15 | [Java #1415](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1415) | \`f42c8fb186eba096dbc3b6d380b2cd483a05e731\` | run \`39195682457\`, Graal conformance job failure, \`steps:null\` |
| 16 | [LLVM #655](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/655) | \`f6e90689ef505081e77612382dc1b01d55bd8d9b\` | run \`39195605195\`, native compiler job failure, \`steps:null\` |
| 17 | [Test CLI #8](https://github.com/ores-truffle-oreslang/oreslang-test.cli/pull/8) | \`587a1b5e6843f26d7b5a28dc612514864fb4c0c9\` | run \`39195761000\`, Python 3.11/3.13 jobs failure, \`steps:null\` |

\`steps:null\` means **execution metadata unavailable**, not a demonstrated compiler test failure, observed zero steps, or a confirmed Actions-minutes shortage. Existing conformance \`bin/diagnose-actions.mjs\` and Java #1429 already provide richer runtime receipt classification than this reference oracle; do not substitute or duplicate authoritative CI provenance logic.

## Release-gate matrix

| ID | Focus | Backend-executable gate still required |
| --- | --- | --- |
| 11 | Restore compiler CI | Complete Maven/JDK25 and LLVM CTest with exact-head, actual runner steps, artifacts and source identity, without unauthorized source transfer |
| 12 | Classify Actions failures | Java #1429 executed exact-head Python tests and independent approval, not merely a self-test transcript |
| 13 | \`--race\` | Actual compiler guest READ/WRITE events with allocations/generations and HB synchronization, including adversarial negative fixtures |
| 14 | \`--fuzz\` / replay | Virtual-time deterministic guest scheduling, bounded/replayable decision trace with immutable source/runtime identity and shrinker |
| 15 | Java test CLI | Guest Oreslang tests actually compile and run; unsupported modes fail closed and full integration CI executes |
| 16 | LLVM race detector | Compiler-generated LLVM load/store and actor instrumentation, not only standalone C++ host oracles |
| 17 | Deadlock analyzer | Distinguish lock-order potential from observed wait cycles; OR-select, timeouts and external producers must not become definite-deadlock claims |
| 18 | Async error stacks | Java/LLVM actual guest lineage, typed boundaries, restricted-mode redaction, budgeted formatting and differential JSON |
| 19 | Task quiescence | Source-level cancellation/join/scope behavior on Java and LLVM with exact-head receipts |
| 20 | Java ↔ JS parity | Independently observed guest outputs from identical pinned fixture bytes; fix integer overflow semantic disagreement |

## Security and test honesty

Original issue #92 has historic mirror-testing language. Its requirements do **not** override current [private-source incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22), [private-carrier incident #77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77), [bootstrap #69](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/69) or the empty protected-main source-transfer authorization lists. Funded alternative-org Actions capacity does **not** authorize copying private compiler source.

To exercise these source-free reference oracles and release-gate inventory with a real Node.js runner:

\`\`\`sh
node --test tests/concurrency-observation-oracles.test.mjs
node --test tests/batch-02-test-work.test.mjs
\`\`\`

Node 22 \`npm test\` on this repository includes both test modules automatically. Results must be captured with a genuinely executed exact-head GitHub Actions job before promoting this PR. Report \`PENDING\` for unavailable or uninstrumented guest capabilities; never convert synthetic oracle passes to backend execution certification.
