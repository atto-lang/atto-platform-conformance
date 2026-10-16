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

## Destination ref-occupancy security preflight (2026-10-16)

The publisher now checks that its exact `ci/private-*` destination Git ref is
absent **before any private source Git object is read**, and checks once more
immediately before creating the ref. Only GitHub's 404 response counts as
absence; 200 (occupied), 401/403 (access denied), 429 (rate limited), redirects
and unexpected errors fail closed. Final POST-to-create remains atomic; these
preflight reads do not eliminate races but avoid copying confidential blobs
when an already-occupied destination ref is known in advance.

- Real GitHub API read-only check: pre-existing synthetic
  `ci/private-synthetic-mirror-e2e-20261016-040a8e7f` returned an exact ref,
  while nonexistent `ci/private-absent-proof-20261016-00000000` returned 404.
  No source blobs were accessed or copied by either check.
- Independently generated synthetic-only
  [private runner #38953397978](https://github.com/voxletra/voxletra-e2e/actions/runs/38953397978)
  **passed** on hosted runner `1000002328`, exact workflow commit
  `ea182f6a7a51779c38ae86879d076579f3ff09c9`.
  Real job logs verify `EXISTING_REF_DETECTED=yes`,
  `ATOMIC_OCCUPIED_REF_REJECTED=yes`,
  `ATOMIC_NEW_REF_CREATED=yes`,
  `RACING_SECOND_CREATE_REJECTED=yes` and
  `FAIL_CLOSED_REF_STATUS_MATRIX=yes`.
  This was local Git/Node test logic with generated synthetic data, not the
  private publisher itself or a private Oreslang source transfer.
- Exact source-level mocked-GitHub publisher/visibility suite now
  **51/51 passing**. It includes pre-existing ref, indeterminate API
  response, and late-claimed ref cases and asserts that early rejections
  prevent all source Git reads/destination writes.
- This does not establish protected source-export authorization or actual
  Java/GraalVM/LLVM/.NET/Wasm/Forge compiler correctness. Public exposure
  incident #22 and independently approved policy issue #962 remain blocking.

## Source-blob two-phase validation and hosted synthetic proof (2026-10-16)

Another audit identified a partial-transfer hazard: copying each source Git blob
immediately after its validation can strand earlier confidential Git objects
in the destination if a *later* source blob is corrupt or missing. Those
objects are unreferenced but are not directly deletable through normal GitHub
Git APIs.

The publisher was changed to **two phases**: first read and validate the
*complete* pinned set of source Git blob objects in bounded process memory,
then reauthorize the destination's numeric identity, visibility and push
permission before each mutation and copy the verified contents. Negative tests
prove a bad second blob prevents *all* destination POSTs. A positive two-blob
mock verifies all source blob GETs precede the first destination blob POST.
The exact checked code and test blobs at that stage were
`8bfaee1a7d9cde0438dee4660739a0834d331343` and
`b742487ad814aced15dd8c4d3f25a621de510070`, with **53/53**
isolated mocked-API publisher/visibility tests passing. Additional
cryptographic source-byte validation has subsequently been added to the
active PR branch; the 53/53 result must not be misrepresented as native
CI against later code revisions.

A separate source-free synthetic two-phase validation workflow was executed
on the working PRIVATE `voxletra/voxletra-e2e` GitHub Actions runner:
- [Initial run #38954025321](https://github.com/voxletra/voxletra-e2e/actions/runs/38954025321):
  **failed**, because the independent synthetic test validator omitted
  comparing the source-declared size. Failure was investigated from real logs.
- [Corrected run #38954097648](https://github.com/voxletra/voxletra-e2e/actions/runs/38954097648):
  **passed** at exact commit
  `8c2ffca134c977f7c61aef5bbf41e8099153b80b`, GitHub runner ID
  `1000002333`. The actual job log includes
  `LATE_SOURCE_FAILURE_NO_DESTINATION_WRITES=yes`,
  `TWO_PHASE_SYNTHETIC_COPY_SUCCESS=yes` and
  `MALFORMED_SECOND_BLOB_CASES=3`.

This hosted proof contains **only locally generated synthetic data** and is
not an execution of `bin/private-mirror-publish.mjs` or a mirror of the
private Oreslang actor branch. Never infer protected-policy approval,
compiler parity, or permission to export source from this test.
Public-exposure incident #22 and export authorization #962 remain open.

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


## Real synthetic cross-organization Git object publication

Completed a **synthetic-only** source→destination Git API transaction, with
no private Oreslang compiler/actor source. This verifies the end-to-end
mechanism but is not code-owner authorization to mirror confidential source.

- Synthetic source objects created in private `akrion-sim/akrion-sim-e2e`,
  repository ID `1321164328`. The source tree with two newly generated
  nonconfidential files was `2a66115f267eecae4645d4b01287da14a31e0351`.
  Synthetic blobs: `main.ores`
  `9f6430031fc79b48ac5089c1f28f57e7df93805c` (`100644`) and
  `bin/run.sh` `0be165a59c3275263e819e61a3fb7ebfbaf7c1d7`
  (`100755`). Both destination blob SHA checks matched.
- Target verified private `voxletra/voxletra-e2e` (ID `1311678027`).
  Pinned source-free test base commit
  `fcc901296d49a96541feef1ac3f693b7f9893e72`, tree
  `1ae3107532a2b7efe40670172f4ec97da7b60b63`.
  Target prefix `snapshots/generated-cross-org-test-20261016`
  was initially empty.
- Git tree API constructed target tree
  `8713cef54b9e6993f39c02b522805fd87e2a974a`;
  a separate read-back confirmed **exact nested source tree SHA equality**
  `2a66115f267eecae4645d4b01287da14a31e0351` and both file
  modes/identities.
- Source-free synthetic commit
  `44a0d9e445511932e0b1e2c9e338c6bcfb4761d7`
  points at exactly that target tree and the pinned base parent.
  GitHub confirmed the isolated
  [destination test branch](https://github.com/voxletra/voxletra-e2e/tree/ci/private-synthetic-git-tree-proof-20261016)
  `ci/private-synthetic-git-tree-proof-20261016` resolves to that exact
  commit. No existing destination branch was overwritten.
- Verified by comparing Git recursive trees: all **90 preexisting base-tree
  entries were preserved** outside the synthetic subtree (zero missing,
  modified, or injected unrelated entries). Consequently the publisher now
  also checks complete outside-prefix destination-tree equivalence before
  final commit/ref publication. Offline mocked-GitHub security tests:
  **47/47 pass** after this extra invariant.
- This **did not** run the confidential publisher's full CLI against remote
  protected policy inputs; the Git objects were created through the
  individual authenticated GitHub connector operations for a deliberately
  generated synthetic payload. **No Oreslang private source was copied.**
  The isolated synthetic test branch should be deleted through authorized
  GitHub branch management when the evidence is no longer needed; the
  current connector exposes no branch-ref deletion action.


## Post-publication parent/ref collision invariants

Latest publisher safety pass also requires a complete source-prefix ancestor
chain in the materialized recursive Git tree and rejects an already-created
destination ref at **two** stages: once before any private source Git read
and once before publishing the final new ref. Only an actual GitHub 404
permits continuing; an existing ref (200), malformed/unauthorized/failed
metadata, redirect or unknown status fails closed. The final `POST /git/refs`
remains atomic with no overwrite. The mock model distinguishes a pre-creation
404 from the eventual successful read-after-write 200.

Isolated mocked GitHub publisher and privacy tests, evaluated from the
same reviewed branch version, passed **51/51** after including both
destination-base integrity, source-ancestor checks and ref collision cases.
This does not replace native publisher CI. See the synthetic cross-org proof
above for separately observed GitHub API blob/tree/commit/ref behavior.


## Cryptographic Git blob identity and private runner check

A further audit found that checking API fields \`sha\`, \`size\` and
\`encoding\` is not equivalent to verifying downloaded source bytes.
The publisher's bounded **read-only source phase** now strips GitHub's
permitted base64 CR/LF wrapping, requires valid canonical base64, decodes
the payload, checks its exact size and computes:

\`SHA1("blob " + byte_length + NUL + raw_bytes)\`

The locally calculated 40-character Git object SHA must equal the
independently pinned source tree entry **before the first destination
blob POST**. Inconsistent source bytes, noncanonical encoding, wrong
decoded length and spoofed API SHA fields deny publication.

Evidence from a new **source-free**, no-checkout, no-secrets hosted
private-runner workflow:
[GitHub Actions run #38954552168](https://github.com/voxletra/voxletra-e2e/actions/runs/38954552168),
commit \`1ed779edab833bcf46fa2220e2addfe4246368df\`,
private repo \`voxletra/voxletra-e2e\` (ID \`1311678027\`),
runner ID \`1000002335\`. Job logs explicitly contain all four markers:

- \`SYNTHETIC_BLOB_SHA_VERIFIED=yes\`
- \`CORRUPT_BASE64_REJECTED=yes\`
- \`FORGED_SHA_REJECTED=yes\`
- \`REAL_GIT_OBJECT_HASH_MATCH=yes\`

Actual Node.js \`node:crypto\` and \`git hash-object --stdin\` independently
agreed on Git blob SHA \`5e5201f1b1618f87282bf41ce89ca710404cce95\`
for generated bytes \`42;\\n\`. Good CR/LF-wrapped base64 was
accepted and modified/same-length content, invalid padding and incorrect
lengths were rejected. No private Oreslang compiler or actor source was
downloaded, copied or published for this proof.

The updated publisher/visibility test modules passed **55/55** in an
isolated mocked-GitHub execution with a synthetic SHA/base64 adapter.
The code's genuine cryptographic check was independently exercised with
native Node on the private runner. Neither claim is a hosted execution
of the entire unpublished publisher CLI or approval to export source.

