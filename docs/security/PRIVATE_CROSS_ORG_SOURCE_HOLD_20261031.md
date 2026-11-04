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
allowlist as an admission mechanism. The dormant metadata authorization,
GitHub source blob copying, tree/commit creation and ref-writing helpers
have been **deleted** from the publisher modules, not merely hidden behind
a preliminary throw. The entrypoint scanner no longer exempts any publisher
filename from the direct Git-write detection gate. A mixed-case known carrier,
unknown same-owner historical relay, source-to-self branch, or ostensibly
private approved destination **cannot bypass the unconditional stop**. Removing
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

## Disposition contact is not an independent export approver

The nine-incident review registry names `ORESoftware` (GitHub account ID
`11139560`) as the disposition contact, **not** an independently qualified
private-source transfer reviewer. The historic metadata verifier explicitly
excluded account IDs `11139560` and `2148448` from the independent
authorization reviewer role. The registry's independent-reviewer slot is
therefore deliberately **UNASSIGNED**, not silently populated by a
CODEOWNERS alias, PR reviewer request or issue-closure contact.

Issue closure and non-authorizing disposition records cannot re-enable the
disabled publisher. A distinct, authorized reviewer must be nominated,
verified against current GitHub identity and permissions, approve the exact
protected-main authorization policy, and be independently attested before a
separately reviewed transfer protocol can even be proposed. No existing
operator-owned review request satisfies this requirement.

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

At exact branch head `b8f3c6722d9ad5646ed4fadd0f399a38bc190cb8`,
read-only inspection confirms that the **first executable statement** in
both exported source publisher functions remains unconditional denial,
and neither module contains GitHub API object-copy machinery.
The original source organization's hosted security jobs continue to fail
before runner assignment; the **new Node tests are not yet executed**.
Record the newest exact-head run/job/steps receipt separately before any
claim of executed compiler, runtime or security CI acceptance.

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
