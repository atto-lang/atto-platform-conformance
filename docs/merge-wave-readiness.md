# Advisory multi-repository merge-wave readiness gate

This is a **read-only provider evidence checker**, not a merging bot or branch-protection bypass. It checks five PRs spanning at least three repositories, with exact source-head pins, main base-SHA pins, genuine submitted reviews by an authorized different account, and completed pull-request Actions runs with executed named test steps.

Run with Node.js 22+ and a read-capable scoped GitHub token:

    GITHUB_TOKEN=<token> node bin/merge-wave-readiness.mjs evidence/merge-wave-20261107-public-prs.json
    node --test tests/merge-wave-*.test.mjs

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


## Protected-main governance admission (2026-11-07)

The default CLI now invokes `collectProtectedWave` instead of returning the original source-head/CI advisory alone. It additionally fetches, **via authenticated GET only**, the following provider data for each PR:

- GitHub classic branch protection: `/repos/{owner}/{repo}/branches/main/protection`
- All active effective branch rules: `/repos/{owner}/{repo}/rules/branches/main`
- Latest check runs on the expected head: `/repos/{owner}/{repo}/commits/{head}/check-runs?filter=latest`
- Fresh PR identity and independent submitted review timeline, including dismissals

The policy gate requires explicit protected-main approvals, administrator enforcement and exact-head successful checks with matching required check contexts and provider-app IDs when configured. It requires the maximum applicable independent-review quorum across classic protection and active rulesets, and denies stale, author, dismissed, contradictory or untrusted approvals. It also rejects unverified CODEOWNERS, required reviewing teams, last-push approval, thread resolution, merge queue or other unsupported restrictive rules. **This is deliberately conservative**: a valid GitHub configuration unsupported by the checker may be reported unverified, not as safe-to-merge.

A private-repository branch-protection GET can require administrative read permission. Any HTTP 403/404, malformed response, missing checks or inaccessible rule source is `GOVERNANCE_PROVIDER_UNAVAILABLE`, **not** an implicit waiver. Security checks are read-only, and a passing result still has `mergeAuthorized=false`.

Per-PR policy is read twice, followed by a **third, wave-wide policy readback** to detect rule changes while other repositories are checked. The original PR/CI evidence collector is then rerun to detect source, approval or check drift during policy collection. This is a bounded stability preflight; GitHub state can still change immediately afterward. Independent review, CODEOWNERS applicability, effective mergeability, any security incident holds and exact-head merge preconditions remain mandatory at merge time.

The source now includes **70 additional governance tests**: 54 approval/ruleset/status negative-and-positive cases and 16 multi-repository source/protection/check race and pagination cases. The five merge-wave test files were exercised together using an isolated JavaScript harness with a Node-compatible URL/fetch shim: **265/265 test bodies passed**, zero failures. **This is not GitHub-hosted CI nor a verified native Node 22 run of the new head.** Hosted exact-head execution remains blocked by runner-admission issue #315, and independent review is still required. Run the `node --test` command above under Node 22 after runner admission is restored to obtain authentic hosted evidence.

## Live GitHub policy access and machine-readable denial (2026-11-07)

Actual GitHub API probes on this installation exposed two **separate** governance blockers:
- `GET /repos/ores-truffle-oreslang/oreslang-platform-conformance/branches/main/protection` returned **403** `Resource not accessible by integration`. The same endpoint was denied on the public website and Sublime repositories. The installed connection's general repository access does not confer authority to read this protected endpoint.
- `GET /repos/.../rules/branches/main` was rejected as an unsupported GitHub connector fetch route (**400** at the connector boundary), even though it is a documented GitHub REST endpoint. A direct, appropriately permissioned GitHub REST client may support this path; this connector cannot prove the effective rules.
- By contrast, `GET /repos/.../commits/{head}/check-runs?filter=latest` returned real check-run objects for both the private conformance head (completed failures) and public website #91 head (completed success), with `head_sha`, check name, provider app ID `15368` (GitHub Actions), status, conclusion, and execution timestamps. A successful check run **does not** prove its named Actions job actually executed meaningful steps.

The advisory now preserves **which** source is inaccessible: `GOVERNANCE_PROTECTION_UNAVAILABLE`, `GOVERNANCE_RULES_UNAVAILABLE`, `GOVERNANCE_CHECKS_UNAVAILABLE`, `GOVERNANCE_REVIEWS_UNAVAILABLE` or `GOVERNANCE_PR_UNAVAILABLE`. The machine-readable `unavailableSources` array includes an HTTP status when the actual REST client exposes one, but **never** raw exception messages, token values or provider response bodies. Multiple simultaneous failures are retained. All cases also include `GOVERNANCE_PROVIDER_UNAVAILABLE` and remain fail-closed.

Actionable owner handoff: request an appropriately scoped, **read-only** policy-verification credential or explicit administrator-attested policy export; ensure the client supports effective branch rules. Do not relax CODEOWNERS, required reviews, budgets, protected branch settings, private-repository visibility or security holds merely to produce a green report. The Actions billing/admission issue **#315 is separate** and must also be resolved before hosted exact-head execution.

New seven-case denial regression matrix plus the prior 265 cases completed **272/272** in an isolated JavaScript harness with Node-compatible URL/fetch behavior. This is **not** an authenticated GitHub Actions or native Node 22 run; the new head must execute in an actual runner before merge eligibility can be established.


## Live main branch protected-state preflight (2026-11-07)

A regular, read-only GitHub `GET /repos/{owner}/{repo}/branches/main` does not require the privileged `/branches/main/protection` endpoint. On the pinned API probes, `main.protected=false` for all four repositories checked:

| Repository | Actual `main` SHA | Branch `protected` |
|---|---|---|
| `oreslang-platform-conformance` | `1235a720f63cce20038727880052fdf83139eb3f` | `false` |
| `ores-truffle-oreslang.github.io` | `779b3616c8551ea224baf00e224a348aef159245` | `false` |
| `sublime-text-plugins` | `2f6530a587f69ac5efb68ddfa1321e521bac2422` | `false` |
| `oreslang-cli` | `7eaa52e4f52d95df670d516d34d4907872be1730` | `false` |

The governance evaluator now independently requires `name=main`, `protected=true` and the live branch `commit.sha` to equal the pinned PR base SHA. Explicit `false` is `MAIN_NOT_PROTECTED`; an absent protected attribute is `MAIN_PROTECTION_UNVERIFIED`; a changed base is `MAIN_BASE_SHA_CHANGED`. The branch read is included in **all three** policy snapshots, so mid-wave edits cannot silently qualify. These are advisory blockers, not requests to relax settings.

**Partial evidence is retained** when privileged branch-protection or effective-rules requests fail with 403/unsupported endpoint. If the ordinary branch response proves `protected=false`, the report includes `MAIN_NOT_PROTECTED` *and* the restricted-source blocker. It does not leak provider exception messages or infer `false` when ordinary branch metadata is unavailable. Ten-plus new negative and integration cases cover these distinctions.

**Administrator action:** Independently configure protected `main` with required independent review, CODEOWNERS, stale-review dismissal, administrator enforcement, strict executed status checks and no bypass, as tracked by [#170](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/170). Obtain supported read-only policy verification and resolve GitHub Actions admission separately under [#315](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/315). Do not export private sources or make private repositories public to work around unsupported rulesets.

**Latest test evidence:** 287/287 test bodies passed in the **isolated V8 harness**, including the earlier 272 and 15 new branch-state, base-move and partial-provider-proof controls. This is **not** a native Node or hosted exact-head run. Verify with `npm test` under Node 22 on a trusted runner after admission is restored. Even a passing advisory never authorizes merging.
