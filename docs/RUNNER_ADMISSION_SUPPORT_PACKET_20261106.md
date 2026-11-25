# P0: Source-runner admission support packet (read-only)

The nine private `ores-truffle-oreslang/oreslang-source.*` repositories currently have no verified protected `main`; sampled compiler/backend jobs failed before any runner executed steps. This is **not** a language/compiler test failure. The precise organization billing/policy/runner-eligibility cause is **unconfirmed**.

## Run from a trusted Node 22+ workstation

With a GitHub credential authorized to **read** the private repositories:

```sh
node --test tests/runner_admission_support_packet_20261106.test.mjs
node scripts/runner_admission_support_packet_20261106.mjs --live > runner-admission-support-packet.json
```

Provide `GITHUB_TOKEN` in the process environment via your normal credential mechanism; never paste a token into a ticket or repository. For a previously captured source-free REST snapshot, run `node scripts/runner_admission_support_packet_20261106.mjs --snapshot snapshot.json`.

The tool calls only 24 source-org GitHub **GET** endpoints: nine branch heads and, for five specific historical PRs, a PR object, Actions run and selected run-attempt jobs. It never clones code, copies Git blobs/trees, edits settings, changes checks, requests token scopes, or authorizes any merge or cross-org private-source transfer. Responses are limited to 2 MB and the output contains only sanitized identities/admission states, not raw REST responses. These are **sampled historical attempts**, not authoritative latest-head CI proof. Head drift, missing/duplicate jobs and unallocated runners fail closed. A current-head review, full required-check set, independent approval and branch-protection verification remain separate.

## Organization administrator recovery

1. Inspect `Settings → Billing and licensing → Actions`: plan/private-minute eligibility, spending limits, budgets, payment holds. Record GitHub's actual admission diagnostic; `runner_id=0` alone cannot establish exhausted minutes.
2. Inspect `Settings → Actions → General`: private repo Actions eligibility, allowed GitHub-hosted runners, runner groups, repository access, and failed-job UI banners/annotations.
3. Enable effective `main` protection across the nine private source repositories: strict issuer-bound required checks, independent CODEOWNERS review, stale-review dismissal, no bypass. This GitHub connector cannot write protected-branch administration; the private ruleset endpoint reported a plan restriction.
4. Retry a **source-free, no-checkout** canary in the same source organization. Verify positive assigned runner ID, nonempty meaningful steps and downloadable logs. Then rerun original source-local exact-final-head backend builds, native tests and AttoLang guest fixtures.
5. If account/runner settings are correct but allocation still fails, submit this sanitized packet and the exact run/job URLs to GitHub Support. An independently approved ephemeral self-hosted runner inside the original source-org trust boundary may be considered; **do not** mirror private source to another org without the separate security authorization.

Related coordination: platform-conformance issues #315 (CI admission), #69 (protected-main bootstrap), #359 (cross-agent leases). This helper is advisory and **always** reports `authorizedToMerge:false`, `authorizedToExportPrivateSource:false`, `certifiedAttoGuestExecution:false`.
