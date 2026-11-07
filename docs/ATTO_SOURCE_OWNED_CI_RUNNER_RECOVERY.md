# AttoLang source-owned CI admission and exact-head test runbook

**Status: diagnostic only.** This document does not prove that a GitHub runner
was allocated, tests executed, guest compilers worked, or a release is safe.
Use the existing source-owned workflows. Do not mirror private compiler
source, caches, objects or artifacts into an unrelated GitHub organization.

## Stage 1 — metadata-only runner allocation

The existing `.github/workflows/source-local-runner-allocation-canary.yml`
is deliberately scoped to the source organization. It requires neither a
checkout nor repository file reads, has `permissions: {}`, runs only on
`ubuntu-24.04` and writes a short metadata-only artifact with one-day
retention. This child PR changes that workflow to validate the presence
of `RUNNER_NAME`, `RUNNER_OS`, `GITHUB_RUN_ID` and `GITHUB_SHA`
before emitting `RUNNER_ALLOCATED source_local=true` in the job log.

When the child PR is opened, check **that PR's source-org canary run**.
Only count allocation if GitHub's independently fetched job record
shows all of the following together:

- `status=completed`, `conclusion=success`, and a positive
  `runner_id` with nonempty `runner_name`.
- A nonempty `steps` array containing the completed, successful
  `Confirm a runner executed a shell step` step.
- The expected repository, selected workflow, run attempt, pull request
  head/merge relationship and the `RUNNER_ALLOCATED` log marker.
- The metadata-only artifact is optional diagnostic corroboration; its
  contents alone are **not** authenticated evidence.

Do not infer runner allocation from a workflow-level `failure` or
`success` alone. A job with `runner_id=null` or `steps=null`
is **NOT_EXECUTED**, even when marked completed/failure. A 404
`BlobNotFound` job-log response is not a test failure.

## Stage 2 — source-owned Node 22 verification

Only after Stage 1 has passed, use the existing source-owned
`.github/workflows/landed-main-evidence.yml`. It checks out the **same
source-organization conformance repository**, verifies the exact
`github.event.pull_request.head.sha` or push SHA against `git rev-parse
HEAD`, checks for worktree shadows, and runs:

```sh
node --check tools/atto-five-backend-certification-v1.mjs
node --check tools/atto-guest-case-oracle-v1.mjs
node --check bin/atto-five-backend-certification-v1.mjs
node --test tests/landed-main-evidence.test.mjs \
  tests/landed-main-20261106-platform-wave.test.mjs \
  tests/atto-five-backend-certification-v1.test.mjs \
  tests/atto-guest-case-oracle-v1.test.mjs
```

The workflow also checks both landed-main ledgers and the five-backend
candidate CLI remain **BLOCKED** with its expected nonzero exit
status. It is essential to execute all six previously skipped
filesystem/CLI tests on a real Node 22 host, not an in-memory V8 harness.

Inspect the source-owned job ID, runner ID and name, attempt number,
executed step conclusions, exact checked-out commit/tree, captured output,
and any artifact provenance. Tests must be rerun after any head change.
A local pass, an alternate-org no-checkout canary, and a GitHub workflow
with no executed steps never substitute for this source-org check.

## Stage 3 — administrator blockers

If runner admission remains blocked, an authorized owner should check
Actions policy/eligibility for `ubuntu-24.04`, runner-group access,
GitHub-hosted concurrency/usage/budget, job annotations and billing.
Do not simply rerun a zero-step workflow in a loop, assert an unverified
cause, or use an unapproved cross-org mirror. A same-org, ephemeral,
security-reviewed self-hosted runner is an option **only after**
administrator approval.

For protected `main`, separately verify private-repository plan
eligibility and integration permissions. All five compiler repositories
plus conformance previously exposed `main.protected=false`.
The connected GitHub REST rulesets endpoint returned a private-repository
feature/plan HTTP 403, and the branch-protection read returned an
integration-access HTTP 403. These are distinct issues to resolve through
an authorized administrator, **not** reasons to make the repository public.

## Release gate remains closed

Keep stacked PR sequence **#476 -> #498 -> #516 -> #547 -> #552 -> this
diagnostic PR** pending independent review, enforceable source-owned
branch protection, real stepful Node tests, canonical actor/Task oracles,
and authenticated execution on Java/GraalVM, LLVM, Wasm, Forge and .NET.
The current case inventory records 20 cases x 5 backends = **100
NOT_EXECUTED** backend-case cells; an offline certification report
always returns `release_authorized:false`. See issues #22, #69, #77,
#170 and #315 for confidentiality, branch governance and runner holds.
