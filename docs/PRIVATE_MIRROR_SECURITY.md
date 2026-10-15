# Private source mirror authorization

This repository's private-source mirror publisher is **deny-by-default**.
The source repository's default branch must be `main`; GitHub must report
both source and destination as private, unarchived, and the destination as
writable. The publisher also requires the destination to appear in **both**
the caller's restrictive allowlist and the exact
`.github/private-ci-approved-repositories.txt` file fetched from the
source repository's `main` branch. This file is initially empty.

**Maintainers must configure branch protection/rulesets and mandatory
security code-owner review for changes to the policy file and exporter.**
The API's `main` reference by itself cannot prove human review. A PR
under test must never authorize its own private-source export.

Require signed-off authorization of the destination organization's access,
source confidentiality, maximum retention, Actions/artifact exposure, and
the cleanup plan, before merging a specific destination into this file.
Do not use environment-supplied approvals, a public destination, or
generic cross-org file copying to evade this restriction. Repo-level
GitHub Actions authorization to execute does not replace this policy.

The trusted exporter revalidates repository visibility, the approved
source-main policy, and the pinned destination-main commit before **each**
Git-object write (blob, tree, commit, or isolated ref). Every source file must
be placed under a dedicated `snapshots/...` subtree, never at repository
root or `.github/workflows`, where a mirrored source file could become
executable GitHub Actions configuration on a temporary branch. Before
accessing private source blob bytes, the publisher requires that GitHub's
returned source commit SHA equals the requested commit, and independently
rehashes every recursively listed source directory (Git tree format) up to
the pinned root Git tree SHA. This catches injected, missing, renamed, or
remoded paths that individually valid blob IDs cannot detect. Source blob
base64 is then checked for canonical bytes, exact size and SHA before
publication. The hash check does not substitute for secure transport,
source repository access control or independent export authorization.
The exporter publishes only a **new** isolated CI branch after verifying all
Git objects. Verification must account for the complete materialized Git
tree: every pinned blob inside the snapshot must match, and every Git object
outside the snapshot and its changing ancestor directories must preserve
its original type, file mode and SHA. Unexpected files, missing pre-existing
files, modified workflows, and mutated unrelated directory trees must all
fail before a commit or temporary ref is published. A snapshot-only check
does not prove the destination's trusted workflow tree was preserved.

A Git tree hash confirms exact bytes, not that the transfer was authorized
or that the compiler worked. Even after a temporary branch is deleted or rewound,
retained Git objects, Actions caches and logs require separate review.

**Existing exception:** [security issue #28](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/28)
tracks an earlier private mirror performed using the GitHub connector
outside this publisher's authorization path. That run's shared-harness
tests are useful engineering evidence, but it does not establish approval
for future transfers or supersede origin branch-protection checks.

Test changes with `npm test` before any real source transfer. Tests
inject mock GitHub responses and never copy private source.

## Trusted destination main base

The publisher must bind `destinationBaseCommit` to the destination's live
`refs/heads/main` **before accessing any private Git source objects**. It
rechecks that exact ref before **every** destination blob/tree/commit/ref
mutation, not only at final branch publication. A caller-provided destination
commit is not enough: an arbitrary existing Git object could contain
unreviewed GitHub Actions workflows or stale confidential content.

A fast-changing destination `main` is treated as a failed admission rather
than silently rebasing: restart with a separately reviewed new base.
Although this prevents intentionally stale or unrelated base commits, it
does **not** authenticate what is in destination `main`, prove CODEOWNER
review, or exclude a race after the final ref read. Security reviewers must
inspect the trusted destination workflows and access before approval.

The security regression suite includes an initial forged base, a changed
base before commit, a changed base before ref publication, empty/incorrect
source-main destination policy, and a non-main destination default branch.
