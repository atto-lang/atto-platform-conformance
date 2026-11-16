# Oreslang platform conformance

Cross-platform, **evidence-first** language and runtime conformance suite. A harness that has not run a real compiler must never claim parity.

## Canonical lambda v1 target fixtures

[`fixtures/lambda-v1/manifest.json`](fixtures/lambda-v1/manifest.json) contains five positive and five rejection `.atto` cases for the canonical `|x| -> expression` syntax (typed arguments, captures, shadowing, `|>`, and rejected captures/placeholders). Their SHA-256 bytes are pinned. The **only** currently implemented check is fixture integrity and fail-closed manifest status validation:

```sh
node bin/validate-lambda-v1.mjs
node --test test/lambda-v1-manifest.test.mjs
python3 scripts/run_lambda_v1.py --check-manifest
python3 -m unittest discover -s tests -p 'test_run_lambda_v1.py' -v
```

`npm test` now discovers both the Node fixture tests and a Node wrapper that runs the six Python AOT harness unit tests. To attempt **real** guest execution, invoke `scripts/run_lambda_v1.py` with an exact Git-tree SHA and checkout, a source commit SHA, a concrete `--compile-command` and `--run-command`, and a target native/WASM `--artifact-format` and `--evidence-file`. The runner refuses missing prerequisites, refuses host-script artifacts and records `RUNNER-CANDIDATE-REQUIRES-INDEPENDENT-CI-PROVENANCE`, not parity certification, even if every guest command succeeds.

This produces `FIXTURE_INTEGRITY_ONLY_NOT_GUEST_EXECUTION` — **not** a compiler pass. Actual five-backend certification still requires immutable tree and compiler provenance, strict AOT artifact inspection, execution of each guest, and independent CI-run verification under the existing parity evidence policy.


## Real compiler evidence adapter (proposed integration)

A private compiler build can produce a narrow two-fixture JSON smoke report using the companion changes in [Java PR #953](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/953) and [LLVM PR #383](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/383). This repo adds a **non-promoting** consistency checker:

```sh
node bin/inspect-real-evidence.mjs /path/to/approved-report.json
```

See [the real compiler evidence policy](docs/REAL_COMPILER_EVIDENCE.md). The report must come from an independently reviewed real compiler run; the JSON adapter itself cannot authenticate an external run, and **a passing schema check does not demonstrate language correctness or parity**.

## Universal tree-shaking receipt

The repository carries the versioned `oreslang.reachability/1` contract and a
fail-closed verifier for backend-neutral tree-shaking receipts. See
[`docs/TREE_SHAKING_CONTRACT.md`](docs/TREE_SHAKING_CONTRACT.md).

```sh
node bin/verify-reachability-manifest.mjs /path/to/reachability.json
```

A valid receipt proves only the shape and internal consistency of reachability
evidence. Final artifact/synthesis inspection is still required to prove the
dead implementation was physically omitted.

## Platform capability promotion receipts

The six `oreslang-platform.*` targets now have a shared evidence contract:
[`contracts/platform-capabilities-v1.json`](contracts/platform-capabilities-v1.json).
Use `bin/verify-platform-capability-receipt.mjs` to reject zero-step workflows,
host stubs mislabeled as compiler guests, repository/platform substitution, and
target/physical claims without the required evidence. See
[`docs/PLATFORM_CAPABILITY_PROMOTION.md`](docs/PLATFORM_CAPABILITY_PROMOTION.md).

## Candidate state-container and virtual-actor declarations

[`contracts/state-container-virtual-actor-v1.json`](contracts/state-container-virtual-actor-v1.json) records 20 proposed compile/runtime oracles for `define state container` and `define virtual actor`. All backend results are **NOT_EXECUTED**. The Node contract tests validate fixture completeness and evidence labels only; they do not compile or execute guest programs. The Java reference parser has a separate fail-closed admission branch pending actual ownership and virtual-activation lowering. `define grain` is not an accepted alias.

## Current deliverable

- Versioned fixture manifest and minimal positive/negative .ores sources targeting **six compiler backends** (`java`, `llvm`, `net`, `wasm`, `forge`, `js`); this is a target inventory, not a parity claim.
- Safe subprocess-based command runner with an argv template; no shell interpolation. JavaScript is a source-check-only target pending independent ESM runtime evidence.
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

The harness now reads bounded regular fixture bytes through verified file
descriptors and **seals the entire suite in a private temporary snapshot before
launching the first compiler**. Each fixture's SHA-256 records the exact copied
input supplied to the subprocess; it never reopens a mutable checkout path
while compiling. Symlinks, hardlinks and oversized inputs are rejected. This
improves local test provenance but does not attest that the caller-declared
source commit built the compiler or turn a compiler into a sandbox. The harness
re-hashes sealed fixture bytes before and after each compiler invocation, failing
on detected tampering (including same-UID chmod/rewrite attacks on a later case).
This is **detection, not immutable filesystem enforcement**: an adversarial
compiler running with the same user permissions can race or restore bytes, so
untrusted executables still require an independently enforced sandbox. Binary
hashing reads in bounded 64-KiB chunks and refuses executable files above
512 MiB; binary hashes remain local receipts rather than reproducible-build
attestations.

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

### Experimental JS checker target

Once the JS compiler source and Node 22+ executable are available in an **authorized, private** CI checkout at exact revisions, the JS subset can run:

```sh
node bin/conformance.mjs --backend=js --argv='["/absolute/path/to/node","/absolute/path/to/oreslang-source.js/bin/oreslang-jsc.mjs","--program-v2","--check","{file}"]' --source-sha=EXACT_JS_SOURCE_COMMIT_SHA --require
```

This is a **source acceptance/rejection gate**, not a runtime test. `verified` means the two compiler-check subprocess cases met the narrow source-check expectations, **not** that any emitted JS was executed. See `docs/MATRIX.md` for the required runtime, compiler provenance, and cross-backend parity gates.


### Six-backend admission hardening (2026-10-15)

The manifest harness recognizes Java/Graal, LLVM, Wasm, .NET, Forge and JS
(plus the existing browser runtime selector) without assuming any backend
implements an unlisted fixture. A backend with **zero registered cases**
reports `NO_CASES` and `ok: false` even when the caller supplied a real
executable; discovering a backend is not certifying it.

A negative compile fixture is `VERIFIED` only on exit code **1** with its
expected diagnostic and no crash/fatal marker. Exit 2, 126, 127, signals,
timeouts, missing executables and crash-shaped diagnostics never satisfy
semantic rejection. Identical fixture references and duplicate backend
selectors within a manifest case are rejected.

The registered fixture set remains only a **compiler-admission**
probe; it does not prove six-backend parity, guest execution, runtime safety,
trusted-code AOT, or CI provenance. Registering cases does not establish compiler or execution proof. See
`tests/six-backend-admission.test.mjs` for regression coverage.

## Parity batch 1: grammar, types, imports, ownership, HIR/MIR

The [first-five parity inventory](docs/FIRST_FIVE_PARITY.md) tracks five
source-compiler workstreams across Java, LLVM, .NET, Wasm and Forge. Run
`npm run parity:first-five` to check the strict versioned manifest and print
its SHA-256 fingerprint. `npm test` runs rejection controls for incomplete
and falsely verified inventories. Both commands are **contract checks only**:
no real compiler is run and neither command attests backend support.

Use actual, pinned real compiler execution and independently verified CI
provenance before changing backend support declarations. The source fixture
smoke harness remains a separate, narrower test.

## Nominal enum hardening inventory (five backend target)

[Enum semantics v1](docs/ENUM_SEMANTICS_V1.md) defines the closed, nominal case/tag,
exhaustiveness, payload, zero-GC and actor-wire boundaries. Its
[14 Git-blob-pinned positive/negative fixtures](contracts/enum-semantics-v1.json)
cover Java, LLVM, Wasm, .NET and Forge as a **target** inventory.
The Node fixture-integrity tests do not compile Oreslang, and no backend is
marked confirmed until real exact-source compiler checks and guest execution
produce independently reviewable evidence. Enum methods and full portable
wire codecs remain separate implementation/verification gates.
