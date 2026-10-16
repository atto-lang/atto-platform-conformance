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

## Verified PRIVATE alternative runner — Voxletra

**Capacity milestone achieved for one different organization, not for source
CI or source-copy authorization.**

- Destination `voxletra/voxletra-e2e`: GitHub numeric repo ID
  `1311678027`, `visibility=private`, authenticated metadata confirms
  repository is not archived and push access is available.
- Created an isolated, source-free
  [capacity workflow](https://github.com/voxletra/voxletra-e2e/blob/ci/private-runner-capacity-20261016/.github/workflows/oreslang-source-free-capacity.yml)
  on branch `ci/private-runner-capacity-20261016`. Workflow has
  `permissions: {}`, no checkout/download/secrets, one Bash command, and no
  artifact upload. Source compiler/actor code was NOT transferred.
- [GitHub Actions run #38940228917](https://github.com/voxletra/voxletra-e2e/actions/runs/38940228917):
  event `push`, workflow path
  `.github/workflows/oreslang-source-free-capacity.yml`, exact commit
  `b9d18dced1ed5848a9fcf2441e65a44abc3ef199`, completed
  **success**. The single job `capacity`, ID `117105691508`, completed
  successfully on runner ID `1000002089` with actual successful
  `Prove runner allocation and shell execution` step; GitHub also recorded
  normal setup and completion steps. Full run and job metadata were read from
  the GitHub Actions API.
- This satisfies **one** immediate private-carrier runner-capacity probe.
  It does not reveal remaining minutes or grant permission to export source;
  re-run a fresh source-free probe if this evidence becomes stale.

**What remains before using this candidate for cross-org source tests:**
independent source/destination repository-ID authorization, trusted/protected
policy origin, approved exact source commit and complete tree, reviewed
destination base commit/tree/workflow and permissions, incident #22
containment, and clean real compiler tests. The source repo's own hosted
Actions remain unable to start; administrator review is still required if
source-local CI must run. Do not copy private Oreslang Git objects into Voxletra
based only on this capacity milestone.

## Hosted synthetic Git-tree proof on the same PRIVATE carrier

A second source-free workflow on the isolated Voxletra branch passed:

- [Run #38940949779](https://github.com/voxletra/voxletra-e2e/actions/runs/38940949779)
  from commit `a4345481e50144535482a85ec6818b67cb7c7648`,
  workflow `.github/workflows/oreslang-synthetic-tree-proof.yml`.
  Job `synthetic-exact-tree` executed on runner ID `1000002102`.
- Actual GitHub job logs contain **all four required markers**:
  `EXACT_TREE_MATCH=yes`, `EXECUTABLE_MODE_MATCH=yes`,
  `TAMPERING_DETECTED=yes` and `REAL_NATIVE_CLANG_EXECUTION=yes`.
- The fully synthetic Git tree retained path/mode identity under a nested
  prefix, and adding a new file changed the tree hash. Node `v22.23.3`
  and Clang `18.1.3` were confirmed. The host compiled and executed a
  standalone C guest that returned exit code 42.
- This run used locally generated synthetic input only: **no Oreslang
  source, no source checkout, no cross-org credentials, no GitHub mirror
  operation**. It proves Git tree mechanics and native toolchain ability,
  not the security of a future source export or Oreslang runtime behavior.

The draft mirror publisher's offline mocked-GitHub suite is now **41/41
passing**. It additionally requires the simple source-free probe's *exact*
managed step sequence (setup, approved shell step, completion), preventing
a supposedly successful capacity job from hiding extra executable steps.
Its reviewed policy and the source-exposure incident remain unresolved.
JDK 25/GraalVM **has not been verified** on this carrier.

## Adversarial source-free path/mode test on the approved-capacity candidate

New independent synthetic-only Actions
[run #38948996757](https://github.com/voxletra/voxletra-e2e/actions/runs/38948996757)
executed successfully on private `voxletra/voxletra-e2e`, runner ID
`1000002294`, exact branch commit
`fcc901296d49a96541feef1ac3f693b7f9893e72`. Workflow:
`.github/workflows/oreslang-synthetic-path-preflight.yml`. No Oreslang
source checkout, secrets or cross-org transfer was performed.

Actual job logs confirm four markers:

- `GIT_SYMLINK_MODE_OBSERVED=yes` — locally generated Git link uses
  `120000 blob`, which the new publisher source preflight rejects
- `GIT_CASE_COLLISION_OBSERVED=yes` — the actual Linux Git tree may
  contain both `src/Main.ores` and `src/main.ores`
- `SYNTHETIC_SOURCE_TREE_PREFLIGHT=yes` — independent synthetic
  adversarial directory, symlink, case-alias and OID/mode tests passed
- `WORKFLOW_TARGET_PREFIX_DENIED=yes` — synthetic code rejects
  destination prefixes containing `.github` components

Read-only GitHub Git-tree inspection of the exact carrier commit independently
confirmed real directory entries use Git mode `040000`. The actual publisher
source code's updated mocked-GitHub suite passed **46/46** tests, including
malformed source directories and valid nested Git tree cases. This synthetic
hosted test is **not** live execution of the private publisher, actual
cross-org source transfer, or full Oreslang compiler/backend CI.

## Read-only Java source-tree eligibility preflight (no export)

Fetched **only metadata and Git tree inventories** via the authenticated GitHub
integration, then applied the draft publisher's entry/path/mode, case-alias
and file-count/size checks in read-only code. No source blob content was
downloaded for publication; no cross-organization writes occurred.

| Java PR and exact checked head | Git source tree | Entries / blobs | Blob bytes | Result |
| --- | --- | --- | --- | --- |
| [imports #1050](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1050) `613878a0a7fca6e2afa6fd14f16d0b282eefd176` | `cac866037d135ae61ab8acd450374ae0137b40f8` | 685 / 613 | 6,251,897 | preflight accepted |
| [Sendable #1060](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1060) `b25a5b7921b1fafb9574d29ffc62574f2a80e791` | `ef2d0580569554a52badf2ea0da7ac6c19e2c7a2` | 689 / 616 | 6,183,753 | preflight accepted |
| [DOP #1066](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1066) `ee9c4abc0fb62916c9f4cbff5175de7bf02235f1` | `86d76b1822f64b73a14bafca5e4c0ddf05172cfc` | 687 / 615 | 6,168,334 | preflight accepted |

For each checked exact commit, GitHub returned `truncated=false`, no Git
tree mode/path/identity/case-collision violations, and no individual blob
exceeded 1 MiB. All fall under the publisher limits (750 blobs, 3,000
entries, 40 MiB total). They are **not** approved for export, and a newer
head requires a fresh exact-head preflight. This metadata is also not
evidence of successful compilation or runtime conformance.

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
probe. The publisher now also fails closed **before the first source Git read**
unless GitHub confirms a completed successful probe from the **same numeric
private repository ID**, approved exact workflow path and exact probe commit,
with a nonempty real runner name and a successful named shell step.
Only a reviewed `push` or `workflow_dispatch` event is eligible; pull-request
and scheduled jobs do not qualify. The capacity run must be at most 24 hours
old. This proves only a small real runner allocation, not remaining minute
balance or eligibility for a full source build.

Even with a successful runner probe, the publisher now requires an independently
reviewed **destination base commit SHA and destination base Git-tree SHA**,
and verifies both, plus an empty snapshot prefix, before retrieving the first
private source commit/tree. A caller-selected unreviewed destination baseline
could otherwise introduce a malicious workflow that executes after branch
publication. This does not replace independent verification that the reviewed
destination baseline and workflow are benign or that the source export has
code-owner/security approval. Use least privilege, an isolated temporary ref and exact nested Git
tree SHA verification. A private destination **alone is not authorization**.

The draft [private mirror hardening PR #43](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/43)
contains offline mocked-API tests. Those tests are not hosted CI or transfer
provenance. The connected integration could not read main branch protection
(403) and the repository rulesets endpoint returned a plan-related 403;
neither property can be asserted as verified.

## Capacity-probe parser hardening (2026-10-16)

Review of the actual successful Actions job payload from a **public** test
repository established that GitHub automatically adds `Set up job` and
`Complete job` steps. The earlier draft mirror publisher incorrectly
required `steps.length === 1`, which would have rejected even a genuine
successful private runner. The publisher now permits GitHub-managed
setup/completion steps while requiring **exactly one** named
`Prove runner allocation and shell execution` step with
`status=completed` and `conclusion=success`.

Admission also requires a positive numeric `runner_id`, a nonempty
`runner_name`, exact `job.run_id` equality, completed job success, and
reviewed private destination run metadata. No CI/source-exposure evidence is
inferred from a successful **public** job; that example was used only to
confirm GitHub's REST response shape. The offline mocked-API test harness
now includes the managed setup/complete steps and rejects missing runner IDs,
duplicate named steps, mismatched run IDs and incomplete execution.

## Definition of a usable release gate

- A source-free runner executes an actual step with visible logs.
- Private-source transport (if any) has independent authorization and exact
  source tree evidence; public repositories are never used as carriers.
- Full compiler and runtime CI executes against the same pinned PR SHA with
  step logs and artifacts. An unconfigured/skipped backend is not parity.
- Required reviews/checks pass before draft status is removed or merge.
