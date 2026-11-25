# Advisory PR ownership leases and dependency-aware merge waves (v1)

This is a **source-free coordination utility**, not a GitHub lock server,
not a merge bot, and not evidence of guest compiler execution. It is designed
for cross-agent work on `ores-truffle-oreslang`, `atto-lang`, and `atto-co`.

## Lease comments

A claim consists of one line beginning `ATTO_PR_LEASE_V1 ` followed by
**canonical JSON** with the exact fields
`claimId,expiresAt,head,issuedAt,number,owner,paths,repo,scope,status`.
Use canonical millisecond-UTC timestamps; TTL must be at most **45 minutes**.
The authenticated comment author must match the owner login. The `head`
is the full, pinned PR commit. `scope` is `files` with 1–30 bounded repo
paths or `merge` with an empty path list. Releases use the same claim ID,
owner, scope, paths and head and a later timestamp, with `status=released`.

Example:
```json
{"claimId":"agent-lease-1","expiresAt":"2026-11-08T15:40:00.000Z","head":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","issuedAt":"2026-11-08T14:55:00.000Z","number":123,"owner":"the1mills","paths":["src/parser.mjs"],"repo":"org/repo","scope":"files","status":"active"}
```

The library `src/merge-coordination-v1.mjs` checks malformed comments,
forged authors, duplicate-key/canonical encodings, stale heads, expiry,
invalid transitions, and overlapping file/directory/merge claims.
Use the *authenticated, complete* PR discussion timeline, including pagination.
It fails closed on unreadable/malformed lease records.

**Crucial:** GitHub comments are append-only but are **not atomic locks**.
Two agents may both post claims after an empty read. This library's result always
states `exclusiveLockAcquired:false` and `mergeAuthorized:false`.
For write exclusivity, use a trusted GitHub-side compare-and-swap primitive
(e.g. contents create/update on a fixed coordination branch/path with the
expected existing blob SHA and a 409/422 conflict denial) and read back the
claimed ownership. Only then proceed with an expected-head Git ref update.
Never infer exclusivity from this ledger alone.

## Dependency ordering

`planMergeWave(prs)` topologically sorts a manifest with:
`repo`, `number`, `head`, `base`, `state`, `draft`, `dependsOn`
(and a `mergeCommit` for an already-merged parent). It denies cycles,
missing parents, duplicate IDs, fewer than five open PRs, fewer than three
repositories, drafts, undeclared stacked bases and unverified parent merges.
For an open stacked PR, it marks `STACKED_REQUALIFICATION_REQUIRED`.
After the parent merges, the operator must retarget or semantically restack
the child, reread the base/head, rerun exact-head executed CI, and obtain
the applicable independent review. A nonempty order is only a *plan*, never
merge authorization.

## Actual merge qualification (separate, mandatory)

Before each merge: reread authenticated head, base, independently submitted
review, CODEOWNERS and branch protection, release/security holds, required
CI provider and run attempt, runner ID, positive named executed steps, and
the dependency parent merged-main ancestry. Take an atomic short lease and
merge using an expected head SHA; verify GitHub `merged=true` and the resulting
merge commit. Zero-step Actions means NOT_EXECUTED. No private-source
mirrors/canaries across organizations without explicit reviewed authorization.

The seed manifest is in `evidence/merge-wave-task8-20261108.json`: the
public five-PR candidate wave already coordinated in conformance issue #582.
It is a point-in-time **unverified plan snapshot**, not evidence that any
five PRs merged or are ready.
