# Advisory multi-repository merge-wave readiness gate

This is a **read-only provider evidence checker**, not a merging bot or branch-protection bypass. It checks five PRs spanning at least three repositories, with exact source-head pins, main base-SHA pins, genuine submitted reviews by an authorized different account, and completed pull-request Actions runs with executed named test steps.

Run with Node.js 22+ and a read-capable scoped GitHub token:

    GITHUB_TOKEN=<token> node bin/merge-wave-readiness.mjs evidence/merge-wave-20261107-public-prs.json
    node --test tests/merge-wave-readiness-v1.test.mjs

The tool has only GET GitHub API calls. It exits nonzero on unknown or drifted PR heads, base branches, changes-requested reviews, stale/self approvals, draft/dirty PRs, runner_id=0, steps=[] or null, absent required test-step names, failed/pending CI and unmerged dependencies. A successful setup step is never a substitute for an actual required test step.

**Output is advisory only.** Even a clean report always has mergeAuthorized=false. Inspect branch rulesets, CODEOWNERS, security holds, approvals and discussion threads before any merge. A static source-head/CI snapshot is not a live deployment proof or a guest parity proof.

## Five-PR merge procedure

1. Coordinate exclusive editing and review in [conformance issue #582](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/582). An existing GitHub review request does not count as approval.
2. Confirm all checks and independently submitted approvals after the final code changes. The connected the1mills account cannot self-approve its own PRs.
3. Merge website #91 then #92, rechecking target main and semantic changes after each merge.
4. Merge Sublime #142, preserving symlink destination restrictions; independently reconcile overlapping #143 before landing it.
5. Merge CLI #153 first. CLI #154 is stacked on #153, must be retargeted to main, semantically rechecked, and have fresh exact-head CI plus valid independent review before merging.
6. Use GitHub's expected-head-SHA precondition for every merge call, count only confirmed merges to main with returned SHAs, and stop if a head or base changes unexpectedly.

The manifest is deliberately pinned to the original 2026-11-07 wave. Base SHAs will become stale as main advances: refresh from authenticated GitHub after every merge, not by suppressing gate errors.

## Known external blockers

- Independent ORESoftware approvals are not yet present on the five original public PRs, despite successful executed CI.
- [Conformance issue #315](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/315) documents private-org Actions runner admission failing because of a payment/budget condition. This needs authorized billing administration, not runner-source mirroring or CI evidence fabrication.

## Expanded adversarial coverage (2026-11-07)

Run all three test files with Node 22+:

    node --test tests/merge-wave-readiness-v1.test.mjs tests/merge-wave-adversarial-v1.test.mjs tests/merge-wave-provider-v1.test.mjs

Latest **local** result: **158/158 passing test cases**, including 139 additional tests and a deterministic 256-iteration mutation matrix. The additional tests cover:

- Dismissed, stale, self, untrusted, pending, superseded and same-timestamp contradictory reviews, including malformed submission times
- Source, base, repository, run, job, attempt and PR-association identity mismatches
- Missing, duplicate, failed, skipped or zero-step jobs; missing named test steps despite successful setup
- Unsafe manifest paths, duplicate PR identities, bounds and strict read-only GET behavior
- API failure/permission denial, missing or malformed JSON envelopes, 10-page pagination cap and HTTP redirect refusal
- Dependency and target-main ordering, with confirmation that a passing report **never** authorizes a merge

GitHub API account privileges, approval applicability under CODEOWNERS, dynamic branch rulesets, active agent leases and source-level semantic compatibility **remain external checks**. The real REST provider requires a token with read access; the unit tests use deterministic mocks and cannot establish hosted runner admission. Update the frozen base SHA after every successful mainline merge; do not disable stale-base validation.

## Exact workflow identity hardening (2026-11-07)

The production manifest now **requires** `requiredWorkflows` for every PR. Each requirement pins a GitHub Actions `workflowId`, `workflowName`, `jobName` and `testStepName`. A passing workflow with a copied test-step label but a different workflow ID cannot satisfy the contract; neither can the right workflow with a renamed/missing job, a skipped or runnerless job, a stale run attempt, or a test step present only in an unrelated job. Each required test step must execute **inside** its pinned successful job and run.

The pinned public wave uses the provider-returned workflow identities: website `378985166`; Sublime `373587523`; CLI main CI `373591906`, signed-release assurance `409917534`, and root-signed trust policy `409926325`. This source-free gate remains advisory and does not imply release authorization, independent review, or deployment.

Expanded local suite after this fix: **174/174 Node 22 test cases pass**, including 16 additional workflow-spoof and manifest mutation cases over the previous 158. Hosted test evidence is still **NOT_EXECUTED** while org runner admission is blocked in issue #315. Do not count a workflow rerun request itself as execution.


## Wave-wide snapshot race hardening (2026-11-07)

Initial PR/review/run/job/parent evidence collection and the final advisory verdict are now separated by a **full second readback of all PRs**. Each second pass rereads live GitHub PR identity, independent reviews, exact-head workflow run status/attempts, executed job steps and stacked parent metadata. The `evidenceFingerprint` is order-independent for lists, includes security-relevant identity and execution fields and excludes incidental display text. Any change during this window yields `PROVIDER_SNAPSHOT_CHANGED`, marks that PR unready and prevents the overall five-PR/three-repo advisory qualification.

New tests simulate head pushes, review dismissal, workflow attempt replay, vanished test steps, base-SHA drift, parent merge-state drift and benign reordering of provider evidence. Invalid/missing run/review collections fail closed.

**Important boundary:** This is a *stability preflight*, not a transaction/lock/lease and not automatic merge authority. A final decision must still refresh GitHub branch protection, CODEOWNERS, security holds, active agent ownership and source-level semantics, then merge with GitHub's `expected_head_sha` precondition. Changes after the last readback remain possible. Never assert that this tool makes the GitHub APIs atomic.

Local Node 22 focused suite: **182/182 passing** (174 original + 8 new snapshot-race tests); hosted CI remains unavailable on the private source organization's runner-admission issue #315.


## Repository association and squash-parent source pinning (2026-11-07)

The second GitHub evidence readback must capture **all provider fields consulted by first-pass admission**. Earlier snapshots included run ID and linked PR numbers, but omitted the run's repository, source repository and linked PR base/source repository identities. This could permit an association change without invalidating the snapshot. The fingerprint now includes those repository fields and the PR's source repository, while retaining order-insensitive list comparisons.

Stacked child PRs also require a pinned `expectedParentHead` in the manifest. A parent counts as merged only when its provider PR number, exact original head, owning repository, target `main`, merged status and merge timestamp agree. This pin is **independent** of `expectedBaseSha`: a squash merge produces a different mainline commit SHA, so a retargeted child cannot equate the original parent head with the new `main` base. Existing CLI #154 pins the original CLI #153 source head `c3f242c508e5acd4593853bd0304c311137abf70`.

New negative tests reject foreign source-head repositories, parent substitution, missing/wrong parent pins and cross-repository run/PR association drift. The local Node 22 focused suite now passes **195/195 tests** (182 previously + 13 focused provenance and race cases), with zero skips and failures. **This is not authenticated hosted exact-head CI.** The check remains advisory and never authorizes merges without branch rules, independent review and real hosted evidence.

The additional six end-to-end tests prove the complete two-pass `collectWave` rejects a same-commit foreign PR-head relocation, source-run repository swap, and linked-PR base repository substitution. They also verify rejection of unrelated PR associations and a stale-but-well-formed parent SHA, while preserving harmless ordering changes. Local Node 22 execution: **195 tests passed, 0 failed, 0 skipped**. GitHub-hosted execution is unverified until actual named job steps are observed at the new head.
