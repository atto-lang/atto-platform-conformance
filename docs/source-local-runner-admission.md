# Source-local runner admission: fail-closed acceptance

This is an infrastructure diagnostic, not a compiler/runtime guest test. Its workflow does not checkout private source, publish artifacts, grant token permissions, or authorize private Git-tree export.

1. Read the source-local run metadata and the **same attempt** job receipt using an account with permission to view this repository. Never paste or log an access token:

   ```sh
   REPO=ores-truffle-oreslang/oreslang-platform-conformance
   RUN_ID=REPLACE_WITH_INTEGER
   ATTEMPT=REPLACE_WITH_INTEGER
   EXACT_SHA=REPLACE_WITH_40_HEX_SHA
   BRANCH=ci/source-local-runner-admission-20261028
   gh api "repos/$REPO/actions/runs/$RUN_ID" > run.json
   gh api "repos/$REPO/actions/runs/$RUN_ID/attempts/$ATTEMPT/jobs?per_page=100" > jobs.json
   node scripts/verify-runner-admission.mjs run.json jobs.json "$REPO" "$EXACT_SHA" "$BRANCH"
   ```

2. Require a successful receipt with matching repository, branch, exact SHA, run ID, attempt, workflow path, one named canary job, positive `runner_id`, nonempty `runner_name`, and a completed successful named non-housekeeping step. Missing fields, truncated response, queued execution, or zero-step jobs **fail closed**. The verifier intentionally prints `backendGuestExecution: false`.
3. Run negative/positive tests locally with `node --test tests/verify-runner-admission.test.mjs`. Local synthetic tests are not GitHub runner execution.
4. If the check fails before allocation, inspect the run/job annotations in the GitHub UI, **organization** Actions billing/budgets and payment state, Actions allowed/disabled policies, runner group eligibility, and any enabled repository/organization caps. A zero-step failure does not identify one of these as the cause.
5. If hosted runners cannot be restored, use an independently reviewed **ephemeral self-hosted runner registered to the original source org** with explicit job routing and isolated credentials. Do not mirror private source to an alternate org merely because it has Actions minutes.

Never treat a check being created, a job reporting `failure`, a successful source-free carrier canary, or a success from only setup/teardown steps as proof of compilation, guest execution, Native AOT, or cross-backend parity. Keep the draft PR unmerged until security review and the source-org infrastructure gate are satisfied.
