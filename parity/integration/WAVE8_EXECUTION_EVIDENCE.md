# Wave 8 — Tasks 36–40: executed-test and CI evidence hardening

**This PR is stacked on [integration draft #59](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/59).** Its base is `feat/parity-wave7-integration-readiness-20261016` at commit `9d1cfa6807ebf6f990505ad9927e2fb5bb8de2d0`, not `main`.

| New task | Concrete fix | Security result |
| --- | --- | --- |
| **36 — prove tests executed** | `src/test-evidence.mjs` reads real Node 22 TAP v13 totals, requires at least one executed test per suite file, exact `# pass == # tests`, and **zero failures, skips, cancellations, TODOs**. Checks actual subprocess exit, errors, signals and stderr. | A zero-exit process with no tests, falsified summary, timeout or skip can no longer pass host conformance |
| **37 — deny untracked executable injection** | Git status now uses `--porcelain=v1 --untracked-files=all` both **before and after** execution. Existing containment/symlink checks remain. | Cannot add `evil.test.mjs` without failing tree cleanliness |
| **38 — exact reviewed test inventory** | Discovered test file paths must be **exactly** the `*.test.mjs` paths registered among the PR's reviewed changed files. | Additional tracked (but unreviewed) test cannot be silently executed |
| **39 — ordered twelve-step CI receipt** | The CI evidence model requires all twelve authored steps, in the authored order, tied to the same successful attempt; duplicate, skipped, stale and failed steps reject. | Omission/reordering of Node setup, Clang, any wave checkout, integration runner self-test, or host test step cannot produce the simulated success shape |
| **40 — complete six-wave diagnostics** | A missing/bad checkout now records `BLOCKED_BEFORE_TEST` and advances to the next wave, preserving six explicit records and `hostSuiteRan:false`. Successful test records include verified TAP counts. | One bad checkout cannot suppress diagnostics for the other five or masquerade as a run-time test failure |

## Test evidence

- **7/7 real Node.js v22 tests passed** locally for the **exact Git-blob-matched new source module + new `test-evidence.test.mjs` test**. One test launches an actual child `node --test` process and inspects its TAP v13 output. Tests deliberately reject zero-test success, skipped/TODO, fail/cancel, duplicate/malformed summary, warnings, timeout/error/signal and false compiler parity.
- Additional regression cases in `integration.test.mjs` exercise **real temporary local Git repos** for untracked and unreviewed tests, ordered CI receipt denial, and six missing checkouts returning `BLOCKED_BEFORE_TEST`. These are **committed but have not been executed as a complete exact-head Node suite yet**.
- The complete updated runner, source inventory, CI evidence modules, and new TAP module parsed and passed isolated JavaScript checks: six waves, 92 distinct paths, 14 exact blob anchors; reordered CI steps were rejected, and zero tests were denied.
- The host test results are **not** actual Oreslang guest compiler/runtime parity. All five production compilers and target devices still need genuinely executed source-linked tests.

## Review and security restrictions

The inherited workflow continues to run `node --test parity/integration/tests/*.test.mjs`, so it includes the new regression file without expanding GitHub privileges. The six checkouts remain immutable versions of **this same private conformance repo**; this PR does not export private source into an external org or use an unapproved CI carrier.

The previous [PR #59 pinned suite](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/38991372285) and [default harness](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/38991372244) failed **with zero recorded steps**. Those are runner/allocation blockers, not source test failures. They cannot support any compiler parity or host-suite PASS claim. New exact-head runner evidence is required.

This patch remains **draft, unmerged**, pending reviewer signoff, actual Node 22 execution of the entire integration regression suite, all six source suites, and eventual Oreslang guest/compiler target evidence.
