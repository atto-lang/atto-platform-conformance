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
