# Oreslang security execution batch 01 — tasks 1–10

**Observed:** 2026-10-18/19 UTC. **Status:** all ten work items remain OPEN / awaiting security or administrative acceptance.

This is a **source-free, read-only, non-certifying** assessment. It neither approves an alternate GitHub organization for private CI nor authorizes copying, rerunning, deleting, purging, rotating credentials, changing repository settings, or closing an incident. The accompanying script deliberately returns exit code `2` even after a successful metadata read. Its JSON report always includes `privateSourceExport: "DENIED"`.

## Executed read-only verification

- Verified by authenticated GitHub repository metadata: `zed-pkg-test/java-app` (ID `1323575966`) is currently **private**. This does **not** undo historical public exposure. `scintilla-run-test/gleam-runner-conformance` (ID `1323598260`) and `sagitta-stack/sagitta-infra` (ID `1357615104`) are also currently private. All three sampled carrier `main` branch responses had `protected: false`.
- The five Oreslang compiler source repositories' `main` branch endpoints reported `protected: false`: Java `2804333264e4bbfcc9015d02b63b3caf11a3ada1`, LLVM `d9c2f1c4c52fd70e96d3b41471786869199fcdf0`, .NET `81a88c40e7a235004295805b1decc21d83a94b6d`, Wasm `bf19d49610e45313b784f46f36041df6b940ed45`, Forge `67abe65827254639b83d6ccdff042456f0cc9271`. Zorde `main` likewise reported `protected: false` at `1d82938797200185ed24448c2aa9f2b99f91ffd8`.
- The Java main `.github/private-ci-approved-repositories.txt` returned **no active entries**. The main-branch snapshot file and both equivalent policy files in the other four compiler repos were **not present at the inspected paths (404)**. Missing is a denial/unverified signal, **not** an empty independently reviewed authorization. Staged policy on unmerged draft branches is not operative policy.
- Checked sample Actions job metadata for Java fast-ci run `39192171654`, LLVM compiler/native execution run `39192071724`, and Zorde validation run `39171413088`. The returned jobs had `steps: null`. This is **unobserved step execution**, not proof of zero actual steps, a compiler regression, or exhausted GitHub Actions minutes.
- Incident issues [#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) and [#77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77) remain open. Forensic draft [#68](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/68) includes a historical branch/run inventory; it is not an exhaustive purge receipt.

## Requested first ten tasks — October 19 execution audit

The order below tracks the **specific first ten issues requested**, rather than a different historical bootstrap checklist. All ten are **not completed**; the work on this branch is non-certifying diagnostic hardening. This table differentiates partial containment from incident closure and CI diagnosis from execution evidence.

| # | Current GitHub task | Verified progress | Remaining execution gate |
|---|---|---|---|
| 1 | [Java private-source disclosure #832](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/832) | Former public carrier is private now, but historical source-bearing objects remain an open incident. | Authorized incident owner: GitHub Support purge/retention assessment, clones/caches/artifacts, credential review and independent closure. Preserve evidence. |
| 2 | [Conformance public-carrier incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) | Carrier identity/visibility can be checked without reading compiler blobs; historical exposure is not undone. | Complete forensic branch/tag/artifact inventory and obtain independent security acceptance. |
| 3 | [Conformance Scintilla carrier incident #77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77) | Private carrier and immutable ID are known; PR #115 stages source-free tree-metadata triage. | Match prior carrier objects to independently authorized source snapshots, review logs/retention and obtain incident-owner decision. |
| 4 | [Java CODEOWNER protection #994](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/994) | CODEOWNERS file rules exist, but unprotected main does not enforce them. | Repo administrator must activate verified independent CODEOWNER review, no-bypass and no-force-push/deletion rules. |
| 5 | [Java independent protection audit #1441](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1441) | Branch flag does not prove ruleset enforcement; Administration:read is not available to this GitHub App. | Separate limited, authorized read-only administrative verifier; fail closed on 403, unavailable or revoked verification. |
| 6 | [Protected-main bootstrap and source-org runners #69](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/69) | Source-main branches sampled as unprotected; no protected CI policy receipt. | Enforce branch rules and restore source-local Actions with actually executed status checks. |
| 7 | [Java runner assignment failures #963](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/963) | Read-only sampled failed jobs have steps metadata omitted/null; cause remains unknown. | Authorized Actions administrator must check billing, spending limit, org policy, labels/runner allocation and support before alleging exhausted minutes. |
| 8 | [Java private mirror provenance #962](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/962) | Existing draft PRs #1361/#1431/#1217 stage fail-closed publisher controls; no source export was authorized here. | Independently review protected policy from trusted SHA, numeric destination identity and exact immutable source tree; prove revocation before every write. |
| 9 | [Java reviewed private carrier #1443](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/1443) | The trusted main allowlist has no approved destinations. A private, funded carrier is **not** permission to transfer. | Obtain independent source/destination security approval after incident resolution and protected rules; only then consider a single exact tree transfer. |
| 10 | [Java/GraalVM and LLVM CI execution #589](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/589) | Sampled failure metadata lacks executed step evidence; exact-head compiler validation remains missing. | Restore authorized source-local runner capacity, rerun the actual pinned Maven/GraalVM + LLVM CTest jobs, confirm nonzero executed steps and artifact SHA. |

### Additional exact-head evidence binding

The script now binds **every** sampled Actions run to its immutable commit SHA, numeric source-repository ID, run ID and positive run attempt **before** examining its jobs. It rejects cross-run job IDs and partial pages, and reports `UNOBSERVED` rather than laundering mismatched/stale records into relevant CI evidence.

| Sample | Pinned head SHA | Observed outcome |
|---|---|---|
| Java run 39192171654 | `0f9012b4bfd6efbf9e35da3873a23f6a104f8467` | completed/failure; job steps null |
| LLVM run 39192071724 | `d2d335689336f53f9ed8858dc8103a2753959838` | completed/failure; job steps null |
| Zorde run 39171413088 | `979e60642df99908f9aa44502fb17ae66c4072b1` | completed/failure; job steps null |

These hashes and job summaries were checked through GitHub metadata; they do **not** prove the Actions runner's cause or the result of any Maven, GraalVM, LLVM, or compiler tests.

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
