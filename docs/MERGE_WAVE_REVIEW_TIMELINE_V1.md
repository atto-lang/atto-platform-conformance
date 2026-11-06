# Merge-wave reviewer timeline gate (source-free, advisory)

This isolated module supports the five-PR / three-repository AttoLang merge train without merging anything. It is intentionally separate from the open qualifier [#470](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/470), its stacked runner/receipt evidence hardening [#474](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/474), and blocker ledger [#467](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/467). No shared file was edited.

## Scope

`tools/merge-wave-review-timeline.mjs` exports `qualifyReviewTimeline(candidate, {now})` and `snapshotFreshness(asOf, now)`. The candidate expects:

- `repo`, `base_sha`: exact allowed AttoLang repository and its current base commit, binding reviewer policy to the intended mainline.
- `head_sha`: exact PR head (40 lowercase hex digits).
- `review_count`: count of all paginated GitHub review records, required to equal the complete `reviews` inventory.
- `reviewer_policy`: read-only *claimed* source-main policy evidence with matching `repo`, `base_sha`, `base_ref: "main"`, `protection_readable: true`, `protected: true`, `require_codeowners: true`, `dismiss_stale_reviews: true`, `bypass_count: 0`, `required_approvals` (1–6), and a unique, bounded `eligible_reviewer_ids` roster of numeric GitHub identities. Missing, mismatched or operator-controlled policy identities fail closed.
- `author`, `author_id`: GitHub author login and immutable numeric user ID.
- `as_of`: complete timestamp with UTC offset, from the read-only inventory.
- `reviews_complete: true`: an adapter assertion that **all pages** of reviews were retrieved (not independently proven by this module).
- `reviews`: complete chronological evidence records, unordered, with unique positive numeric `id`, GitHub `reviewer_id`, `login`, `state`, `commit_sha`, and `submitted_at`.

Require **at least the exact protected-main approval quorum**, counted by distinct eligible reviewer IDs, each with a latest valid `APPROVED` review at the exact head. A reviewer not in the policy-bound roster cannot satisfy the quorum. Explicitly disallow known operator-controlled numeric identities 2148448 and 11139560, as well as usernames `the1mills` and `ORESoftware`. Treat outstanding `CHANGES_REQUESTED` from any participant as blocking. A later `COMMENTED` review conservatively supersedes an earlier approval until live state is rechecked. Reject absent/partial history, duplicate/conflicting IDs and logins, ambiguous same-timestamp events, **impossible ISO calendar dates** (including invalid month/day/leap-day/24:00 rollovers) and invalid UTC offsets before `Date.parse` normalizes them, later-than-snapshot reviews, stale heads and 1001+ events. Snapshot age must be at most five minutes and no more than 30 seconds in the future.

The output `REVIEW_SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK` **is not merge authorization**. Caller-supplied data can be forged. The authenticity of the caller-supplied branch-protection and eligible-reviewer policy, check-run issuer identity, exact head/tree, job steps, native test/negative receipts and active agent leases are **outside this module's scope** and must be checked by authoritative GitHub reads immediately before each merge. The module has no network, token, permission mutation, source export or merge API.

## Tests

Run:

```sh
node --test tests/merge-wave-review-timeline.test.mjs
```

The initial draft had 54 host-only Node 22 regression tests locally executed on its exact original Git blobs. Four additional invalid-calendar/offset regression groups were committed after that run. Their execution and exact final-head test evidence are recorded separately in the PR; **hosted Actions execution remains unverified**. Tests include approval dismissal, changes requested, reapproval, stale/future snapshot, duplicated review identity, operator-ID aliasing, missing or mismatched reviewer policy, fake protected-main flags, unauthorized reviewers, and approval quorum shortfalls. They do not establish native compiler guest execution, cross-backend parity or GitHub rule enforcement.

## Integration plan

1. Have the read-only ledger #467 produce complete paginated raw review events, reviewer numeric IDs, total review record count and exact PR head, or return `REVIEW_HISTORY_INCOMPLETE`.
2. Have an independently authorized GitHub administrator/adapter attest current source `main` branch protection, reviewer roster and required approval count against the same `repo` and `base_sha`. A caller's `protection_readable: true` is **not** independent evidence; if admin readback returns 403/unknown, remain BLOCKED.
3. Pass the same current snapshot into this gate and the runner/receipt verifier from #474. Reconcile both sets of blockers, but *never* downgrade one component's failure to an advisory pass.
4. Attach protected-main readback and exact-head executable source-owned CI evidence. If the GitHub App cannot read protected rulesets, return **UNKNOWN/BLOCKED**, not true.
5. Independently review PRs and run exact-head CI; only a separately governed merge executor may later perform SHA-guarded merges.

No cross-organization private source mirror is authorized by this module. CI job `steps=[]` / `null` means runner-admission evidence is missing; it cannot be counted as a compiler test.
