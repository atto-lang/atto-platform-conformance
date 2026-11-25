# Standing AttoLang private GitHub Actions fallback procedure

**Purpose:** When an `atto-lang` compiler's GitHub Actions job is not runner-admitted, use an independently authorized organization with actual Actions capacity to run exact-source CI. This is an operational runbook, **not** a private-source export authorization, a substitute for human review, or a claim of backend parity.

## 1. Diagnose admission before blaming the compiler

Inspect the exact workflow run and all of its jobs. A completed failure with `runner_id: 0` and `steps: []` (or no steps) is **NOT_EXECUTED**. Do not describe this as a failing compiler test, successful test, or confirmed Actions-minutes exhaustion. Ask source organization administrators to inspect billing/usage, Actions policy, workflow approval gates and GitHub runner provisioning. Also consider an approved source-organization self-hosted runner.

## 2. Find actual alternate capacity

If source-organization minutes or runner capacity are exhausted, look for another user-authorized private GitHub organization/repository with available Actions budget. Confirm a **recent** successful nonzero-step GitHub Actions run **and** its `runner_id > 0`; old historical successes are insufficient. Capacity may change between runs.

Example **read-only evidence**, 2026-11-21: `ores-data-platform/atto-ci` [run 44948305584](https://github.com/ores-data-platform/atto-ci/actions/runs/44948305584), job 136980409990, had runner 1000001490 with 23 steps and concluded success (**host contract only**, not compiler guest proof). Later [run 44948528732](https://github.com/ores-data-platform/atto-ci/actions/runs/44948528732) failed with runner IDs 0 and zero steps. Thus even this carrier's capacity is intermittent; verify it again before use.

## 3. Mandatory private-source security gate — BEFORE fetching or writing source blobs

Private source **must not** move to any other GitHub organization or repository unless the source's independent security owner has affirmatively approved the specific **exact owner/repo and immutable numeric repo ID** on the source-side protected allowlist, the existing cross-organization private-source incident hold is formally cleared for that transfer, and the destination is verified private. For Java, `.github/private-ci-approved-repositories.txt` currently has **no approved destinations**. Conformance [security hold PR #273](https://github.com/atto-lang/atto-platform-conformance/pull/273) documents the open containment policy. A user's instruction to try another runner, successful alternate Actions minutes, source-private visibility, and possession of GitHub connector write access do **not** replace the required independent source-side approval.

**While any hold is active or the approved destination list is empty: STOP BEFORE SOURCE FETCH/CROSS-ORG WRITE.** Never bypass with an intermediate relay repository, nested branch, personal token, secret, archive, or adjusted destination name. Source-free synthetic runner-admission probes are allowed only when they do not copy confidential source and must be labeled **NOT_GUEST_CI**.

## 4. Token-free exact-tree mirror — only AFTER the source transfer is approved

The source repository may be private; the carrier's default `GITHUB_TOKEN` cannot check out a different organization's private repo. Do **not** add cross-org credentials or personal access tokens.

1. Resolve the immutable source PR **commit SHA and tree SHA**. Revalidate before work; reject moving refs, incomplete branches, dirty/inconsistent tree states and unbounded export sizes. Authenticate exact source repo, carrier repo ID and approved transfer scope.
2. Using the GitHub connector **with permission**, enumerate the exact source commit tree and create equivalent blobs/trees in a temporary branch **inside the approved private carrier repository**. Do not cross source-org boundaries before clearance. Preserve binary contents, paths and executable/symlink modes; reject unsupported Git LFS/symlink cases, unknown objects and incomplete/mismatched data rather than silently skipping. Respect the source publisher's bounded blob-budget and independently reviewed mirroring procedure.
3. Verify **every individual source/destination Git blob SHA**, then compare final **tree SHA**, commit-parent provenance and the intended source HEAD against the mirror receipt. A matching branch name, copied file count, or successful checkout alone is not verification. Reconcile any SHA mismatch **before CI**; never use `force` to hide drift.
4. Let Actions in that carrier run a local checkout of its **own temporary mirror branch** using its own scoped `GITHUB_TOKEN` and available minutes. Enforce readonly contents and no unrelated secrets. Run the same designated exact-HEAD Java JUnit/Truffle/GraalVM/Native Image, LLVM CTest/GCC/Clang ASan/UBSan and other backend acceptance gates.
5. Independently verify run ID, job ID, `runner_id > 0`, **nonzero actual steps**, `conclusion=success`, source-to-mirror SHAs, compiler artifact digest, fixture blob digests, test XML/output and compiled guest execution. Host models, parser-only denials and candidate receipts **never** become certified `atto-source.*` parity.
6. Revoke/delete the temporary mirror ref after collecting only the required provenance receipts and completing the authorized retention window. Verify cleanup, and do not export logs containing private source. If the connector cannot delete the ref, document manual cleanup rather than claiming it happened.

## 5. When transfer is NOT approved

Keep all work **inside the original source repository** and keep blocked builds `NOT_EXECUTED`. Run eligible source-free/synthetic admission probes separately if useful, but they **cannot** certify source compilation. Seek source-org billing, policy or self-hosted-runner remediation and the independent security approval/incident disposition. Preserve existing PR merge approvals and branch protection.

**Durable user workflow preference:** Search for a functional alternate private Actions carrier when source-org Actions minutes or admission are exhausted, then use a **token-free exact Git-tree mirror into a temporary carrier branch** with per-blob SHA proof, **but only after** source-side private transfer approval. Never turn the safety preflight into a bypass.
