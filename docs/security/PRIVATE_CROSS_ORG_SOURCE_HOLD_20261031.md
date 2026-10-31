# P0: Cross-organization private Oreslang source-copy hold

**Status: enforced, non-authorizing.** Incidents #22 and #77 in this
repository are open. Their independently reviewed disposition and per-snapshot
transfer approval have not been established. A private GitHub carrier, an
existing source blob in that carrier, a matching Git SHA, an allowlisted
destination, or an Actions runner with budget **does not** grant permission
to copy private Oreslang source across organization boundaries.

## Enforcement

The shared `bin/require-private-mirror.mjs` preflight now rejects any
`ores-truffle-oreslang/*` private source whose destination owner is not
`ores-truffle-oreslang`, **before an HTTP request occurs**. GitHub owner
matching is case-insensitive. `bin/private-mirror-publish.mjs` already calls
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
including mixed-case source owner spelling. They prove **zero source fetch
and zero destination writes** even when a private destination appears on an
environment allowlist. Existing positive tests now operate only on synthetic,
same-organization private repository identities, without real source bytes.

`.github/workflows/private-mirror-incident-hold.yml` runs the actual
checked-in Node suites on the exact source PR SHA within this organization.
A synthetic canary succeeding in another organization proves only runner
availability—not source transfer approval or conformance.

## Current test boundary (2026-10-31)

The current policy/publisher code and both test modules were evaluated with
isolated mocked GitHub responses under V8 and their complete test bodies
passed 28/28 cases (281 assertions) before the mixed-case extension. This
was not a hosted Node `--test` run. Source-org hosted jobs have recorded
zero steps/runner absent; do not call the new workflow passing until it
executes. No cross-organization private source was transferred.
