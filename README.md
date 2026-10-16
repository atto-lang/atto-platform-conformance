# Oreslang platform conformance

Cross-platform, **evidence-first** language and runtime conformance suite. A harness that has not run a real compiler must never claim parity.

## Real compiler evidence adapter (proposed integration)

A private compiler build can produce a narrow two-fixture JSON smoke report using the companion changes in [Java PR #953](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/953) and [LLVM PR #383](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/383). This repo adds a **non-promoting** consistency checker:

```sh
node bin/inspect-real-evidence.mjs /path/to/approved-report.json
```

See [the real compiler evidence policy](docs/REAL_COMPILER_EVIDENCE.md). The report must come from an independently reviewed real compiler run; the JSON adapter itself cannot authenticate an external run, and **a passing schema check does not demonstrate language correctness or parity**.

## Current deliverable

- Versioned fixture manifest and minimal positive/negative .ores sources.
- Safe subprocess-based command runner with an argv template; no shell interpolation.
- Executable harness unit tests (using a **fake checker** to verify the harness only).
- Explicit status: unconfigured, verified, mismatch, spawn failure, timeout.
- CI tests the harness. It does **not** claim Java/LLVM/Wasm feature parity without configured external compiler binaries.

## Examples

~~~sh
npm test
# A compiler that supports a non-executing --check mode:
node bin/conformance.mjs --backend=java --argv='["/absolute/path/to/java","-jar","/path/to/compiler.jar","--check","{file}"]' --source-sha=FULL_COMMIT_SHA --require
# A separate exact-head native compiler:
node bin/conformance.mjs --backend=llvm --argv='["/absolute/path/to/oreslang-llvmc","{file}"]' --source-sha=FULL_COMMIT_SHA --require
~~~

The first argv token must be an **absolute executable path** (never a PATH lookup), and the placeholder {file} is replaced with an absolute fixture path. Provide the exact committed compiler binary/revision. The harness records SHA-256 hashes of the executable and each fixture. The user-provided source commit SHA is explicitly marked **declared, not cryptographically attested to the compiler binary**; include independent build provenance to prove the relationship. The harness does **not** install/checkout compiler source or infer that one backend supports another backend's features.

When no backend command is supplied, the run exits non-success with explicit UNCONFIGURED status if --require is used. Without --require it can emit an explicit skipped summary for discovery; that is **not** a passing parity report. CI only exercises harness self-tests.

## Ownership and future steps
1. Pin compilation frontend/host revisions, profile registry contract and all fixture hashes.
2. Feed actual Java and LLVM non-executing check entrypoints into this harness; verify positive and negative cases.
3. Add runtime-output cases only after explicit backend support; compare typed values, actor messages, ownership, async and resource limits.
4. Add Wasm compile+instantiate and browser tests once the compiler emits actual Oreslang guest modules.
5. Extend environment-header fixtures when Java PR #586 is merged and LLVM implements equivalent checks.
6. Publish provenance (platform, toolchain, source/tree commit, raw logs, status) for each real evidence run.

**Security**: never mirror private compiler source into public repos. Same-org private GitHub repositories are not automatically readable with the test repo GITHUB_TOKEN. Use authorized credentials or approved private exact-tree CI mirroring; keep SHA evidence and delete temporary mirrors.

### Mandatory pre-copy private-carrier gate (not an approval to mirror)

**STOP:** [incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22)
documents private source exposed in a public CI carrier; Java
[issue #962](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/962)
states that protected source provenance and approved destination policy are still
unresolved. Neither repo visibility nor a successful test run grants publication
permission. Do not publish private source until an independent security/code-owner
review authorizes the specific destination **numeric repository ID**, source
repository ID, and pinned source commit/tree from a protected policy checkout.

The guarded publisher's configuration, when approval exists, requires:

- `ORES_APPROVED_PRIVATE_MIRRORS`: reviewed full owner/repo allowlist.
- `ORES_APPROVED_PRIVATE_SOURCE_REPO_ID`: reviewed immutable positive GitHub
  numeric source ID.
- `ORES_APPROVED_PRIVATE_DESTINATION_REPO_ID`: reviewed immutable positive
  GitHub numeric destination ID, distinct from the source.
- `ORES_APPROVED_PRIVATE_SOURCE_COMMIT`: reviewed exact 40-character source
  commit SHA, independently pinned to the intended source PR/head.
- `ORES_APPROVED_PRIVATE_SOURCE_TREE_SHA`: reviewed exact Git tree SHA for that
  commit, verified against GitHub's commit record **before any private blobs
  are requested**.
- `ORES_APPROVED_DESTINATION_BASE_COMMIT` and
  `ORES_APPROVED_DESTINATION_BASE_TREE_SHA`: independently reviewed destination
  commit and complete Git tree to build the isolated CI snapshot upon.
  These must match **before reading private source Git objects**, and the
  target prefix must be empty; caller-selected unreviewed workflows cannot
  become part of a private-source snapshot.
- `ORES_APPROVED_RUNNER_PROBE_RUN_ID`: positive integer GitHub Actions run
  ID for an independently reviewed *source-free* capacity workflow in the
  **destination repository**, executed within the preceding 24 hours.
- `ORES_APPROVED_RUNNER_PROBE_COMMIT`: exact approved destination commit
  that executed that probe; the workflow-run API must report that SHA.
- `ORES_APPROVED_RUNNER_PROBE_WORKFLOW`: approved workflow path, for example
  `.github/workflows/oreslang-source-free-capacity.yml`.
- `ORES_APPROVED_RUNNER_PROBE_WORKFLOW_BLOB_SHA`: independently reviewed exact
  immutable Git blob SHA of that workflow file **at the approved probe
  commit**. The publisher retrieves the destination commit/tree and rejects
  mismatched, missing, symlinked or truncated workflow entries before reading
  any private source Git object. Workflow contents still need independent
  security review; matching a Git SHA is integrity evidence, not approval.
- `GH_TOKEN` (or `GITHUB_TOKEN`): a narrowly authorized credential whose
  source-read and destination-write scope is separately reviewed. The
  connector's own authenticated calls do **not** mean a destination's
  `GITHUB_TOKEN` has cross-organization source access.

Missing, malformed, swapped, changed, public or internal repository metadata
denies the publication **before source blobs are read**, or before the next
destination write if identity/visibility changes mid-flight. A private
destination without a recent, correctly pinned **successful one-step runner
probe** is likewise denied **before requesting any source commit or blob**.
The publisher additionally checks that its exact, isolated
`ci/private-*` destination branch **does not already exist** before reading
the first private source Git object, and once again before publishing the
ref. GitHub 404 alone counts as branch absence; 200, permission failures,
rate limits, redirects and ambiguous responses deny the transfer.
The final create-ref POST remains the atomic collision gate, since a branch
could still be claimed between preflight and publication.

The reviewed destination base commit/tree and empty prefix are also checked
**before any confidential source Git read**. The published full Git tree is then compared to the reviewed
destination base tree **outside the new snapshot prefix**: every unrelated
existing Git path must retain its type, mode and object SHA, and no unrelated
paths may be added or silently removed. Ancestor directory tree hashes can
change because the new subtree is inserted, but their type/mode must remain
directory/040000. A matching nested source SHA alone is not proof that the
destination's existing repository contents were preserved. Destination prefix components
equal to `.github` (case-insensitive) are forbidden, including nested
`.github/workflows`, so source copies cannot target GitHub workflow locations.
Every entry of the **entire recursive source Git tree**, including directories,
must pass valid-path, SHA, Git type and mode validation (directories require
`040000`; blobs require `100644` or `100755`) before the publisher reads
its first source blob. Case-insensitive collisions are rejected across all
entries, not just files. This preflight does not authorize cross-org export:
separately reviewed source and destination policy remains mandatory.
The recent probe is evidence that a runner executed, **not** a guarantee of
remaining GitHub Actions minutes, current billing eligibility, or long-running
compiler capacity. Recheck runner capacity at each source transfer. The exact
published nested source tree SHA must match the source commit's Git tree, not
merely a few matching source file paths. The publisher creates only a new
isolated `ci/private-*` branch; it does not make CI minutes available or
prove that the destination workflow builds the full source.

The ID values must originate from independently reviewed configuration,
**not** untrusted PR code or a caller-edited local allowlist. Environment
variables are an input transport, not authentication of that policy. The
current implementation cannot prove branch protection, the protected-policy
origin, actual billing/minutes availability, or post-transfer confidentiality
on its own. Until those independent gates are verified, execute only offline
mock/adversarial tests; do not substitute generic GitHub blob/tree writes.

Recheck private repository status immediately before **each** write and
confirm actual Actions execution, exact-source build provenance, and artifact
cleanup. If the source or destination visibility changes, halt. Never
select a public organization or repository to avoid an Actions quota problem.
Containment of already exposed public Git objects is a separate incident task.

See https://ores-truffle-oreslang.github.io/logs/2/
