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
- Five target selectors (`java`, `llvm`, `net`, `forge`, `wasm`) now share the two language admission smoke fixtures. The `browser` selector remains separate. This is harness coverage, **not** identical source lowering or runtime semantics.
- CI tests the harness. It does **not** claim five-backend or Elm-inspired `Option`/`Result`/`Future`/reactive parity without exact-source compiler binaries, positive guest execution, negative admission, and verified output/cleanup traces.

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
2. Feed exact-tree Java, LLVM, .NET Native AOT, Forge, and native-LLVM→Wasm checker/runner entrypoints into this harness; verify positive and negative cases without counting simulated compiler checks as parity.
3. Add runtime-output cases only after explicit backend support; compare typed values, actor messages, ownership, async and resource limits.
4. Add Wasm compile+instantiate and browser tests once the compiler emits actual Oreslang guest modules.
5. Extend environment-header fixtures when Java PR #586 is merged and LLVM implements equivalent checks.
6. Publish provenance (platform, toolchain, source/tree commit, raw logs, status) for each real evidence run.

**Security**: never mirror private compiler source into public repos. Same-org private GitHub repositories are not automatically readable with the test repo GITHUB_TOKEN. Use authorized credentials or approved private exact-tree CI mirroring; keep SHA evidence and delete temporary mirrors.

### Mandatory pre-copy private-carrier gate

Git blob identity is only an **integrity** proof. It does not authorize publication.
Before invoking *any* GitHub write, copying a private blob, creating test refs or
uploading a build artifact, the trusted mirror orchestrator must run:

```sh
export GH_TOKEN="token-with-read-metadata-on-both-repositories"
export ORES_APPROVED_PRIVATE_MIRRORS="akrion-sim/akrion-sim-e2e"
node bin/private-mirror-publish.mjs \
  ores-truffle-oreslang/oreslang-source.java \
  SOURCE_COMMIT_SHA40 \
  akrion-sim/akrion-sim-e2e \
  DESTINATION_BASE_COMMIT_SHA40 \
  snapshots/source-sha \
  ci/private-immutable-source-proof
```

The **publisher** performs the same GitHub-verified visibility and allowlist
checks *inside* its GitHub blob/tree/commit/ref write path. It pins an exact
source commit, checks the recursive tree and individual blob SHA values, and
creates only a **new isolated CI branch** (never overwrites an existing ref,
main branch or an unapproved destination). Visibility is rechecked before
every GitHub object/ref mutation. It cannot promise a truly atomic check-and-
write with GitHub visibility changes; keep source/destination visibility
admin privileges tightly controlled and revalidate before each run.

The standalone `require-private-mirror.mjs` is available for diagnostics,
but running that preflight by itself **does not** authorize a subsequent
unprotected git push. Do not use generic copy/push commands in place of the
guarded publisher.

The CLI fails closed unless the source and destination both resolve as
GitHub-verified **private** repositories and the destination is explicitly
allowlisted, not archived and writable by the credential. A 403, missing token,
unknown visibility, non-approved repo, `internal` or `public` destination, and
malformed metadata are all failures. Do not print the token, copy source on
failure, or "retry" by switching to a public carrier.

Do not allow a workflow that runs only *after* a push to substitute for
the mandatory **before-copy** admission decision. Execute the gate immediately
before the mirror operation, using trusted credentials and a locked-down
destination whose privacy cannot change independently during the copy. This
preflight is not a cure for historically exposed Git objects; incident response
and GitHub Support may be required. See
[security incident #22](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/22).

See https://ores-truffle-oreslang.github.io/logs/2/
