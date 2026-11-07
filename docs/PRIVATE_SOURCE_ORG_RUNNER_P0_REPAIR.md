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
7. On a trusted Linux host with `/usr/bin/gh` authenticated for read-only
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
