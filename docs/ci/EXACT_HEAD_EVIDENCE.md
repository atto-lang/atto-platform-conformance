# Exact-head GitHub Actions evidence — source-free metadata check

Run `node --test tests/verify-exact-head-evidence.test.mjs` and
`node tools/verify-exact-head-evidence.mjs evidence.json` (Node 22+).

This gate **never** authorizes private-source export and **never** certifies semantic parity.
It verifies only whether a source-head/tree-pinned **candidate** has a matching
workflow, attempt, uniquely selected job, assigned runner and the requested
successful executed step names. `RUNNER_ADMISSION_FAILURE` is not a compiler
verdict; `UNVERIFIED` must not be reported as passing. Successful metadata is
`EXECUTION_STEPS_RECORDED`, not `GUEST_PARITY_PASSED`.

Prepare a source-free JSON bundle with objects `expected`, `commit`, `run`, `jobs`
and, for `workflow_dispatch`, `checkout`:

- `expected`: repository, immutable `head_sha` and `tree_sha`, `run_id`,
  `attempt`, `job_name` and nonempty `required_steps` array.
- `commit`: raw authenticated GitHub commit response, including
  `.sha` and `.commit.tree.sha`.
- `run`: raw authenticated GitHub workflow-run response with `repository`,
  `head_sha`, `run_attempt`, `event`, `status` and `conclusion`.
- `jobs`: complete raw `.../actions/runs/{run_id}/jobs` response, including
  `total_count`, `jobs[].runner_id`, `jobs[].run_attempt`,
  `jobs[].run_id`, and `jobs[].steps[]`. Follow pagination and **fail closed** if
  not all jobs can be retrieved. Never fabricate missing fields.
- `checkout`: for manual `workflow_dispatch` (where `run.head_sha` normally
  references the workflow branch instead of the tested source), a job-generated
  exact-checkout receipt: repository, `head_sha`, `tree_sha`, `run_id`,
  `attempt`, `job_id`, `step_number`. Bind the receipt to a successful step.

Inputs are forensic records, **not inherently authenticated assertions**. A
bundle author could fabricate values. Independently cross-check original GitHub
URLs, evidence artifact digests, job logs, compiler identity, actual emitted
binary, guest execution output, and approval identity. Re-read the exact head
before release, preserve source/tree and run-attempt links, and separately
record admission-only, host-only, compiler-backed, and runtime evidence.
Do not use this script as a required green release/parity signal by itself.

For source repositories whose Actions fail with `runner_id=0` and `steps=[]`,
resolve runner admission, billing, permissions, or trusted runner provisioning
before claiming Java JUnit, LLVM CTest, Native Image or Oreslang guest verdicts.
Use approved same-organization source runners; do not export private source to
alternate organizations without independently approved, protected authorization.

## Untrusted input file admission (2026-10-30 follow-up)

The CLI now opens bundles through a single descriptor with `O_NOFOLLOW` and
`O_NONBLOCK`, requires a nonempty regular file, and bounds reads to 256 KiB,
including a post-open length check. On an unsupported host it fails closed.
This prevents a FIFO from hanging triage and bounds memory used for the input
file. Tests cover a regular bundle, empty file, oversized file, symlink, FIFO
and missing path. These changes do **not** authenticate bundle authors,
reconcile fabricated metadata, validate logs, or authorize private-source
transfer. The actual job/checkout receipts must still be independently
retrieved from GitHub.
