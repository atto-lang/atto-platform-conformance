# Wave 10 — Tasks 46–50: diagnose no-run CI without false parity claims

**Draft follow-on to [PR #62](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/62).** This adds a real read-only GitHub Actions metadata collector that can be used **outside** GitHub Actions when the source organization cannot allocate runners. No production Oreslang source compiler, LLVM AOT guest, .NET NativeAOT guest, Forge compiler, or Wasm source backend is implemented in this PR.

| Task | Deliverable | Safety / proof limit |
| --- | --- | --- |
| **46 — classify unexecuted jobs** | `src/run-audit.mjs` treats jobs with zero *completed, non-skipped* steps as `NO_EXECUTED_TEST_EVIDENCE`, even when steps are listed as queued or skipped | A failed job before execution is not evidence about Node tests, compilation or backend parity |
| **47 — immutable run/job/attempt identity** | Require exact repository `ores-truffle-oreslang/oreslang-platform-conformance`, immutable 40-hex HEAD, specific run ID, attempt and PR/workflow-dispatch event; every job must bind to the same run/head/attempt; reject duplicates | Prevent stale/foreign run receipts being reused as proof for a newer PR |
| **48 — live GitHub REST metadata read** | `collectRun` uses GET-only `/actions/runs/{id}`, `/jobs?per_page=100`, `/artifacts?per_page=100` with 15-second per-request timeout, response-size cap, strict run metadata, count/pagination checks, and non-200 rejection | Does not bypass Actions-minute restrictions, nor prove the cause is billing rather than runner policy. Refuses pagination beyond 100 rather than accepting partial evidence |
| **49 — minimal forensic reports** | Strip raw job log lines/step names/tokens; report job IDs, step/completed counts, artifact metadata, exact run identity, and a SHA-256 checksum of canonical report content. Output uses new-file-only mode `0600` | SHA-256 is a content checksum, not a trusted GitHub or independent attestation; no secrets or raw logs copied into report |
| **50 — independent reviewer CLI** | `bin/audit.mjs` accepts only `--run-id`, `--head`, optional `--attempt`, and an absolute `--output`. Reads optional token only from `GITHUB_TOKEN` and gives **no exit-code-0 path** for metadata-only results | Reviewer can gather evidence when Actions itself cannot start. Token requires read-only access to the private source repository. No CI bridge/private tree mirror |

## Verified, current no-step evidence

[Machine-readable exact PR #62 snapshot](evidence/pr62-zero-steps-2026-10-16.json) records two observed GitHub API runs at head `92de646a31161763a8ee5475d64f55bd3454171f`:

- [Pinned six-wave host run #38994392059](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/38994392059), job `117283591225`: `failure`, **0 recorded steps**, **0 artifacts**.
- [Root conformance harness #38994391942](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/38994391942), job `117283590376`: `failure`, **0 recorded steps**, **0 artifacts**.
- Attempt 1 and the intended source HEAD verified by GitHub run/job metadata. Fetching job logs yielded `404 BlobNotFound`. That is consistent with no log archive; it does **not** independently explain runner billing/authorization.
- **Not proven:** no minutes, Actions permission policy, runner allocation error reason, Node test failure, compiler failure, or any completed compiler parity.

## Local verification and exact source identity

**13/13 real Node.js 22 tests passed** for the exact source files committed to this branch; these include request-bound classification, queued/skipped/failing-step checks, mocked GET-only pagination and partial-response negatives, token/log suppression, and actual CLI failure without private API credentials. The test suite does not execute production Oreslang.

```sh
node --test parity/integration/tests/run-audit.test.mjs
```

For a reviewer with approved **read-only** GitHub API access, from a trusted environment:

```sh
export GITHUB_TOKEN='<existing-read-only-GitHub-token>'
node parity/integration/bin/audit.mjs \
  --run-id=38994392059 \
  --head=92de646a31161763a8ee5475d64f55bd3454171f \
  --output=/absolute/path/to/actions-audit.json
```

Use an existing credential in the shell environment; **do not save the token in the repo, pass it in CLI arguments, or paste it in logs**. The collector never writes the token. Exit code `3` means no executed-test evidence, `4` means run not yet final, `5` means some completed steps were observed but **not certified**, and `2` means an invalid request/API/result/write error. All statuses intentionally fail closed. No API access on a private repo results in an error rather than guessed data.

This tooling can establish what metadata GitHub currently records, **not** why the organization lacks executable runners. Actual resolution of Actions limits or policies requires an appropriately authorized owner to inspect billing and Actions settings; neither the user nor the connector has approved those changes here. Do not export private source to unapproved other organizations merely to obtain minutes.

## Next production integration

Review stack #59 → #61 → #62 → this PR and execute the complete six-wave Node suite on an **approved** runner with actual job steps and artifacts. Then run the actual Oreslang source compiler/guest tests for Java, LLVM, .NET, Forge and Wasm under exact source/tree/ABI provenance. Those claims are not supplied by this task and all six original wave PRs remain unmerged.

**Draft/unmerged. CI metadata-only observations must never turn `releaseCertified`, `backendParityCertified`, or `compilerExecuted` true.**
