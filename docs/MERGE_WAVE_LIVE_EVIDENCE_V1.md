# Merge-wave live GitHub evidence collector v1

This is a **read-only, source-free** intake inventory for AttoLang's five-PR / three-repository merge train. It never merges, approves, exports private sources, changes branch policies, or claims guest/compiler parity. Its output deliberately has `status: BLOCKED`, `merge_authorized: false`, `guest_certified: false`; a syntactically good snapshot remains advisory.

## Run locally / in a reviewed source-owned CI job

Requires Node.js 22 and a GitHub token with read-only access to the target repository's metadata, pull requests, checks, Actions runs/jobs, and branch protection. The token stays in the process environment and is never serialized into the report. For private repositories, use the intended source organization's approved GitHub App/CI token; **do not mirror source code to a different organization** to get Actions minutes.

```sh
GH_TOKEN=... node bin/merge-wave-live-evidence-v1.mjs \
  ores-truffle-oreslang/oreslang-source.java 2570

GH_TOKEN=... node bin/merge-wave-live-evidence-v1.mjs --wave \
  ores-truffle-oreslang/oreslang-source.java#2570 \
  ores-truffle-oreslang/oreslang-source.llvm#1444 \
  ores-truffle-oreslang/oreslang-source.wasm#395 \
  ores-truffle-oreslang/oreslang-source.net#370 \
  ores-truffle-oreslang/oreslang-source.forge#190
```

These example PR numbers are *illustrative historical identifiers*, **not a recommended merge set**; some may already be merged or draft and will block. Use current, independently chosen eligible PRs after checking each live head. Inputs are exact allowlisted source or platform repositories only. Wave mode requires exactly five unique PRs across at least three repos. Exit **1** means a printed audit snapshot remains blocked; exit **2** means invalid input, an unreadable required response, or a tool failure. There is **no exit 0 / merge-ready** mode.

## Trust boundaries and evidence

The CLI uses Node's native HTTPS implementation against **only** `api.github.com` on port 443, with method GET, fixed approved paths, a 15-second request timeout, a 2 MiB body cap, fatal UTF-8 decoding, no redirects followed, and no GitHub write endpoints. Network responses and records are still evaluated fail-closed. The pure collector takes an injectable `get(path)` adapter for testability; arbitrary in-memory adapters **do not supply authenticated evidence**.

Per PR, the collector reads:

1. Initial live PR with same-repo head/base identities, exact head and base SHAs, open/non-draft/mergeability state, and `main` base.
2. Current `main` branch and branch-protection policy. If rules are unavailable (e.g. **HTTP 403 from the integration**), `PROTECTION_UNREADABLE` blocks. It requires protected branch, code-owner review, stale-review dismissal, minimum approval count, explicitly empty user/team/app bypass allowances, strict required status checks bound to a GitHub App ID, and admin enforcement.
3. Exact Git commit/tree; complete, bounded, ID-deduplicated review pages; exact-head check-runs and workflow-run pages with total-count consistency. Missing, oversized, repeated, incomplete, or changing pages record blockers.
4. Up to twelve recent exact-head workflow runs and up to 128 jobs per run, with explicit scan-capped blockers rather than silently dropping evidence. Jobs are fetched again individually and bound to the exact `run.id`, `run_attempt`, `head_sha`, status/conclusion and runner allocation. Step numbers must be unique and substantive; housekeeping-only, null, and zero-step records never prove test execution.
5. Final PR, branch and protection readbacks. Concurrent PR head/base, mergeability, branch, or protection changes invalidate the snapshot.

The audit may report observed positive check-runs, reviews, and runner-executed steps, **but this does not certify** a CODEOWNERS reviewer's genuine independence, source-controlled workflow trust, positive/negative test assertions, mutation-test receipts, native AttoLang guest results, or artifact signatures. These remain explicit blockers, irrespective of what the observed data suggests.

## Integration with existing drafts

Do **not** modify or merge currently agent-owned drafts merely to consume the collector. After independent review and exact-head stepful source-owned CI:

- [#467](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/467) + stacked [#481](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/481): reconcile the inventory and mandatory run/job/attempt linkage.
- [#470](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/470) + [#474](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/474) + [#479](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/479): consume exact-head read-only check/job/receipt data only after strict five-PR cardinality and freshness fixes. Never interpret the offline classifier's favorable snapshot as live authorization.
- [#477](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/477): consume complete review history and administrator-authenticated eligible-reviewer policy. Numeric reviewer IDs alone do not prove role or independence.

All sources must agree on the **same** repo, PR number, head SHA, base SHA, tree SHA, run ID/attempt, review history and observation time. Disagreements or unreadable admin policy are `BLOCKED`. A separate security-reviewed executor, with a fresh race-resistant head recheck before each merge, would be required later; this PR does **not** implement one.

## Tests and limits

```sh
node --test tests/merge-wave-live-evidence-v1.test.mjs
```

The 46 tests exercise adversarial paginated GitHub fixtures, branch-policy 403, bypass arrays, wrong App IDs, repeated IDs, stale head/branch/policy changes, stale run attempts, job readback mismatch, zero-step jobs, housekeeping spoofing, failed workflows with successful individual steps, and the fixed five-PR wave contract. They are **source-free local Node tests**, not hosted Actions, compiler-backed fixtures or an independent review. The collector has no persistent cache, scheduler, approved source-mirror mechanism, nor ability to assert org billing/runner root causes.
