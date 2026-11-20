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
Both `run.head_sha` and the selected `job.head_sha` must be present as valid,
matching 40-character Git SHAs for **every** supported event. On
`workflow_dispatch`, these identify the workflow branch and **do not** replace
the separately required exact source/tree checkout receipt. A missing run/job
head is always `UNVERIFIED`, even if both missing fields compare equal.

- `checkout`: for manual `workflow_dispatch` (where `run.head_sha` normally
  references the workflow branch instead of the tested source), a job-generated
  exact-checkout receipt: repository, `head_sha`, `tree_sha`, `run_id`,
  `attempt`, `job_id`, `step_number`. Bind the receipt to a successful step.

An **explicit** `steps=[]` on the correctly bound job is the only zero-step
admission indicator. Missing `steps` metadata must remain `UNVERIFIED`;
a failed job with recorded steps must **never** be classified as runner
admission merely because its `runner_id` is absent or zero. The verifier
does not diagnose the actual failure from step metadata alone.

Malformed JSON is also hostile evidence: `jobs.jobs` must contain only
non-null job objects, and a selected job's `steps` must contain only non-null
step objects. The evaluator returns `UNVERIFIED` rather than throwing on
null, array, boolean or string entries. This is fail-closed validation, not
proof that an otherwise structurally valid bundle is authentic.

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

## Strict zero-step classification (2026-10-31)

Only a **failed completed workflow** containing exactly one selected **failed completed job** with
`runner_id: 0`, explicit `steps: []`, and matching repository/run ID/attempt/job head
is classified `RUNNER_ADMISSION_FAILURE`. The classification is a metadata
finding, not an independently established root cause (billing, policy, capacity,
or entitlement).

A missing/null runner ID, a positive runner ID with zero recorded steps,
missing/null steps, a successful workflow with zero steps, or contradictory job
status/conclusion is **`UNVERIFIED`**, not proven runner admission or compiler
success. The evaluator does not silently use positive execution status to fill
missing job records. Independent API/job-log verification is still required.

## Cancelled, skipped and other nonfailure run conclusions (2026-10-31)

An explicitly completed failed job with `runner_id: 0` and `steps: []` is **not**
sufficient if its enclosing workflow concluded `cancelled`, `timed_out`,
`skipped`, `neutral`, `action_required`, or has no conclusion. These outcomes
are `UNVERIFIED`, not `RUNNER_ADMISSION_FAILURE`.

Only a workflow whose status is `completed` **and conclusion is `failure`**
may produce `RUNNER_ADMISSION_FAILURE` when all the other exact source/run,
failed job, zero-runner and zero-step checks are met. The label is still a
classification of recorded metadata, not proof of a particular GitHub billing
or runner-availability root cause.

The additional regression makes 16 Node tests in the focused suite. Local
execution on exact Git-blob-matched files does not replace originating
GitHub-hosted Actions or platform/compiler/guest testing.
