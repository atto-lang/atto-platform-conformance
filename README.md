# Oreslang platform conformance

Cross-platform, **evidence-first** language and runtime conformance suite. A harness that has not run a real compiler must never claim parity.

## Real compiler evidence adapter (proposed integration)

A private compiler build can produce a narrow two-fixture JSON smoke report using the companion changes in [Java PR #953](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/953) and [LLVM PR #383](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/383). This repo adds a **non-promoting** consistency checker:

```sh
node bin/inspect-real-evidence.mjs /path/to/approved-report.json
```

See [the real compiler evidence policy](docs/REAL_COMPILER_EVIDENCE.md). The report must come from an independently reviewed real compiler run; the JSON adapter itself cannot authenticate an external run, and **a passing schema check does not demonstrate language correctness or parity**.

## Current deliverable

- Versioned fixture manifest and minimal positive/negative .ores sources targeting **five compiler backends** (`java`, `llvm`, `net`, `wasm`, `forge`); this is a target inventory, not a parity claim.
- Safe subprocess-based command runner with an argv template; no shell interpolation.
- Executable harness unit tests (using a **fake checker** to verify the harness only).
- Explicit status: unconfigured, verified, mismatch, spawn failure, timeout.
- CI tests the harness. It does **not** claim Java/LLVM/.NET/Wasm/Forge feature parity without configured real compiler binaries, exact revisions and independently reviewed provenance.

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

**SECURITY INCIDENT HOLD — no Oreslang compiler source transfers.**
Private-source placement incidents [#22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22)
and [#77](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/77)
remain open. Neither a private repository, an environment allowlist, nor a matching
Git tree/blob SHA constitutes authorization to transfer confidential source.
The previous executable `bin/private-mirror-publish.mjs` CLI instructions have
been withdrawn and that CLI is disabled pending incident-owner approval.

Do **not** rerun old source-bearing workflow carriers, create replacement carrier
branches, migrate source to another organization, or purge incident refs/artifacts.
Preserve existing forensic evidence under the incident response process.
Deletion of refs alone is not sufficient to purge copied Git blobs.

The proposed [review-pinned dispatcher #1217](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/1217)
is a draft, **not** an approval: independent human review, exact source/destination
repository ID and Git tree, destination privacy, carrier workflow hashes, and
independent completed/resume decisions for both incidents are required.
Use only source-free fixtures, synthetic repositories, or already approved CI
that does not transfer compiler source. Before re-enabling any publisher, audit
**all** live entrypoints including imported programmatic APIs, scripts, and
GitHub Actions workflows; the CLI guard alone is insufficient.

See https://ores-truffle-oreslang.github.io/logs/2/
