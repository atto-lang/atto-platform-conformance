# P0: Cross-organization private Oreslang source-copy hold

**Status: proposed on DRAFT PR #263; NOT MERGED, non-authorizing.** Incidents #22 and #77 in this
repository are open. Their independently reviewed disposition and per-snapshot
transfer approval have not been established. A private GitHub carrier, an
existing source blob in that carrier, a matching Git SHA, an allowlisted
destination, or an Actions runner with budget **does not** grant permission
to copy private Oreslang source across organization boundaries.

## Enforcement (current PR branch)

**No private-source publishing is permitted by these generic entrypoints.**
Both `bin/require-private-mirror.mjs` and `bin/private-mirror-publish.mjs`
begin their exported functions with the same unconditional
`PRIVATE_SOURCE_PUBLISH_DISABLED_PENDING_PROTECTED_MAIN_APPROVAL` denial.
The halt is before parsing caller-provided repository names, reading any Git
source objects, making GitHub API requests, or creating a destination blob,
tree, commit, ref, artifact, or transfer.

This replaces the former finite quarantine and caller-supplied environment
allowlist as an admission mechanism. Those checks and legacy copy helpers
remain in the source for forensic review only; they are unreachable through
the exported publisher functions. A mixed-case known carrier, unknown
same-owner historical relay, source-to-self branch, or ostensibly private
approved destination **cannot bypass the unconditional stop**. Removing
the stop, or adding a user-controlled `force` or testing override, is not an
acceptable fix to runner allocation.

Resumption requires a **separately designed and independently reviewed**
provenance-bound transfer protocol, after incident dispositions. The required
authority must bind protected source-main policy, exact source commit/tree,
source ownership, destination numeric ID, private visibility, permissions,
retention, provenance and single-use namespace. No review, source-free
canary, matching Git hash, or successful old carrier build suffices by itself.
Branch rollbacks and private visibility do not purge historical Git objects
or downstream caches, clones or artifacts.

## Regression tests and verification boundary

`tests/private-mirror-visibility.test.mjs` and
`tests/private-mirror-publish.test.mjs` now contain **denial-only** tests
for ordinary repositories, Oreslang sources, historical carrier owners,
unknown same-owner and cross-owner relays, casefold aliases, caller-supplied
allowlists and tokens, malformed arguments, mock success responses and CLI
entrypoints. Each requires zero GitHub API calls or object operations.
The executable-surface scanner
`tests/private-mirror-entrypoints.test.mjs` still checks for unguarded
source-copy entrypoints. All these tests are source-local and do not export
source when executed.

At PR head `27c6c6966fe58cb2581b894fc1414fbb340c5474`,
read-only inspection confirms that the **first executable statement** in
both exported source publisher functions is the unconditional denial.
The exact-head source-org hosted workflows
[`41393537066`](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/41393537066)
and [`41393537048`](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/41393537048)
finished in failure before runner assignment, with zero observed job steps.
Consequently the **new tests are not hosted-executed**, and this change
must not be reported as passed compiler, runtime, or security CI.

Prior synthetic acceptance/transfer-model test counts in earlier revisions
are superseded by the unconditional lockdown. Reinstating any publish path
would require new, independently reviewed tests and actual exact-head CI
execution. Keep this PR draft and the transfer hold until the applicable
review and protected-main gates are independently verified.

## Runner-admission evidence

The prior source-free retry in private `honeypot-r-us-test/hnpt-infra`,
Actions run `41147809804` attempt 2, failed with no assigned runner and
zero executed steps. Its earlier successful unrelated source-free run does
not establish present runner capacity. The actual GitHub Actions policy,
spending, or admission error still requires an administrator to investigate.

For the exact zero-step job IDs and the read-only administrator investigation
order, see [runner-admission packet](RUNNER_ADMISSION_DIAGNOSTIC_PACKET_20261031.md).
