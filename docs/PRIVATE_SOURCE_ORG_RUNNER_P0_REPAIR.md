# P0 — private source-organization runner admission repair and attestation

**Owner:** authorized `ores-truffle-oreslang` organization administrator.
**Issue:** [#315](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/315).
**Scope:** Restore a GitHub-hosted `ubuntu-24.04` runner in an existing **private,
same-organization** repository. This does not authorize a private-code mirror,
new self-hosted runner, change to secrets or workflow tokens, or relaxing branch protection.

## Established before repair

- The original same-org, source-free/no-checkout canary ran at GitHub Actions
  [run 41395829396](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/41395829396),
  immutable source head `3d5bdf454c65d87a915c5d23c2349522c80a958f`,
  workflow ID `404169919`, Git workflow blob `9fdf367e37c56c7c013b8a21222b0bbc4ad3c499`.
- Latest observed attempt **13**, job `128180053317`:
  `runner_id=0`, `steps=[]`, `conclusion=failure`. No job logs exist.
- A byte-identical source-free job in another private organization previously
  executed four steps. Public `ores-truffle-oreslang/oreslang-cli` jobs have
  assigned runners and stepful successes. **These comparisons do not establish
  exhausted credits, a billing fault, or permission for cross-org source transfer.**
- Repeating unchanged canary attempts is on hold until an administrator
  identifies and repairs the actual admission condition.

## Administrator action — no sensitive information in issues or chat

1. Open the failed run and select **Annotations / Checks** for the
   `runner-admission` job. Record the exact GitHub *reason category* for
   failure-before-steps. Do **not** publish payment details, credentials,
   private billing amounts, personal information, or authentication tokens.
2. In organization **Settings → Billing and licensing → Usage/Budgets**,
   verify Actions private-repository compute allowance, available metered
   usage, whether a budget has **Stop usage** enabled, payment standing and
   any enterprise-enforced cap. Only the administrator can access/change these.
   Never increase a budget or charge a payment method without an explicit
   authorized spending decision.
3. In organization **Settings → Actions → General**, verify Actions enablement,
   selected-repository access, permitted workflow/action policies and whether
   **standard GitHub-hosted runners** were disabled. Check enterprise
   overrides; if a repo-specific policy is implicated, compare the same
   conformance repository settings. Do not disable security policies merely
   to make the build green.
4. Confirm `ubuntu-24.04` is eligible as a **GitHub-hosted** runner for this
   private repository. Self-hosted runner groups are a separate mechanism:
   do not point untrusted PR code at a persistent runner as a workaround.
5. Correct **only the verified root cause** with approved permissions and
   spending limits. If the GitHub UI reports healthy billing and runner
   settings but the same pre-step failure persists, request GitHub Support to
   investigate entitlement/hosted-runner provisioning for the organization.
6. After the fix, perform **one** same-source-org rerun of the original
   no-checkout run 41395829396, not a new transfer or broad compiler wave.
   It should produce attempt **14 or later** and the two marker lines in
   actual step output:
   - `SOURCE_FREE_RUNNER_ADMITTED=1`
   - `SOURCE_FREE_TWO_STEPS_EXECUTED=1`
7. On a trusted Linux host with `/usr/bin/gh` and an explicitly exported
   `GH_TOKEN` (or `GITHUB_TOKEN`) scoped for read-only
   Actions/repository API access, run:
   `node bin/verify-private-runner-postrepair-live-v1.mjs`
   The script fetches the original workflow run, its **exact attempt** jobs,
   job detail, pinned workflow blob and job logs independently via GitHub.
   It performs no writes and never prints the token. It emits a source-free
   `verified=true` receipt only if the immutable source SHA, workflow blob,
   run/attempt, nonzero runner ID, successful ordered steps, valid timestamps
   and **actual** log markers all match.
8. Independently review this proof, store the qualifying run ID, attempt,
   job ID and source SHA/tree in issue #315, and only then schedule source-org
   exact-head Java/GraalVM and LLVM DOP guest CI. **A source-free pass is
   runner admission proof only; it never certifies compiler guest execution.**

## Separate non-negotiable release gates

- No private Git blob, source tree, artifact or cache transferred across
  organizations without individually approved governance under issues
  #22, #77 and #127.
- No status `PASSED` from `steps=[]`, `steps=null`, `runner_id=0`, or a
  missing JUnit/native test result.
- Preserve independently approved PR head SHA/tree and exact toolchain,
  tests, artifacts and negative mutation receipts for each backend.
- Do not merge source or conformance drafts until actual executed guest
  results, independent review, and protected-branch policy are satisfied.

## Current limitation

The connected GitHub repository integration can inspect runs/jobs and write
source PRs but **cannot read or change the organization billing/Actions
administration settings or check-run annotations**. No authenticated GitHub
browser profile is connected. Therefore this PR implements the independent
verification procedure but **does not claim that the private runner problem
has been fixed**.

## Extra receipt and live-reader hardening (stacked follow-up)

The verifier additionally requires **exactly four** source-free job steps
(\`Set up job\`, the two named shell checks, \`Complete job\`), with no
unapproved checkout/extra command. An allocated runner must report the
GitHub-hosted group (\`runner_group_id=0\`, \`runner_group_name="GitHub Actions"\`),
runner name matching its allocated ID, only \`ubuntu-24.04\` in requested
labels, and an observed pre-command **Hosted Compute Agent** and
**Image: ubuntu-24.04** log header. It correlates the individual marker lines
to the successful step timestamps, ordered job interval and the run's creation
and update interval. These safeguards still rely on GitHub API and runner
logs as evidence, not a cryptographic hardware attestation of the host.

The command-line reader now explicitly calls **github.com** with a
temporary isolated GitHub CLI configuration, an allowlisted set of
read-only REST paths, no inherited proxy/enterprise-host configuration,
and an explicitly supplied read-only \`GH_TOKEN\` / \`GITHUB_TOKEN\`.
Stored interactive \`gh auth\` sessions are deliberately **not reused**;
an operator must provide the narrowly scoped token securely in the local
process environment. Do not paste tokens into issue comments, ChatGPT,
CI logs or commands. The token is never passed in command-line arguments.

If GitHub API access, the log download, run/job identity, or runner
classification cannot be independently verified, output is
\`PRIVATE_RUNNER_ADMISSION_UNVERIFIED\` — **not** a categorical assertion
that no step executed. Known \`steps=[]\`/null from independent GitHub
job data remain confirmed zero-step runner-admission failures. A
success receipt is still \`SOURCE_FREE_PRIVATE_RUNNER_ADMISSION_ONLY\`,
not permission to merge or certify a compiler.

The extra source-only test cases cover private-repo identity,
self-hosted-label impersonation, exact four-step inventory, hosted
image/log preamble, log timestamp spoofing, cross-step injection,
run/job chronology, URL path traversal, \`GH_HOST\` / proxy redirection,
and missing credentials. These require real native Node execution
before qualification; isolated V8 test passes are preliminary only.

## Cross-endpoint evidence reconciliation and pinned source tree

The independent GitHub API verifier additionally binds the historical
source-repository numeric ID \`1413795502\`, organization owner ID
\`336720831\`, and original immutable source **Git tree**
\`20e4e66740aa03560ce5360f26ad8814a4de4688\` to exact commit
\`3d5bdf454c65d87a915c5d23c2349522c80a958f\`. The live reader
fetches \`GET /repos/ores-truffle-oreslang/oreslang-platform-conformance/commits/<head>\`
from the same pinned GitHub.com host, and refuses an absent or mismatched
commit/tree. This is **repository Git-tree provenance only**, not a
runner checkout, artifact tree or compiler execution.

The exact-attempt job-list response and independent job-detail response
must agree on job identity, run ID, attempt, source head, status,
conclusion, runner ID/name/group, requested labels, start/finish times,
canonical API and browser URLs, and *every* step's name, number, status,
conclusion and timestamps. A list reporting zero steps cannot be paired
with a synthetic four-step success detail. Both original and head
repositories must match the pinned GitHub repository and owner IDs,
preventing same-name repository re-creation from satisfying the proof.

The \`run_started_at\` timestamp must fall within the run lifetime and
the job must begin no earlier than that specific attempt (allowing
one second for GitHub API timestamp rounding). Existing strict Gregorian
date checks apply. A success receipt explicitly distinguishes
\`sourceCommitTreeResolved=true\` from
\`runnerCheckoutTreeVerified=false\`, while
\`guestTestsExecuted=false\` and \`backendParity=NOT_EXECUTED\`
are always retained.

New adversarial tests mutate Git tree/SHA/commit URL, repository/owner
numeric IDs, the attempt start, job-list versus job-detail status,
runner and step fields, canonical job URLs, plus the additional
immutable-commit read-only API route. These tests run source-only and
cannot provide a real private GitHub-hosted runner admission result.
