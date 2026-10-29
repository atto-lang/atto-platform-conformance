# P0 source-org runner and protected-main recovery — 2026-10-29 UTC

## Scope and rule

Five private compiler repositories: `oreslang-source.java`, `oreslang-source.llvm`, `oreslang-source.net`, `oreslang-source.wasm`, and `oreslang-source.forge`, all under `ores-truffle-oreslang`.

**Do not mirror private Oreslang Git objects or source bytes to a different organization** merely because a funded runner exists there. Token-free transfer is still a confidentiality-relevant export. Leave all approved destination/source-snapshot lists empty pending a separately approved, exact destination-repository-ID + source-commit + source-root-tree admission review. These instructions are read-only until an authorized administrator applies protected-main and runner settings.

## Verified GitHub state — recheck before acting

| Backend | main protected | Original policy PR | PR disposition | Policy on current main |
| --- | --- | --- | --- | --- |
| Java | **false** | #1217 | closed, **not merged** on Oct 21 | legacy private mirror preflight, no matching canonical `private-ci-policy.yml` discovered |
| LLVM | **false** | #529 | open, draft | private CI governance, no canonical `private-ci-policy.yml` discovered |
| .NET | **false** | #79 | merged Oct 25 | `private-ci-policy.yml` |
| Wasm | **false** | #76 | merged Oct 22 | `private-ci-policy.yml` |
| Forge | **false** | #77 | merged Oct 25 | `private-ci-policy.yml` |

**Current follow-on security PR review anchors:** Java [#2187](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2187) consolidates private-CI gates, [#2188](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2188) proposes a source-local exact-main runner, and [#2237](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2237) adds protected-carrier reattestation; all are still draft. LLVM [#1146](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1146) is a draft default-deny export gate and [#1148](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1148) proposes a hard block for new open [conformance incident #212](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/212). These do **not** replace completed independent source-org protected-main and runner checks. Do not resurrect the closed-unmerged Java #1217 as a current review anchor.

All five current `.github/private-ci-approved-repositories.txt` files contain **zero active entries**. .NET/Wasm/Forge current `.github/private-ci-approved-source-snapshots.txt` files likewise have **zero active entries**. Their current `.github/private-ci-required-checks.json` manifests each specify `private-ci-policy` from GitHub Actions App **15368**. This manifest text is **not** equivalent to active repository branch protection. The source GitHub connector cannot read protection settings beyond `protected:false` or change admin controls (403).

**Active incident restriction:** Conformance [#212](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/212) reports exact LLVM source-tree placement in an unapproved carrier repository. The open incident and pre-existing #22/#77/#127 security gates block additional private-source transfers; do not interpret a successful carrier compiler run as retroactive export approval. Preserve evidence and obtain independent security-owner disposition before any new carrier authorization.

### Operator read-only evidence commands

Never print a token, authentication header, or private source in an issue or CI log. With an administrator-authenticated `gh` CLI:

```sh
ORG=ores-truffle-oreslang
for backend in java llvm net wasm forge; do
  REPO="$ORG/oreslang-source.$backend"
  gh api "repos/$REPO/branches/main" --jq '{name,protected,sha:.commit.sha}'
  gh api "repos/$REPO/branches/main/protection" --jq '{required_pull_request_reviews,required_status_checks,enforce_admins,restrictions}' || true
  gh api "repos/$REPO/rulesets" --jq '.[] | {name,enforcement,conditions,rules}' || true
done
```

A failed protection read must be recorded as **unverified**, not interpreted as protected. The `|| true` is for the diagnostic loop only; do not use it as an acceptance check.

## P0-A — Diagnose failed runner admission before more expensive reruns

The source-local no-checkout canary at [conformance run #40813412041](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/40813412041), exact SHA `f4e237dcf764b231e6f1a5471c4974af91344f18`, failed in job `runner-admission` with `runner_id=0`, empty `runner_name`, zero steps. **Cause not established.** An administrator must inspect:

- Run/job/check annotations in the GitHub UI and the organization Actions service status.
- Organization **Billing and licensing**: payment health, spending limit, budget and minute eligibility, and whether the chosen runner type is permitted.
- Organization and repository **Settings → Actions**: whether workflows are allowed and runner groups/labels can schedule jobs.
- Runner group availability and, if relevant, actual hosted-runner provisioning restrictions.

Record the precise provider-side error text and timestamp. Do not label all zero-step failures “out of minutes” without this evidence.

## P0-B — Protect five source main branches before advancing private CI authorization

Require a PR, **at least one genuinely independent approval**, CODEOWNERS, dismiss stale approvals after changes, conversation resolution, strict required checks, and protection applying to admins with **no bypass actor**. Pin `private-ci-policy` to GitHub Actions App ID **15368** where that check exists and is the proper issuer. The same requirement **cannot** be asserted for Java/LLVM until a canonical policy workflow is independently reviewed and landed; avoid inventing a check that no workflow publishes. Verify all required contexts and their issuer identities against live settings rather than trusting only the manifest.

Keep approved private destinations and source snapshots empty. Independent reviewer approval must not be substituted with an operator-controlled identity.

For each backend, require an administrator-read live protection audit and independently recorded reviewer identity. **Do not claim bootstrap completion while `main.protected=false`.**

## P0-C — Restore authorized execution

Prefer restoring GitHub-hosted scheduling inside the original `ores-truffle-oreslang` organization. Run only the source-local **no-checkout** admission workflow until its GitHub Jobs API proves:
`runner_id>0`, nonempty `runner_name`, exact run ID, exact attempt, exact SHA and branch, and the completed named non-housekeeping step. Validate through `scripts/verify-runner-admission.mjs` and `docs/source-local-runner-admission.md` in conformance PR #203.

If no hosted runner is available, an administrator may approve a **one-shot ephemeral self-hosted runner registered to the original source organization**, restricted to the exact source repository by a dedicated runner group and unique labels, with isolated credentials, no persistent shared workspace, no untrusted PR code, and no cross-org source export. Confirm the isolated runner's labels/registration and trusted workflow before allowing checkout. Decommission and wipe after the job.

A funded alternative org `honeypot-r-us-test/hnpt-e2e` independently executed [source-free canary #40813221181](https://github.com/honeypot-r-us-test/hnpt-e2e/actions/runs/40813221181), exact SHA `a92e0976971e723b90a0c0c5b79823dd8d6afa29`, with runner ID `1000001341`, three meaningful steps including 12 synthetic checks. **This proves capacity for synthetic tests only; it is not private compiler parity evidence or permission to mirror source.**

## P1 — Follow-on compiler execution acceptance

After protections and runner admission, execute Java and LLVM exact-head, genuine `.ores` guest fixtures first; then .NET Native AOT, Wasm guest, and Forge native execution. For each run preserve backend, branch, exact commit and root-tree SHA, workflow/run URL, job/attempt/runner identity, meaningful step names and conclusions, toolchain versions, immutable artifacts, and sample input/output or guest exit code. Contract/lint/setup is **not** guest execution. Reject missing or truncated evidence. Do not infer parity from a successful unrelated source-free test.

## Review requirements

Conformance [PR #203](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/203) and alternative synthetic [PR #14](https://github.com/honeypot-r-us-test/hnpt-e2e/pull/14) remain **draft**. No independent source authorization or production merge is implied by this runbook.


## P0-D — Extract the provider's actual failed-job annotations (requires Checks read)

The GitHub Actions app (ID 15368) published **two check annotations** for the source-local runner-admission job on exact SHA `7d9620f2cd64c5b128ff267086ba9d4830114f1f`. The linked GitHub App integration can see the annotations count but is denied access to their messages. An administrator with an appropriately authorized `gh` login can retrieve these **without any new workflow run or source checkout**:

```sh
# From the reviewed conformance PR #203 working tree. No token in argv or output.
node scripts/collect-source-runner-failure.mjs \
  40815105000 1 7d9620f2cd64c5b128ff267086ba9d4830114f1f \
  ci/source-local-runner-admission-20261028
```

The collector only reads the exact run, its exact-attempt job page, and the corresponding GitHub check-run annotations from the *same source repository*. It validates run ID, attempt, repository, SHA, branch, workflow path and unique job identity, redacts common token patterns, and returns a diagnostic receipt with `sourceExportAuthorized:false` and `guestExecutionProven:false`. Exit **1** means a correctly identified zero-runner job; exit **2** means the read/identity gate failed; exit **0** means the job was not a preallocation failure, **not** that its compiler/runtime or security gates passed. Review provider annotation text for sensitive content before sharing it in an issue.

The exact commit-pinned Node test suite is `node --test tests/collect-source-runner-failure.test.mjs` and contains 28 source-free positive/negative cases. The triage script is deliberately not an export driver or branch-protection writer.

**Additional reconciliation:** conformance's independent draft bootstrap auditor in PR #57 still pins policy workflow blobs that are not equal to the current `.NET/Wasm/Forge` `main` policy workflow blob `fa03fc77b5e253a8b51c875f72359b18f82f1cf7` (its draft auditor pins `1e18ea42fc8a819e26a90f9b2dfea7cbdc129e76`). Java and LLVM do not yet have that exact canonical policy path on current `main`. These are **hard bootstrap review/pinning discrepancies**, not a reason to automatically accept a new blob or weaken the pinned policy. Reconcile workflow versions and re-review source identities, ownership, and exact security checks before trying to pass the bootstrap auditor; never silently repin security-sensitive workflow identities.
