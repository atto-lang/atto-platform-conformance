# Merge-wave reviewer timeline gate (source-free, advisory)

This isolated module supports the five-PR / three-repository AttoLang merge train without merging anything. It is intentionally separate from the open qualifier [#470](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/470), its stacked runner/receipt evidence hardening [#474](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/474), and blocker ledger [#467](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/467). No shared file was edited.

## Scope

`tools/merge-wave-review-timeline.mjs` exports `qualifyReviewTimeline(candidate, {now})` and `snapshotFreshness(asOf, now)`. The candidate expects:

- `head_sha`: exact PR head (40 lowercase hex digits).
- `author`, `author_id`: GitHub author login and immutable numeric user ID.
- `as_of`: complete timestamp with UTC offset, from the read-only inventory.
- `reviews_complete: true`: an adapter assertion that **all pages** of reviews were retrieved (not independently proven by this module).
- `reviews`: complete chronological evidence records, unordered, with unique positive numeric `id`, GitHub `reviewer_id`, `login`, `state`, `commit_sha`, and `submitted_at`.

A latest valid `APPROVED` review on the exact head from a distinct, non-operator identity is needed. Explicitly disallow known operator-controlled numeric identities 2148448 and 11139560, as well as usernames `the1mills` and `ORESoftware`. Treat outstanding `CHANGES_REQUESTED` from any participant as blocking. A later `COMMENTED` review conservatively supersedes an earlier approval until live state is rechecked. Reject absent/partial history, duplicate/conflicting IDs and logins, ambiguous same-timestamp events, malformed dates, later-than-snapshot reviews, stale heads and 1001+ events. Snapshot age must be at most five minutes and no more than 30 seconds in the future.

The output `REVIEW_SNAPSHOT_QUALIFIED_REQUIRES_LIVE_RECHECK` **is not merge authorization**. Caller-supplied data can be forged. The source branch protection, check-run issuer identity, exact head/tree, job steps, native test/negative receipts and active agent leases are **outside this module's scope** and must be checked by authoritative GitHub reads immediately before each merge. The module has no network, token, permission mutation, source export or merge API.

## Tests

Run:

```sh
node --test tests/merge-wave-review-timeline.test.mjs
```

31 host-only Node 22 regression tests were executed locally on the exact two Git blobs in the draft proposal; **hosted Actions execution remains unverified**. Tests include approval dismissal, changes requested, reapproval, stale/future snapshot, duplicated review identity and operator-ID aliasing. They do not establish native compiler guest execution, cross-backend parity or GitHub rule enforcement.

## Integration plan

1. Have the read-only ledger #467 produce complete paginated raw review events, reviewer numeric IDs and exact PR head, or return `REVIEW_HISTORY_INCOMPLETE`.
2. Pass the same current snapshot into this gate and the runner/receipt verifier from #474. Reconcile both sets of blockers, but *never* downgrade one component's failure to an advisory pass.
3. Attach protected-main readback and exact-head executable source-owned CI evidence. If the GitHub App cannot read protected rulesets, return **UNKNOWN/BLOCKED**, not true.
4. Independently review PRs and run exact-head CI; only a separately governed merge executor may later perform SHA-guarded merges.

No cross-organization private source mirror is authorized by this module. CI job `steps=[]` / `null` means runner-admission evidence is missing; it cannot be counted as a compiler test.
