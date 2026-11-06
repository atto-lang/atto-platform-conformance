# Source-organization runner admission — fail-closed evidence classification v1

This is a read-only **host runner** triage helper, not a compiler test, branch-protection verifier, review approval, protected-main check, or release/merge certificate. It never grants merge/release permission. Its exit mapping deliberately has no zero. Never install it as a positive required release check.

## Problem and existing canary

Private source-org Actions often return workflow conclusion failure with jobs whose steps are empty; that means **NOT_EXECUTED**, not failed tests. Public GitHub Actions can return completed substantive successful steps with runner_id absent in some API responses; do not misclassify these as zero-step jobs.

The existing workflow at .github/workflows/source-local-runner-allocation-canary.yml is metadata-only and must remain free from source checkout, credentials, Git blobs, caches and cross-organization source transfers. It already uses source-local permissions {} and GitHub-hosted ubuntu-24.04 in main.

## Evidence contract

The pure Node module tools/runner-admission-evidence-v1.mjs exports classifyRunnerAdmission({run,jobs,expected}) and runnerAdmissionExitCode(record). expected must be independently pinned with a repository owner/name, 40-character lower-case Git commit SHA, positive run ID and attempt number. Fetch run metadata and *all* jobs and steps through authenticated GitHub REST GET. Bind all job and step evidence to the same exact attempt and repository. The input snapshot is untrusted until independently authenticated by a live collector; the classifier alone does not prove it was fetched from GitHub.

Classification meanings:

- NOT_EXECUTED: every job has zero executed steps, even if the workflow has failure conclusion. Not a code failure.
- IN_PROGRESS: the run or some jobs are unfinished. Never treat as pass.
- BLOCKED: corrupt, stale, contradictory, incomplete, skipped, failed or mixed evidence.
- EXECUTED_RUNNER_UNATTESTED: completed substantive successful steps, but runner ID/name is missing in the API. This is not a zero-step failure, but does not prove runner identity.
- RUNNER_EXECUTION_OBSERVED: complete successful stepful jobs and bound runner identities. Still only a source-free runner observation.
- INVALID_INPUT: mandatory input or pins malformed.

runnerAdmissionExitCode returns 3 for RUNNER_EXECUTION_OBSERVED, 2 for INVALID_INPUT, and 1 for all other statuses. It **never returns 0**, precisely so an arbitrary shell using && cannot promote a synthetic source-free canary into release qualification.

## Administrator-only recovery

1. Inspect source-organization GitHub Actions eligibility, billing/spending limits, allowed hosted runners and runner groups. Read the exact job UI failure annotation. Zero steps alone do not identify the cause. Never publish financial data or credentials.
2. Run the approved **source-owned metadata-only canary** on the latest workflow source, not a historic workflow attempt. Verify a real assigned runner (if identity is supplied), completed substantive steps, safe log markers and receipt provenance. Compare the run head and attempt with live GET.
3. Only after a genuinely stepful source-org canary, re-execute exact source-head Java, LLVM, Wasm, Forge and .NET build/guest/sanitizer/AOT tests and require exact guest-output receipts.
4. Configure branch protections with administrator authority: PR required, independent CODEOWNER approval, stale-review dismissal, no force pushes or bypasses, enforced administrator policy where supported, trusted exact-head CI checks, and read back the effective rulesets. Do not require private CI contexts while runners cannot execute, or merges may deadlock.
5. Review the release blockers: Conformance issue #315 (runner admission), #170 (platform branch protection), #19 (retrospective audit) and organization .github issue #2 (administrator follow-through).

**No cross-organization private source export** is authorized by a successful public or alternate-org source-free canary. Before any source transfer, explicitly approve exact destination repo ID, private-source SHA/tree, immutable workflow, retention and all outstanding security incidents (#22/#77).

## Test without network or secrets

Run: node --test tests/runner-admission-evidence-v1.test.mjs

These 13 synthetic Node regression tests exercise the classifier only, not actual remote execution, private runner admission, native compiler guests or GitHub policy state.
