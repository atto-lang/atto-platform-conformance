# Oreslang security execution batch 01 — tasks 1–10

**Observed:** 2026-10-18/19 UTC. **Status:** all ten work items remain OPEN / awaiting security or administrative acceptance.

This is a **source-free, read-only, non-certifying** assessment. It neither approves an alternate GitHub organization for private CI nor authorizes copying, rerunning, deleting, purging, rotating credentials, changing repository settings, or closing an incident. The accompanying script deliberately returns exit code `2` even after a successful metadata read. Its JSON report always includes `privateSourceExport: "DENIED"`.

## Executed read-only verification

- Verified by authenticated GitHub repository metadata: `zed-pkg-test/java-app` (ID `1323575966`) is currently **private**. This does **not** undo historical public exposure. `scintilla-run-test/gleam-runner-conformance` (ID `1323598260`) and `sagitta-stack/sagitta-infra` (ID `1357615104`) are also currently private. All three sampled carrier `main` branch responses had `protected: false`.
- The five Oreslang compiler source repositories' `main` branch endpoints reported `protected: false`: Java `2804333264e4bbfcc9015d02b63b3caf11a3ada1`, LLVM `d9c2f1c4c52fd70e96d3b41471786869199fcdf0`, .NET `81a88c40e7a235004295805b1decc21d83a94b6d`, Wasm `bf19d49610e45313b784f46f36041df6b940ed45`, Forge `67abe65827254639b83d6ccdff042456f0cc9271`. Zorde `main` likewise reported `protected: false` at `1d82938797200185ed24448c2aa9f2b99f91ffd8`.
- The Java main `.github/private-ci-approved-repositories.txt` returned **no active entries**. The main-branch snapshot file and both equivalent policy files in the other four compiler repos were **not present at the inspected paths (404)**. Missing is a denial/unverified signal, **not** an empty independently reviewed authorization. Staged policy on unmerged draft branches is not operative policy.
- Checked sample Actions job metadata for Java fast-ci run `39192171654`, LLVM compiler/native execution run `39192071724`, and conformance harness `39178122818`. The returned jobs had `steps: null`. This is **unobserved step execution**, not proof of zero actual steps, a compiler regression, or exhausted GitHub Actions minutes.
- Incident issues [#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) and [#77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77) remain open. Forensic draft [#68](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/68) includes a historical branch/run inventory; it is not an exhaustive purge receipt.

## First ten tasks: real remaining acceptance gates

| # | Existing authoritative tracker | Read-only progress in this batch | Remaining independent action |
|---|---|---|---|
| 1 | [Conformance incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) | Confirmed former public carrier is now private; incident still open. | Security owner: historical Git objects, Actions artifacts, forks/caches, credentials, Support case, closure sign-off. |
| 2 | [Conformance incident #77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77) | Confirmed Scintilla carrier identity/privacy, incident still open. | Incident owner: source/commit/tree mapping, contemporaneous approval check, audit logs, retention and remediation. |
| 3 | [Conformance bootstrap #69](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/69) | Verified all five source main flags are false. | Repository administrators: enforce review, CODEOWNERS, admin/no-bypass and strict app-bound checks, then independent live audit. |
| 4 | [Java protection verifier #1441](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1441) | Read-only visibility/branch evidence distinguished from privileged protection proof. | Configure a read-only Administration-scope audit identity; refuse API 403 and unsigned caller attestations. |
| 5 | [Java carrier authorization #1443](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1443) | Verified privacy of sample destinations only, **not authorization**. | Security/CODEOWNER-reviewed protected policy binding exact destination ID plus source commit/tree, after incidents are accepted. |
| 6 | [Java runner allocation #963](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/963) | Sample jobs recorded `steps: null`; cause unverified. | Org administrator: verify billing/minutes, org/repo Actions permissions, runner eligibility, policy and support escalation if needed. |
| 7 | [Java publisher admission #962](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/962) | Main has no active approved destination; other source-main inputs missing/unverified. | Security review: live protected-main provenance, independent exact source/destination pins and per-write revocation. |
| 8 | [Java complete-tree proof PR #1361](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1361) | Draft provenance work exists; no private transfer performed in this batch. | Independent security review + exact-head executed full-suite tests and verified tree identity. |
| 9 | [Zorde main/CI #23](https://github.com/ores-truffle-oreslang/oreslang-serialization-and-validation/issues/23) | Zorde main flag unprotected; observed Zorde runner job steps unobserved in issue evidence. | Protect main, source-local runner-backed native compiler tests, independently pinned build/toolchains. |
| 10 | [Java CODEOWNER protection #1368](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1368) | Java main flag `protected: false`. | Independently enable and verify required CODEOWNER reviews, stale approval dismissal, no bypass or force push. |

## Run the live metadata diagnostic

```sh
# Requires only GitHub metadata READ permissions; no source bytes are queried.
GH_TOKEN=<read-only-token> node bin/audit-security-batch-01.mjs > security-batch-01.json
status=$?
# 2 = DENIED / non-certifying, even if the report is generated.
test "$status" -eq 2
node --test tests/security-batch-01.test.mjs
```

The script never emits the token or raw exception/HTTP bodies. Authentication without branch-protection Administration:read is insufficient to prove review-policy enforcement. `steps: null` maps to `UNOBSERVED`. Run/job summaries cover explicitly enumerated sampled runs only; an incomplete page is not full coverage. Do not treat output success, fixture tests, or GitHub Actions acceptance as a compiler test receipt.

## Gate order

1. Preserve forensics and resolve incidents #22 and #77 with independent documented review; don't delete evidence prematurely.
2. Establish protected source and carrier main; obtain independent admin-readable verification and approved source-free policy-job CI.
3. Diagnose source-org runner eligibility without assuming billing failure.
4. Require reviewed protected-main destination-ID and immutable source commit/tree approval **only after** independent incident acceptance.
5. Independently execute source-local exact-head test suites; only then review the publisher for release.

**This document is not an incident-closure form and cannot grant permission to export source.**
