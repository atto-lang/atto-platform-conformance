# Landed-main release evidence (advisory, fail closed)

This is a read-only **post-merge** evidence auditor. It is distinct from the
**pre-merge** qualifier in PR #470. It never merges code, exports private
source, changes protection settings, or grants release authorization.

## How to run

From the repository root with Node 22:

```sh
node --test tests/landed-main-evidence.test.mjs
node bin/landed-main-evidence.mjs evidence/landed-main-20261106-wave.json
```

The suite now has **88 authored cases**. At the current PR head, **81 pure source/test-body cases ran successfully in an isolated V8 harness** against exact GitHub blobs; the **seven real filesystem/CLI cases have not been rerun under Node 22** since the latest hardening. No hosted Actions or compiler guest execution is established. The cases cover adversarial source/tree/workflow substitutions,
fake reviews, duplicated or missing positive/negative fixtures, misleading guest
results, continue-on-error and skipped CI steps, Unicode housekeeping spoofing,
invalid input, noncanonical/duplicate-key JSON, and symlink/hardlink paths.
GitHub Actions must independently execute the same tests at the final PR SHA.

The example ledger intentionally returns exit **1**, `BLOCKED`, with
**five real merged PRs**. Their landed tree hashes and GitHub
`compare(merge_sha...main)` ancestry are pinned, but protected-main enforcement,
post-merge independent review, authoritative fixture inventories, and exact
landed-commit source-owned CI receipts are not established. They remain
`NOT_VERIFIED` or `NOT_EXECUTED`; no facts were invented to qualify them.
Exit **2** means malformed/untrusted JSON and is also a hard failure.

## Evidence contract

Each ledger entry must explicitly identify:

- `repo`, PR number, author, `merged:true`, `base_ref:main`, original PR
  head, landed merge commit, and **landed Git tree** SHA.
- Current main SHA, GitHub compare status, exact `merge_base_sha`, `ahead_by`,
  and `behind_by:0`. For `identical`, ahead must be zero; for `ahead`, positive.
- Verified protection settings: required independent/CODEOWNERS approvals,
  stale dismissal, strict checks, admin enforcement, **zero bypass allowances**,
  no force pushes, and no deletion.
- Independent post-merge review attestation with reviewer identity, original
  repository, **landed SHA + tree**, and attestation SHA-256. A hash field alone
  does **not** authenticate a signature, reviewer or document. An external
  trusted verifier must confirm the underlying attestation and reviewer
  independence; ordinary approvals on the old PR head do not suffice.
- `requires_guest` as an explicit boolean; no implicit downgrade to
  host-only proof. A bounded `required_tests` inventory with distinct case IDs,
  exact fixture Git blobs, at least one positive and one targeted negative.
  Positive receipts must match exit status and stdout **byte for byte**.
  Negative receipts must fail for the intended diagnostic category and
  frontend/type-checker phase, not a generic parse error or crash.
- Each required GitHub check's **exact context, trusted app ID, workflow blob
  SHA**, plus a source-owned run's repository, landed commit/tree, workflow
  SHA, run/attempt/job/runner IDs **and nonblank runner name**, artifact SHA-256,
  completed run and **completed per-step status**, meaningful successful steps,
  and complete matching case receipts. A step with a fabricated `success` conclusion
  while still queued/in progress is not execution evidence. Runs with failures,
  skipped meaningful work, zero steps, or housekeeping-only execution fail.
  All required cases must be covered; an unrelated successful test cannot
  stand in for a missing positive or negative.

## Trust boundary

Input is an **untrusted offline snapshot**. The CLI accepts a single, regular,
single-linked, non-symlink ledger (up to 256 KiB), checks its opened file
descriptor, and requires canonical pretty-printed JSON to reject duplicate
or escaped authority keys. The output `SNAPSHOT_READY_RECHECK_LIVE` is still **not
release certification**. A separate verifier with trusted GitHub access must
re-fetch each PR merge, main ancestry, branch protection, independent signed
attestation, app-issuer-bound required status and actual job logs before any
release decision. A user-supplied app ID, digest, runner ID, or self-declared
`PASS` is not itself evidence of execution.

Required backend guest evidence is not established by this host-only tool.
Source-org runner admission [#315](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/315)
and branch protection [#69](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/69)
require authorized administrators. Release audit [#19](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/19)
tracks post-merge review debt. Confidentiality issues [#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22)
and [#77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77)
prohibit unauthorized cross-org private-source mirroring, even to a private
organization with GitHub Actions capacity.
