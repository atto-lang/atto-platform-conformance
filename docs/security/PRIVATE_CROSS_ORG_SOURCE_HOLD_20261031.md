# P0: Cross-organization private Oreslang source-copy hold

**Status: proposed on DRAFT PR #263; NOT MERGED, non-authorizing.** Incidents #22 and #77 in this
repository are open. Their independently reviewed disposition and per-snapshot
transfer approval have not been established. A private GitHub carrier, an
existing source blob in that carrier, a matching Git SHA, an allowlisted
destination, or an Actions runner with budget **does not** grant permission
to copy private Oreslang source across organization boundaries.

## Enforcement

The proposed `bin/require-private-mirror.mjs` preflight denies **every
cross-organization** private Git-tree copy, including a relay via a
previously populated private carrier. It also denies **all** `ores-truffle-oreslang/*` source publication,
including copies to a different repo in the same organization or to a
new branch of the **source repository itself**: no source-bearing handoff
namespace has been approved.
GitHub owner/repository comparisons are case-insensitive. The refusal happens
**before an HTTP request occurs**. `bin/private-mirror-publish.mjs` already calls
this preflight before fetching source commit/tree/blob data or creating
destination blobs, trees, commits, or branch refs; repeated per-write
authorization must remain in place. An environment allowlist alone cannot
override this hold. Do not add a user-controllable `skip` or `force` option.

This is a stopgap enforcement layer rather than a complete cross-organization
resumption mechanism. Changing this gate requires an **independently reviewed**
security change after incident #22 and #77 disposition, and separate
authorization that binds source repository and immutable commit/tree,
destination repository numeric ID, visibility, audience, and one-use branch
namespace. The remaining private-CI incidents and protected-main provenance
controls must also be reviewed. Never treat a deleted branch as proof that
historically copied Git blobs and Actions caches are gone.

## Executable negative evidence

`tests/private-mirror-visibility.test.mjs` and
`tests/private-mirror-publish.test.mjs` contain cross-org negative cases,
including mixed-case source owner spelling, cross-organization relay sources,
same-organization alternate Oreslang repositories and self-repository
branch creation. They prove **zero source fetch
and zero destination writes** even when a private destination appears on an
environment allowlist. Existing positive tests now operate only on synthetic,
same-organization private repository identities, without real source bytes.

`.github/workflows/private-mirror-incident-hold.yml` runs the actual
checked-in Node suites on the exact source PR SHA within this organization.
A synthetic canary succeeding in another organization proves only runner
availability—not source transfer approval or conformance.

## Current test boundary (2026-10-31)

The current policy/publisher code and both checked-in test modules
passed **34/34 test cases and 303 assertions** in an isolated V8 execution
harness with mocked GitHub responses. The separate three-case
`private-mirror-entrypoints.test.mjs` scanner also passed under a synthetic
filesystem harness, and its detection function was individually applied
to all **40** executable `bin/`, `tools/` and workflow files in this
repository: only the guarded publisher matched its direct-writer patterns.
The policy scanner is defense-in-depth and does not inspect every potential
external program, dynamic command, or other GitHub organization.
These results are **not** hosted Node `--test` execution.
Source-org hosted jobs have failed before runner assignment; do not call the
new workflow passing until it executes. No private source was transferred.

## Runner-admission evidence

The prior source-free retry in private `honeypot-r-us-test/hnpt-infra`,
Actions run `41147809804` attempt 2, failed with no assigned runner and
zero executed steps. Its earlier successful unrelated source-free run does
not establish present runner capacity. The actual GitHub Actions policy,
spending, or admission error still requires an administrator to investigate.

For the exact zero-step job IDs and the read-only administrator investigation
order, see [runner-admission packet](RUNNER_ADMISSION_DIAGNOSTIC_PACKET_20261031.md).
