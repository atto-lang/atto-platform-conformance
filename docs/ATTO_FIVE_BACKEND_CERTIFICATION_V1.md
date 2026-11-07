# AttoLang release-candidate certification v1

This is an **advisory-only**, source-free evidence aggregator, layered on the post-merge auditor in [#476](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/476) and five-merge evidence snapshot in [#498](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/498). It does not authenticate a GitHub user, sign evidence, change branch protection, execute AttoLang, approve PRs, export private source, or authorize releases.

## Reproducible source identities and scope

`evidence/atto-five-backend-release-candidate-v1.json` pins the exact Git **commit and root tree SHA** observed from the `main` branch of each of the five compiler backends: Java/GraalVM, LLVM, Wasm, Forge, .NET. The five main branches were reported unprotected when observed. Those GitHub responses were captured once; the JSON itself is not a trusted live GitHub attestation.

Four **proposed, unmerged** guest contracts are linked to their exact PR heads: [scalar exit-42 #394](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/394), [actor/channel #457](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/457), [Task/HasFuture #465](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/465) and [DOP scalar #466](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/466). The scalar single-guest fixtures are pinned by Git blob SHA and exact exit status and stdout bytes:

| Contract | Fixture Git blob SHA-1 | Guest process exit | Expected stdout hex |
| --- | --- | ---: | --- |
| Scalar exit 42 | `4e2e7e853e37eb10e4d6ec45b3d18127a555900a` | 42 | empty |
| DOP scalar checksum | `aedc778e3e8dd2940600f047540c159b0129830a` | 0 | empty |

The DOP fixture exits 0 only if its internal checksum/boundary checks succeed. This is **not** a physical SoA/AoSoA, SIMD or GPU proof. Actor/channel and Task fixtures are **multi-case suites including negatives**; their manifests are pinned, but a normalized case-by-case oracle is not yet integrated. The actor/channel draft currently includes Cranelift in its roster instead of Forge. Neither suite may claim `REPORTED_PASS` from one standalone guest receipt.

An additional **targeted compiler-negative** oracle is pinned to `portable-task-v1/reject-duck-hasfuture.atto` Git blob `0072db5d74cd72430b3116eef51cb7237faae901`. A valid rejection must exit nonzero without a crash, with exact diagnostic `ATTO_TASK_E_HASFUTURE_WITNESS` from the `typechecker` phase. A generic parse error or a positive guest exit cannot replace it. This is still only a proposed fixture; all five negative evidence cells are `NOT_EXECUTED`.

All 20 backend/contract guest cells, all five backend formal checks, all AOT checks and all memory/GC measurements are `NOT_EXECUTED`. No compiler binary identity is available. LLVM zero-GC, GraalVM Native Image full AOT and zero-GC target, and JVM reduced-GC are **design targets, not verified behaviors**.

## Usage

On a source checkout with Node.js 22:

```sh
node --test tests/landed-main-evidence.test.mjs \
  tests/landed-main-20261106-platform-wave.test.mjs \
  tests/atto-five-backend-certification-v1.test.mjs
node bin/atto-five-backend-certification-v1.mjs \
  evidence/atto-five-backend-release-candidate-v1.json
node bin/atto-five-backend-certification-v1.mjs \
  evidence/atto-five-backend-release-candidate-v1.json --markdown
```

The CLI caps each input to 256 KiB, rejects symlinks/hardlinks/noncanonical JSON/duplicate JSON keys, checks the exact Git blob SHA of the landed-wave ledger, and validates bounded source/target/contract receipt structures. Unbound or missing receipt fields, incorrect fixture or stdout bytes, failed/skipped/in-progress substantive CI steps, wrong diagnostic phases or successful exits on negative fixtures, and unsupported/missing case suites cannot be mistaken for verified guest execution.

**Exit statuses: 1 BLOCKED, 2 malformed/untrusted data, 3 structurally reported complete but REQUIRES LIVE RECHECK. The CLI never returns 0.** Even caller-supplied `REPORTED_PASS` with plausible run IDs is labeled `REPORTED_PASS_UNVERIFIED`; a caller-controlled receipt is not authenticated by its syntax.

## Additional schema and timestamp hardening (draft PR #552)

Candidate inputs now reject unknown *authority-like* keys at the top level
and within the postmerge ledger, negative oracle, contracts/proposals,
single-guest and suite-pending oracles, backend metadata, compiler identity,
and guest/formal/AOT/memory state records. The source-free data is still
untrusted: valid receipt syntax is **not** a signature, GitHub execution
attestation, or release authorization. Extra fields such as
`release_authorized`, `certified`, `waived`, `ruleset_enforced`,
`binary_trusted` and `executed` fail closed instead of being silently
ignored by one consumer and trusted by another.

Both the release candidate and case-oracle validator also require canonical
UTC dates. JavaScript `Date.parse` can normalize impossible dates; acceptance
now requires the parsed timestamp to round-trip byte-for-byte to the declared
second-resolution `YYYY-MM-DDTHH:mm:ssZ` form. A valid historical leap day
may pass structural validation but is still subject to freshness holds.

These changes add 22 candidate regression tests and five case-inventory
timestamp tests (27 new cases beyond the five fixture-path tests). They are
**authored tests**, not a claimed source-owned CI or full native Node test pass.
Before release use, execute the entire pinned-head test suite on an admitted
source-owned runner and obtain independent review.

## Authority required to move beyond snapshots

A **separate, authenticated source-owned live verifier** must independently recover and compare real GitHub main protections, exact branch/PR Git commits and trees, compiler binary hashes and build provenance, immutable .atto fixture hashes, execution profiles, job/run attempts and real steps/log artifacts, guest stdout/exit and targeted negative diagnostics, independent reviewer attestations, complete formal-model proof results, full native AOT output and measured memory behavior.

GitHub-hosted testing of this PR remains blocked if source organization Actions fail before allocation; local/V8 or host Node tests do **not** prove native guest compilation. Protected-main and runner admission are tracked in [#69](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/69), [#170](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/170) and [#315](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/315). The confidentiality incidents [#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) and [#77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77) still forbid unauthorized cross-organization private-source mirroring. No bypass is permitted.
