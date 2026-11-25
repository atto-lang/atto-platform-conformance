# AttoLang merge evidence: mixed jobs and ephemeral Git credential hardening

This isolated security follow-up is stacked on the unchanged draft conformance PR #535, itself based on draft #531. It touches only the existing canonical evidence module and the existing same-repo five-gate CI workflow, plus two new tests/docs files. It does not authorize a merge, change organization settings, mirror private source, or modify any independently owned component PR.

## Reproduced findings against exact parent source

1. The parent canonicalizer used `reported > 0` when summarizing CI jobs. Thus a single reported successful job concealed a second job with zero steps, a job with failed tests, a duplicate job identity, or a malformed/contradictory job. The output still said `BLOCKED` and `merge_authorized=false`, but its `ci.classification` was misleadingly `REPORTED_EXECUTION_UNATTESTED` instead of `MIXED_OR_INCOMPLETE`. A summary/UI that filtered by that class could overlook a missing required job.
2. The parent workflow used `actions/checkout` with `persist-credentials: true`. On a private repository checkout, that leaves the token needed for the later `git fetch` available in local Git configuration during execution of PR-head Node test code. This is unnecessary credential exposure. It does **not** prove a compromise or leakage.

## Source and workflow corrections

- Require **all** enumerated jobs to have positive runner evidence before assigning `REPORTED_EXECUTION_UNATTESTED`; if even one job is failed, missing, malformed, duplicated or contradictory, report `MIXED_OR_INCOMPLETE`. If every valid enumerated job has no runner and zero/null steps, retain `NOT_EXECUTED`. An empty inventory remains `UNOBSERVED`.
- Preserve `status: BLOCKED`, `merge_authorized: false`, `ci.execution_verified: false` and `guest_parity_certified: false`. A reported positive job is not an authentication certificate, full-required-check pass, or compiler guest test.
- Set checkout `persist-credentials: false`. Supply `${{ github.token }}` only as `FETCH_TOKEN` for the dedicated same-private-repository immutable-commit fetch step, then unset the shell variable. Construct a basic auth header in shell memory and use Git's ephemeral `GIT_CONFIG_COUNT/KEY_0/VALUE_0` environment, scoped only to each `git fetch` invocation. Never write the header to Git remote URLs or `.git/config`; inspect local HTTP extraheader configuration before and after.
- The separate Node 22 execution step checks the absence of local persisted Git HTTP credentials and `GITHUB_TOKEN` / `GH_TOKEN` process environment. It runs the existing **140** real-gate fixtures and **18** new mixed-job/credential-policy regressions, requiring `# tests 158`, `# pass 158`, and `# fail 0`. GitHub checkout and setup-node actions remain pinned by full commit IDs. Permissions remain `contents: read`; no PR-target elevated token or external source mirror.

## Evidence

The new `tests/merge-wave-mixed-jobs-v1.test.mjs` includes 13 concrete evidence-classification scenarios and 5 checkout/token/workflow-policy checks. Using exact parent GitHub blobs and a synchronous isolated-V8 Node-compatible test/assert harness, **12 of the 18 regressions fail** against the original parent. Against the modified exact candidate source/workflow, **18/18 pass**. The parent branch's separate 140-case real five-component suite was not modified. Prior 140/140 isolated-V8 results do not constitute a native Node execution of the amended 158-case combined suite.

**Limits:** Static workflow checks prove only the authored YAML, not GitHub's actual runner allocation, credentials lifecycle, workflow provenance or branch settings. PR-head-controlled workflows are not independent authorization controls; protected main and source-owned workflow integrity still need separate enforcement. The connected private GitHub Actions jobs have historically failed with `runner_id=null, steps=[]`. Until the source-owned Node 22 workflow executes at the exact candidate head and a genuinely independent reviewer approves it, keep the change DRAFT and unmerged. Private source stays within its owning GitHub repository; no cross-org mirror is approved.

## Next acceptance

After private Actions runner remediation and protected-main/CODEOWNERS enforcement, re-run the exact PR-head 158-case Node 22 suite with meaningful executed steps, verify the pinned full source tree/toolchain, and independently inspect runner job logs for absence of credential persistence. Run the compiler-backed `.atto` positive/negative conformance suites separately: these source-free host tests do not prove native guest parity.
