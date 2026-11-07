# AttoLang runner-evidence correlation v1

**Status:** draft source-only API metadata contract, not a runner, compiler or release attestation.

Source: `verification/runner-evidence-correlation-v1.mjs`
Tests: `tests/runner-evidence-correlation-v1.test.mjs`
Owner: conformance PR #556. Follow-on independent hosted-runner/log verifier: PR #553 (stacked on #543).

## Inputs and trust boundary

`correlateRunnerEvidence({run,pages,jobDetail,expected,perPage,receipt})` takes:

- `run`: a GitHub Actions run response for one immutable source commit and attempt.
- `pages`: **every** attempt-scoped jobs API page, in request order, represented as
  `{number:1,response:{total_count,jobs:[...]}}`, `{number:2,...}` etc.
  Page numbers are recorded by the reader that performed each request, NOT supplied by
  GitHub's JSON response itself. A trusted reader must independently bind these wrappers
  to the exact API route, requested page number and `per_page` value.
- `jobDetail`: separately retrieved job-detail record for the pinned numeric `expected.jobId`.
  Supplying two copies of one JSON object is **not independent retrieval**.
- `expected`: reviewed, externally pinned `repo`, `headSha`, `runId`, `attempt`,
  `jobName`, `jobId`, `event`, `requiredSteps`, `perPage` and optional
  `treeSha` / `tapSha256`. Never derive these expectations from the record being checked.
- `receipt`: optional **self-reported** source-only Node test receipt. Matching identities
  and hash strings are *consistency checks*, not independent verification that the bytes
  were produced by that runner. `null` is allowed and remains unbound.

Only `perPage` values 1–100 and complete inventories of 1–100 jobs are supported.
Missing, duplicated, reordered, partial or inconsistent pages fail closed. Do not treat the
100-job limit as evidence that larger executions cannot exist: use a new reviewed contract
rather than silently truncating larger inventories.

## Layered outcomes

The module reuses `classifyRunnerJobEvidence` from #556 to enforce exact run/head/attempt,
unique job identities, required step status, timing and zero-runner distinction. It adds a
full job-list versus separately fetched job-detail comparison (including runner group, labels,
URLs and full step records when present), plus optional source-only receipt field binding.

All successful correlations return:
- `correlation='COMPLETE_JOB_LIST_AND_DETAIL_API_ONLY'`
- `independentHostedLogAttestation=false`
- `guestExecutionProven=false`
- `mergeAuthorized=false`

A reported stepful success remains `STEPFUL_RECORD_REQUIRES_INDEPENDENT_ATTESTATION`.
A zero-runner observed failed attempt is `RUNNER_NOT_ADMITTED` only under the earlier
strict #556 negative observation conditions. Missing metadata remains unverified.
No result is compiler-backed guest parity.

## Integration checkpoint for PRs #553 / #543

The post-admin-repair reader must independently:
1. Fetch the original **source organization** run for the pinned attempt and verify
   immutable head, workflow blob, tree and source repository identity.
2. Fetch **all** attempt-scoped job pages with reviewed pagination and a separate job detail;
   pass the responses into this correlation layer when the dependency becomes available.
3. Fetch and verify the real job logs, GitHub-hosted runner group/image evidence, source-free
   output markers tied to executed step windows, and the job/step API records using #553.
4. Bind any receipt and transcript digests to independently downloaded exact bytes and
   job/attempt identity. A supplied hash alone is not sufficient.
5. Only after original-organization canary admission works, execute the 86 + 36 source-only
   tests under hosted Node 22 and independently check results. Compiler-backed `.atto`
   execution requires its own separate exact-head workflow and receipts.

**No code in #553 was changed by #556.** The bridge interface is available for future
reviewed integration; current draft branches cannot import each other's unmerged changes.
No cross-organization private-source transfer, workflow permission broadening, main write,
review bypass, draft promotion or merge is authorized by this document.
