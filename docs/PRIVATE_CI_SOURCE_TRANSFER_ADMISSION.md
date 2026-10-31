# Private Oreslang CI source-transfer admission (draft policy)

**Release/export state: DENIED.** This hardening is staged in draft PR #261. It is not authorization to resume moving private Git objects between organizations. Confidentiality incidents [#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22) and [#77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77) remain OPEN; main is not protected and no approved transfer ledger exists.

## Two distinct checks

1. `bin/require-private-mirror.mjs` verifies an authenticated GitHub source/destination name, `private:true`, `visibility:"private"`, destination write access and a caller allowlist. A pass means **destination visibility only**, never approval to export code.
2. `bin/require-private-transfer-approval.mjs` requires an independently reviewed source-organization policy before any source tree/blob can be read. The actual publisher `bin/private-mirror-publish.mjs` checks this after obtaining immutable commit metadata, and rechecks it before **each** destination Git-object mutation and branch creation.

The independent approval guard requires:

- Source-org `main` reported protected by GitHub; a readable branch-protection rule with at least two approvals, CODEOWNERS, dismissed stale reviews and `enforce_admins.enabled=true`. A 403, missing or malformed rule **denies**, not defaults to success.
- Source-org issues #22 and #77 both reported **closed** by GitHub (not merely a source-controlled status string).
- Live destination metadata independently verifies the exact name, **numeric repository ID**, private visibility, writable access and non-archived state.
- A single strictly canonical JSON record in `security/private-ci-source-export-approvals.v1.json` on protected source `main`, with schema `ores.private-ci.source-export-ledger/v1`. The file is **intentionally absent** until an independent security review authorizes its creation.
- Exact originating repository, commit SHA, tree SHA, destination repository ID, requesting actor, two distinct reviewers (neither requester), separate approvals for incidents #22/#77, a one-day maximum declared artifact retention and a validity interval of at most 24 hours.

A caller-supplied allowlist, fake private carrier, transferred SHA list, optimistic runner status, or an approval object supplied to the publisher is not sufficient. The exporter uses the source commit's GitHub tree pointer; it does not trust a caller to choose a different tree. The guarded CLI continues to require an authenticated source-local GitHub token; **the alternate-org GITHUB_TOKEN cannot checkout private source**, and using the GitHub connector to write blobs manually would bypass this library entirely.

## Security limitations / required independent governance

The new check is defense-in-depth, **not a complete cross-organization transfer authority**. The ledger's reviewer usernames are assertions in a GitHub-protected file, not independently fetched PR review identities; branch protection alone does not establish every possible ruleset bypass or historical authorization. The retention value binds the approved plan but does not control already-created Git objects, third-party artifacts, caches or deleted-history copies. Separate approval policy, actual review provenance, repository-level artifact retention, and incident-owner decisions are still necessary. Do not deploy or treat this as a permit until those checks are independently verified.

When an approval is eventually permitted, security review must bind its **exact** immutable source/destination pair and approve a separately audited, private runner. Otherwise use **source-local** Actions. Every positive unit test uses *mocked GitHub metadata*; a synthetic success is not a real export grant, backend conformance, or permission to mirror.

## Test evidence classes

- `tests/private-transfer-approval.test.mjs` tests the strict approval structure and refusal mutations.
- `tests/private-transfer-approval-github.test.mjs` uses mock GitHub API responses to exercise protection, issue, destination and canonical-ledger rejection; it never fetches actual source blobs.
- `tests/private-mirror-publish.test.mjs` exercises the publisher with mocked source and destination Git objects, including rejection before any real source tree read and before Git writes. Its positive synthetic fixture is **not** an authorized transfer.
- Source-org GitHub Actions runs are still zero-step/runner_id=0. Real funded alternate runner [public source-free run 41231141067](https://github.com/gha-indie-worker/gha-indie-worker-e2e/actions/runs/41231141067) passed 10 synthetic admission tests, but copied **zero** private source blobs; it did not execute these private JavaScript tests.

**Promotion gate:** independent security review of #22/#77, verified protected main and review provenance, approved private destination/trust boundary, exact source snapshot, and actual approved CI execution. Until all gates pass: **no private export and no merge/promotion**.
