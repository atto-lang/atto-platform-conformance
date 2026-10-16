# Private Oreslang CI runner recovery — 16 October 2026

This is an **execution blocker runbook**, not permission to move private
compiler/actor source. It distinguishes GitHub Actions runner admission from
compiler test results and from private-source export authorization.

## Reproduced source-free failure

New [`.github/workflows/runner-capacity-probe.yml`](../.github/workflows/runner-capacity-probe.yml)
contains one `bash` step, uses `permissions: {}`, a 2-minute timeout, and
does **not** checkout source, install actions, access tokens or produce
artifacts. Both triggered events failed without executing that step:

| GitHub Actions run | Event | Observed status |
| --- | --- | --- |
| [38930087848](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/38930087848) | pull_request | failure, 0 job steps |
| [38930078131](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/38930078131) | push | failure, 0 job steps |

The earlier normal harness workflow has the same zero-step symptom. **No
compiler assertion has run** when the job shows zero steps. It is unsound to
call the compiler broken or green from these outcomes.

Read-only capacity probes in other already-private carriers also failed
with zero recorded steps:

- [akrion-sim/akrion-sim-e2e #38927627366](https://github.com/akrion-sim/akrion-sim-e2e/actions/runs/38927627366)
- [athlet-o/athleto-e2e #38928471838](https://github.com/athlet-o/athleto-e2e/actions/runs/38928471838)
- [scintilla-run/scintilla-run-infra #38927864632](https://github.com/scintilla-run/scintilla-run-infra/actions/runs/38927864632)

This does **not** establish that any organization's Actions *minutes* are
exhausted. No authoritative billing/runner-policy diagnostic is available
from these run summaries alone.

## Administrator-only diagnosis, in order

1. Inspect one source-free run and its job/check-run **annotations** in the
   GitHub Actions UI. Record the exact startup failure and whether a hosted
   runner was ever assigned. Run logs can be absent when provisioning fails.
2. Check organization and account Actions usage, spending limit, outstanding
   billing issues, eligible hosted-runner allowance and any pending
   restrictions. Record the **actual** blocker, not an inference from failure.
3. Check repository/organization Actions policies, workflow allowance,
   runner group access, and repository permissions. Do not disable required
   branch protection to make tests appear green.
4. After remediation, rerun the **source-free** probe at the exact commit.
   Require at least one step with `RUNNER_EXECUTED=yes` in visible logs and a
   successful run conclusion.
5. Prefer a clean **ephemeral self-hosted runner within the private source
   organization** if hosted capacity is not recoverable. Restrict untrusted PRs,
   secrets/network, and runner registration; wipe runner between jobs.
   Approval and setup must be performed by an authorized administrator.
6. Only then run pinned full-source JDK 25/GraalVM `mvn -B -ntp verify`,
   LLVM `cmake --build && ctest --output-on-failure`, and the required
   sanitizer/native-runtime suites. Preserve logs, exact head and toolchain
   provenance. Failed real test steps then become actionable compiler bugs.

## If cross-organization CI is necessary

No source export is presently authorized. Keep
[the P0 public carrier exposure incident](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22)
open, and resolve [protected policy/source provenance issue](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/962).
Before any copy require independent security review of a **private** numeric
destination repo ID, an independently pinned source repo ID + exact source
commit/tree, protected reviewed policy origin, explicit export scope, and
destination Actions capacity demonstrated by an executed **source-free**
probe. Use least privilege, an isolated temporary ref and exact nested Git
tree SHA verification. A private destination **alone is not authorization**.

The draft [private mirror hardening PR #43](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/43)
contains offline mocked-API tests. Those tests are not hosted CI or transfer
provenance. The connected integration could not read main branch protection
(403) and the repository rulesets endpoint returned a plan-related 403;
neither property can be asserted as verified.

## Definition of a usable release gate

- A source-free runner executes an actual step with visible logs.
- Private-source transport (if any) has independent authorization and exact
  source tree evidence; public repositories are never used as carriers.
- Full compiler and runtime CI executes against the same pinned PR SHA with
  step logs and artifacts. An unconfigured/skipped backend is not parity.
- Required reviews/checks pass before draft status is removed or merge.
