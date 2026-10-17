# Wave 9 — tasks 41–45: real host evidence and source validation

**Status: stacked draft on [PR #61](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/61), itself stacked on [PR #59](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/59). This implements five concrete source-integrity and test-orchestration improvements, not any compiler-runtime feature parity.**

| Task | Change | Required proof |
| --- | --- | --- |
| **41 — TAP plan integrity** | `src/test-evidence.mjs` now requires one top-level `1..N` TAP plan, exactly N ordered numbered `ok` results, matching summary totals, and zero nested/top-level `not ok`, bailouts, failures, skipped, TODO or cancelled. No more synthetic summary-only green. | Node 22 execution of every actual wave host test file |
| **42 — Run real source validators** | `src/source-validation.mjs` pins all six existing wave manifest-source validator CLIs by exact Git blob. Executes them from the correct immutable checkout, with a shell-free bounded Node subprocess. Enforces their source-contract-only status and denies any compiler/guest/verification promotion. **The integration runner refuses to run tests until validation passes.** | Run against all six exact private Git commits with an actually allocated runner and review their source-fixture diagnostics |
| **43 — Full changed-file integrity** | Every source PR changed path, not just the 14 selective anchors, must have bytes matching its `git ls-tree HEAD` blob. `git status --ignored=matching` now detects ignored payloads, on top of untracked/tracked changes and symlink containment. Recheck before/after the source validators and host tests. | Review all checked-out executable Node sources and ensure CI runner isolation. This does not prove host checkout authenticity beyond Git object IDs |
| **44 — Durable failure diagnostics** | `run.mjs` CLI now requires `--output=/absolute/path/report.json` and atomically creates a mode-0600 per-wave JSON report on six-wave completion. The workflow uploads that report with `if: always()` even if tests exit nonzero. Blocked test runs preserve per-wave status, validation results and observed TAP counts without claiming test execution. | Actual uploaded Actions artifact, job steps and logs on the reviewed head; a pre-runner failure cannot produce a report |
| **45 — Deny synthetic merge readiness** | `mergeReadiness` now requires each `PASSED` record to include genuine `hostSuiteRan:true`, `guestCompilerRan:false`, positive zero-failure TAP counts, and an explicit source-validation result for that wave. Six bare `PASSED` strings are rejected. All evaluations still report `mergeApproved:false`, `releaseCertified:false` and `backendCompilerParity:UNVERIFIED`. | Independently authenticated real compiler/guest source builds in Java, LLVM, .NET, Forge and LLVM→Wasm; this PR cannot supply those |

## Current execution evidence

- The focused local suite **actually ran under Node v22.16.0 and passed 17/17 tests**: 10 complete TAP and process tests, plus 7 source-validator tests. Tests include a genuine child `node --test` invocation, a real child source-status JSON invocation, tampered validator source bytes, forged TAP counters and wrong source-status claims.
- Exact verified Git source blobs of those four files:
  - `src/test-evidence.mjs` `041a4609496976e1df828a37bb5195a31372e4ad`
  - `tests/test-evidence.test.mjs` `b35767b68f8446d27afb4d248350094453574c18`
  - `src/source-validation.mjs` `2cbc2c3501fd8c6c1c80198ce5fbe979fce1a034`
  - `tests/source-validation.test.mjs` `3c19f15d7ad9a3154131b7c00bba5ac91035202d`
- The updated integration runner, validator, TAP modules and expanded **24 integration-test definitions** parsed in isolated JavaScript; a synthetic six-`PASSED` input lacking validators was rejected for all six waves.
- New full-source Git tree tests, ignored-file source injection test and JSON-report emission tests are committed in `integration.test.mjs`; **full exact-head 41 host test definitions and the six real wave suites have not run on a GitHub runner yet.** Source syntax/adversarial model checks are not substitutes for executed Node tests.

## Run (after reviewed checkout)

```sh
node --test parity/integration/tests/*.test.mjs
node parity/integration/bin/validate.mjs

# From the integration source checkout with six reviewed same-private-repo source checkouts:
node parity/integration/src/run.mjs \
  --checkouts=/absolute/checkouts \
  --inventory=/absolute/integration/parity/integration/inventory.json \
  --output=/absolute/report.json
```

The output is **host conformance evidence only**. Even matching all six source fixtures and successful Node regression suites do not indicate production compiler guest execution, actor isolation or AOT parity.

### CI and private source

The inherited same-private-repository runner uses `contents: read`, immutable SHA refs, and `persist-credentials:false`. This batch does not mirror private sources into a different GitHub organization, grant new checkout/write privileges or insert secrets. If GitHub Actions again fails with **zero recorded steps**, treat that as a runner/billing/authorization issue and don't infer source test success or failure. Reviewers should inspect actual artifact IDs, source-tree identities, full job steps and logs once Actions does run.

This PR is **draft, unmerged** pending complete executed CI and source semantics review. Production backend and platform parity remains outstanding.
