# Private Oreslang CI: P0 security and release acceptance

**Status: DENY EXPORT / DO NOT MERGE.** This is a review aid, not a
permission grant, a passed native CI receipt, or proof of compiler parity.

## Read-only checkpoint, 2026-10-29

| Gate | Observed | Required |
| --- | --- | --- |
| Five source `main` branches | All `protected:false` | Protected, app-bound checks, independent CODEOWNER review, strict merge and no bypass |
| Conformance `main` | `protected:false` | Independent security controls for CI-gate changes |
| Destination `sagitta-stack/sagitta-infra` | Private repo ID `1357615104`, `main` **unprotected** | Protected `main`; exact approved immutable repository identity |
| Source export destination approvals | Zero active entries in all five source repos | One explicitly approved, reviewed destination ID/snapshot pair |
| Exposure incidents | #22, #77, #127, #212 **all open** | Independent containment and exact completed disposition of all four |
| Source Actions | Jobs failed with `runner_id:0` and no steps | At least one completed source-local job with a real runner and meaningful step |
| Independent review | @ORESoftware requested on drafts #57 and #203 | Approval after reviewing changed implementation and workflow identities |
| Native regression suites | Unverified on source-local runner | Native Node 22 execution at exact PR SHA with logs and artifacts |
| Compiler guest tests | Unverified | Real Java, LLVM, .NET, Wasm, and Forge guest executions with exact SHA evidence |

The last directly inspected PR #57 conformance check was
[run 40824579384](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/actions/runs/40824579384):
attempt 1, job 123284551093, `runner_id:0`, zero steps. This is an
**admission failure**, not an executed-test failure. Do not infer a billing
cause without the provider's job annotations.

## Reviewed workflow-blob discrepancies

The source private-CI authorizer pins trusted workflow bytes, not merely
workflow names or success-looking checks.

* .NET, Wasm, Forge: the current `main` private-CI workflow blob is
  `fa03fc77b5e253a8b51c875f72359b18f82f1cf7`, while the independent
  source policy authorizer pins
  `1e18ea42fc8a819e26a90f9b2dfea7cbdc129e76`.
  The newer main workflow adds a **PR-head checkout revision and a
  source-tree identity assertion**. Its contents must be reviewed independently
  before amending a trusted SHA pin; do **not** silently repin it.
* Java and LLVM do not have the canonical private-CI workflow on current
  `main`. Draft policy PRs are not evidence of protected policy on `main`.
* The independently pinned **carrier** policy workflow SHA
  `645f7f8f5ec6d907fb2a1b7ea9f93c8e28f3855a`
  was retrieved from the exact immutable Git object in the private
  `sagitta-stack/sagitta-infra` repository and confirmed byte-for-byte
  against the test fixture. No production trusted SHA changed.

## Publisher fail-closed boundaries

Draft PR #57's `bin/private-mirror-publish.mjs` checks:

1. All four exact source-exposure incidents are completed before source reads.
2. Immutable source commit/tree and independently reviewed source/carrier policy
   and numeric destination identity on protected `main`.
3. The requested destination base commit equals the carrier's current
   **protected `main`** before initial source bytes and before each mutation.
4. Source blob Git SHA/size, canonical base64, exact byte content, full recursive
   manifest, safe directory paths, portable casefold uniqueness, and a 40 MiB
   bounded source snapshot.
5. No preexisting destination files under the isolated prefix.
6. Reauthorization before each blob, tree, commit or new-ref POST; exact
   destination Git blob receipts, materialized tree contents, and ref readback.
   The destination base Git commit must return the exact approved SHA. The
   newly created commit must read back with exactly the verified tree and one
   protected-main parent **before** publishing any ref.
7. No overwriting existing refs or publishing to `main`.

A rejected remote **blob POST may leave an unreachable/dangling Git blob**.
Stopping later commits or refs is not proof of Git-object deletion. Only a
reviewed incident-containment procedure can determine appropriate cleanup.

## Verification and merge order

1. An authorized GitHub administrator uses the read-only collector in draft
   PR #203 to retrieve the provider annotations on zero-runner job 123254216351.
   Diagnose billing, Actions policy and runner eligibility **from provider text**.
2. Restore a runner *inside the original source org*. A separately reviewed
   ephemeral self-hosted runner in the original org is a potential alternative,
   but not a cross-org source export.
3. On an authorized source-local Node 22 checkout at the **exact draft HEAD**:

   ```sh
   git rev-parse HEAD
   node --test \
     tests/private-mirror-publish.test.mjs \
     tests/private-ci-bootstrap-audit.test.mjs \
     tests/private-mirror-visibility.test.mjs
   npm test
   ```

   Archive the SHA, runner ID, job conclusion, actual TAP logs and test artifacts.
   Any V8-shim execution or funded-carrier synthetic pass must be labeled
   **non-native**, and must not replace these checks.
4. Enable protected `main` for every source repo and security-gate repo.
   Independently review CODEOWNERS, app issuer-bound required checks, policy
   revisions, pinned workflow hashes and owner/bypass permissions.
5. Independently dispose of all open confidential-source exposure incidents.
   Activate **specific, reviewed, exact** source SHA/root tree and destination
   numeric ID approvals on protected source and carrier mains in the required
   approval order. No broad or retroactive source-export approvals.
6. Re-run read-only admission immediately before **each** permitted mutation.
   Any revocation, main drift, missing permission, altered workflow, or
   environment error must deny publication.
7. Only after that, run and accept real Oreslang guest execution across Java,
   LLVM, .NET, Wasm and Forge, with exact compiler/runtime SHAs, outputs and
   source-local job receipts. Contract-only or source-free CI does not prove
   backend parity.

The funded `honeypot-r-us-test/hnpt-e2e` independent synthetic gate has
previously executed on a real GitHub Actions runner (64/64 tests at
[run 40820019157](https://github.com/honeypot-r-us-test/hnpt-e2e/actions/runs/40820019157)).
This proves funded source-free capacity only. **Never mirror a private Oreslang
Git tree on that basis.**

## Executed evidence and limits

At the exact source-export draft SHA recorded on the associated PR, the
isolated JavaScript V8 harness executed **97/97** regression cases against
exact GitHub-fetched modules (28 bootstrap, 36 authorization, 33 publisher),
including base-head drift, malformed source directory trees, forged base
commits and forged newly-created commit parent/tree receipts. This harness
uses independently validated SHA-1/Base64/Buffer compatibility functions.
It is **not** a native Node.js test runner and is **not** a source-org
GitHub Actions execution. The native Node 22 regression suite must still
run on an authorized checkout before merging. On PR #203, two separate
diagnostic suites (50 and 45 cases) have run locally under native Node
22.16.0 with exact code/test Git blob hashes. Those checks do not prove
compiler or private-source publication.
