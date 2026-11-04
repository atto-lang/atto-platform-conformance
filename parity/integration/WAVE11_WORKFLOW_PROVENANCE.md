# Wave 11 — Tasks 51–55: workflow-bound evidence and bounded GitHub API reads

**Status: draft, stacked on [PR #63](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/63).** This branch hardens an operator-side read-only CI auditor; it does **not** restore GitHub Actions minutes, run production source compilers, or certify backend parity.

| Task | Change | Required proof before trusting further |
| --- | --- | --- |
| **51. Bind the intended workflow/PR** | `src/verified-actions.mjs` pins live GitHub workflow ID **387278056**, file `.github/workflows/pinned-six-wave-host.yml`, workflow name and job name. Requires the expected PR number, exact source HEAD and originating repository, including the PR's own `head.sha`; rejects same-head unrelated workflows and forks. | The approved source-org workflow identity and reviewed PR commit must match the live run. If the workflow is recreated, this ID requires explicit reviewed update. |
| **52. Check all 12 required steps in order** | Counts only truly completed, non-skipped steps; checks the authored ordered sequence from checkout through Node and Clang setup, six pinned wave checkouts, source SHA confirmation, test harness and source-suite execution. Distinguishes `NO_EXECUTED_TEST_EVIDENCE`, `PARTIAL_EXECUTION_NOT_HOST_PROOF`, and metadata-only full-step observations. | Actual step logs and independent job evidence must still be reviewed; matching step names/statuses alone are not compiler proof. |
| **53. Bind report artifact metadata** | Requires exactly one non-expired, nonempty `pinned-six-wave-host-report` artifact for an otherwise complete host workflow. Rejects duplicate IDs, wrong run/HEAD association, and artifacts attached to zero-step runs. | This checks **only metadata**, not the ZIP bytes, report contents, SHA or runner signing authority; `reportContentsValidated:false` always. |
| **54. Bounded, redirect-denying API transport** | Uses fixed GitHub GET URLs, 15-second AbortSignal, JSON Content-Type, optional Content-Length ceiling, a streaming `getReader()` byte budget (never unbounded `response.text()`), strict UTF-8, no redirects, no HTML/error fallback, and rejects truncated pagination. | An approved read-only GitHub API token must be provided separately by the reviewer for private repos. This cannot repair zero-step Actions jobs. |
| **55. Production-safe operator CLI + live confirmation** | `bin/audit.mjs` now requires `--pr` in addition to `--run-id`, `--head`, optional attempt and an absolute output file. All outcome codes remain nonzero; even a full-step run with report metadata is never a release certification. | Use independent artifact byte/hash, runner authority and real compiler-source guest tests before release or parity claims. |

## Exact local verification

Executed **19/19 Node v22.16.0 tests**, zero failures/skips/TODO, including actual child CLI invocation and negative cases for wrong workflow/PR/repo, queued and skipped steps, failed workflow/job conclusions, reordered steps, missing/duplicated/wrong-head artifacts, oversized streamed HTTP, invalid JSON content-type, redirect, forbidden response, invalid UTF-8 and incomplete pagination.

Git blob identities verified from the committed PR branch:

- `src/verified-actions.mjs` — `654af629ce6407740beaed1d0eb53316310d32ab`
- `tests/verified-actions.test.mjs` — `866121205cfa9aaa327578f9a0ceb7d5c3cbd302`
- `bin/audit.mjs` — `99b1b761ec0ad35859a05ced2b91e9da7ac3bab1`
- Inherited `src/run-audit.mjs` — `c7b78960a767b42e471056f436654ea7947dd5f4`

All four Git blobs match the locally executed source and dependencies. This establishes only locally executed Node host checks, **not** executed Oreslang compilers.

## Live GitHub metadata observation

Using the existing connected GitHub reader, fetched exact [PR #63 pinned workflow run #38996243957](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/38996243957), job `117289330521`: PR **63**, HEAD `b7a948b94b5068c16970354eda5ad53cd23a4831`, workflow ID `387278056`, **0 completed steps and 0 artifacts**. The new classifier evaluated the live API response as `NO_EXECUTED_TEST_EVIDENCE` with `backendParityCertified:false`.

This cannot establish whether runner billing, policy or permissions caused the pre-runner failure. The source PR's [default harness run #38996243996](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/38996243996) likewise reported zero steps. Both require owner-side Actions investigation; do **not** export the private source to unapproved alternate organizations.

## Operator usage

```sh
# Node >= 22, from the reviewed conformance checkout
node --test parity/integration/tests/verified-actions.test.mjs

# Existing approved read-only GitHub API credentials supplied via environment
node parity/integration/bin/audit.mjs \
  --run-id=38996243957 \
  --head=b7a948b94b5068c16970354eda5ad53cd23a4831 \
  --pr=63 \
  --output=/absolute/path/to/verified-actions-report.json
```

The file is new-only and mode 0600; never paste or store GitHub tokens in CLI arguments, artifacts or source code. The output SHA-256 is a **content checksum**, not a signature or independent runner attestation. If the run cannot be read, output is not created. A fully populated report still has `sourceCompilerExecuted:false`, `guestExecuted:false`, `hostConformanceCertified:false`, `backendParityCertified:false` and `releaseCertified:false`.

Keep this PR draft. Real Oreslang Java/LLVM/.NET/Forge/Wasm compiled guest runs remain a separate outstanding gate, as do approved runner allocation and integration of the six draft semantic-contract PRs.
