# Advisory multi-repository merge-wave readiness gate

This is a **read-only provider evidence checker**, not a merging bot or branch-protection bypass. It checks five PRs spanning at least three repositories, with exact source-head pins, main base-SHA pins, genuine submitted reviews by an authorized different account, and completed pull-request Actions runs with executed named test steps.

Run with Node.js 22+ and a read-capable scoped GitHub token:

    GITHUB_TOKEN=<token> node bin/merge-wave-readiness.mjs evidence/merge-wave-20261111-mainline-prs.json
    node --test tests/merge-wave-*.test.mjs

The tool has only GET GitHub API calls. It exits nonzero on unknown or drifted PR heads, base branches, changes-requested reviews, stale/self approvals, draft/dirty PRs, runner_id=0, steps=[] or null, absent required test-step names, failed/pending CI and unmerged dependencies. A successful setup step is never a substitute for an actual required test step.

**Output is advisory only.** Even a clean report always has mergeAuthorized=false. Inspect branch rulesets, CODEOWNERS, security holds, approvals and discussion threads before any merge. A static source-head/CI snapshot is not a live deployment proof or a guest parity proof.

## Current main-targeted wave (November 11, 2026)

The active manifest pins five distinct `main` candidates spanning three public repositories: Website #91/#92/#93, consolidated Sublime #162, and consolidated CLI #176. The immutable head, main-base and actual executed workflow/job/step names below were checked against authenticated GitHub. They are **NOT** evidence of independent approval, code-owner authority, or enforced protection: latest readback found all five without a genuinely independent `APPROVED` review, Sublime #162 in DRAFT, and all three `main` branches unprotected without rulesets.

A reviewer request to `@ORESoftware` is not proof of separate trust-domain control. CLI DRAFT #158 proposes CODEOWNERS with this unresolved identity and cannot be promoted as-is. Administrator remediation is tracked at [CLI #163](https://github.com/ores-truffle-oreslang/oreslang-cli/issues/163); wave provenance and agent claims at [conformance #582](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/582). Never self-approve, waive source-owned CI, merge to a temporary parent, export private LLVM source, or treat this read-only checker as merge authorization.

## Five-PR merge procedure

1. Coordinate exclusive editing and review in [conformance issue #582](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/582). An existing GitHub review request does not count as approval.
2. Confirm all checks and independently submitted approvals after the final code changes. The connected the1mills account cannot self-approve its own PRs.
3. Revalidate Website #91, then #92, then #93 against the new base after each mainline merge, including full review and exact-head CI applicability.
4. Revalidate consolidated Sublime #162; require independent review and executed exact-head CI before promoting this DRAFT. Do not double-count superseded publisher PRs.
5. Revalidate main-targeted CLI #176; root-signed trust-registry CLI #154 is separate and must not be silently counted in this five-PR wave.
6. Use GitHub's expected-head-SHA precondition for every merge call, count only confirmed merges to main with returned SHAs, and stop if a head or base changes unexpectedly.

The active advisory manifest is `evidence/merge-wave-20261111-mainline-prs.json` (Website #91/#92/#93, Sublime #162, CLI #176). The older `evidence/merge-wave-20261107-public-prs.json` is preserved as **historical evidence** of a different, partly stacked queue. Both are pinned, non-authorizing inputs. Main-base SHA pins must be refreshed from authenticated GitHub after each verified merge, not by suppressing gate errors.

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


## Read-only post-merge integration attestation (2026-11-08)

After **actual authorized mainline merges**, invoke the second CLI:

    GITHUB_TOKEN=<read-capable-token> node bin/merge-wave-postmerge.mjs path/to/pinned-postmerge.json

Do not invent merge SHAs, fabricate a sample "completed" five-PR manifest, or run this as a substitute for independent reviews and branch rules. A valid manifest has 1–20 entries. A five-merge report only qualifies if **at least five individually verified merges span at least three distinct repositories**. Each entry must contain:

- \`repo\` and \`number\` (the actual GitHub repository and original PR)
- \`expectedSourceHead\` (the exact reviewed PR source head)
- \`expectedMergeCommit\` (a **separately observed** exact 40-hex \`merge_commit_sha\` from the merged PR)
- \`expectedMergeTree\` (the root \`commit.tree.sha\` fetched for that exact merge commit)
- \`requiredPostMergeWorkflows\` (at least one pinned \`workflowId\`, \`workflowName\`, \`jobName\`, \`testStepName\` that must execute successfully in a **push** run on the currently observed \`main\` SHA)
- For stacked dependencies, \`dependsOn\` and \`expectedParentHead\` matching another entry in the same manifest. The parent's completed/verified merge timestamp must be strictly **earlier** than the child's; failures propagate transitively.

The verifier checks the immutable merged PR metadata and source head, \`closed + merged\` state, merge SHA, merge tree, target \`main\`, live \`main.protected=true\`, and that the merge commit is an ancestor of the current \`main\` HEAD. It calls the real GitHub \`compare/{mergeCommit}...{mainHead}\` REST endpoint and requires matching \`base_commit.sha\` plus \`merge_base_commit.sha\`, consistent ahead/identical counts and \`behind_by=0\`. **GitHub REST's compare response may not contain \`head_commit\`; its absence is not evidence of failure.** The readback also requires the current main commit tree, plus an unchanged main branch and PR snapshot after evidence retrieval.

The same exact-main \`push\` run must have the pinned workflow identity, current main head/repository/branch, correct run attempt, a real admitted runner, a completed successful named test step, and no failed/runnerless jobs. Absent or duplicated runs, zero-step jobs, stale attempts, foreign CI repositories and missing steps are blockers. The result records \`sourceHead\`, \`mergeCommit\`, \`mergeTree\`, \`mainHead\`, \`mainTree\`, \`mergedAt\` and blockers; \`mergeAuthorized=false\` **always**. It uses a read-only GitHub client with no mutation methods; exceptions are converted to sanitized fail-closed evidence blockers.

**Semantic boundary:** A squash/rebase merge can produce a different tree than the original PR head; this checker does not infer byte-identical integration or semantic correctness. Source review, exact-head PR CI, actual required approvals, CODEOWNERS/security gates and any conflict resolutions must be validated separately before merging.

**Original proposed merge-wave order:** website #91 then #92, Sublime #142, CLI #153 then retarget/retest/re-review stacked CLI #154 against \`main\`. Never double-count overlapping main-targeted alternatives such as CLI #176 (integrated stack) or Sublime #159 (combined package hardening) alongside their constituent PRs; coordinate in issue #582 before selecting the five. Until successful mainline merges exist, there is **no legitimate post-merge receipt** for these entries.

This change adds 52 focused \`node:test\` cases on top of the previous 287: ancestry, source SHA/merged tree, main branch races, exact-main push job execution, replay and zero-step negatives, and parent dependencies. The **339/339 test-body result** was obtained in an isolated JavaScript harness with compatibility shims, **not hosted or native Node 22 execution of the complete repository**. The first-party Node 22 workflow now requires at least 339 executed passing merge-wave cases before emitting a source-head/tree-bound, **non-authorizing** test receipt. Real private Actions admission remains blocked (#315); live main protection and policy access remain blocked (#170).
