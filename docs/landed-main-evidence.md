# Landed-main release evidence (advisory, fail closed)

The pre-merge wave qualifier in PR #470 evaluates candidate PR snapshots. This separate
post-merge audit checks the **landed squash commit**, not the original PR head. It never
writes GitHub state, runs guest code, exports private source, or grants release authority.

Run with Node 22:

```sh
node --test tests/landed-main-evidence.test.mjs
node bin/landed-main-evidence.mjs evidence/landed-main-20261106-wave.json
```

The second command **intentionally exits 1** and reports `BLOCKED`: five genuine
merges were observed on `main`, but their independent landed-SHA signoffs,
protected-main rules and exact-landed source-owned CI receipts are missing.
`NOT_EXECUTED`, `FAIL`, `UNSUPPORTED`, missing steps, and zero-runner records
cannot be promoted to `PASS`. Missing fields are blockers, not an implicit pass.

Before a real release gate can pass, a **distinct authorized reviewer** must inspect
and sign off the **landed commit**, not just the PR request. Admins must establish and
independently verify `main` protection (code owner review, stale dismissal, strict
checks, no bypass). For each required CI context, a GitHub-owned run must bind to
exact landed commit and tree, trusted app ID, attempt/job, nonzero runner ID,
completed meaningful steps and passing tests including relevant negative controls.
Compiler-guest scope requires real native/guest execution, never a host mock.

A `SNAPSHOT_READY_RECHECK_LIVE` result is **not certification**: callers must
re-fetch the PR, main comparison, review records, rules, issuer-bound check
runs and exact job steps directly from GitHub before making any release decision.
An independent approver can be recorded as a separately sourced post-merge
attestation; do not fabricate a GitHub review at a squash SHA. The sample ledger
contains no such attestation.

This auditor cannot fix source-org runner admission or branch protection; those
require authorized organization administrators and are tracked in conformance
issues #315, #69, #170 and post-merge ledger #19. Confidentiality issues #22/#77
prohibit unauthorized cross-organization source copies.
