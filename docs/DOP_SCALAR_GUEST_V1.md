# AttoLang DOP scalar guest v1: reference oracle and evidence boundary

This is a **versioned portable target**, not a claim that all five compilers
execute data-oriented source. The precise fixture is byte-for-byte identical
to oreslang-source.llvm draft PR #1308 at its recorded source blob SHA.
The fixture is an actual .atto program using two separately allocated
primitive Array<int> columns. It deliberately **does not** claim an
inverted class/struct, AoSoA lowering, actor-owned storage, or true SIMD.

## What is checked now

Run: node --test tests/dop-scalar-guest-v1.test.mjs (Node >=22).
These tests verify fixture provenance and reference computation for AoS, SoA and
AoSoA-16 at empty, edge and 32,768-row inputs. They check signed-i64
arithmetic bounds and poison evidence receipts that have missing CI steps,
a mismatched HEAD, missing compiler/guest hashes or no executed tests.
This only executes the Node host-model oracle, **not the .atto compiler**.

For 32,768 rows and ten sweeps, the guest must exit 0 after verifying
checksum 537509888, first position 20, last position 32787, and final
velocity 2. This workload is within LLVM's existing per-array limit
of 65,536 elements, as documented in PR #1308.

## Source-owned conformance CI (still non-promoting)

The source-local
[`five-backend-scalar-receipt-host-only.yml`](../.github/workflows/five-backend-scalar-receipt-host-only.yml)
workflow now executes **all six DOP v1 Node test files** at the exact PR
head: scalar fixture/oracle, GitHub run/job snapshot, authenticated REST client,
bounded local evidence-file reader, JIT/AOT profile and integrated receipt
tests. This closes the earlier coverage gap where the workflow executed only
two older `test/five-backend-scalar-*.test.mjs` suites. It retains those older
host tests and excludes fork-provided private-source checkouts. Each test
failure makes the CI job fail; the job emits only an explicit **HOST-ONLY**
marker, not a backend PASS receipt.

A zero-step GitHub Actions failure means **NOT_EXECUTED**, even when this
workflow was accepted by GitHub and locally executed Node tests passed. No
source-free action here compiles or runs the Java or LLVM `.atto` guests.

## Exact-head backend gate (each backend independently)

1. Pin the compiler repository's 40-character HEAD SHA, its Git tree SHA,
   and the fixture's Git blob SHA. Re-check them after execution. Do not
   implicitly replace the fixture with translated or host-only source.
2. Compile that same .atto fixture through the **real backend toolchain**;
   run the resulting guest executable/module with a positive control and
   confirm exit 0. A parser-only pass is not a guest pass.
3. Record the compiler and fixture SHA-256, the evidence for the **explicit**
   execution profile described below, actual command/toolchain, discovered and
   executed test counts, GitHub run/job IDs, and admitted runner IDs, plus
   nonempty timestamped **executed** step records.
4. Read the run/jobs/artifact details back from the GitHub API and compare to
   the receipt. validateDopGuestReceipt only validates a receipt's shape;
   its synthetic positive control is **not a cryptographic attestation**.
5. Classify each backend as PASSED, FAILED, UNSUPPORTED, or NOT_EXECUTED.
   When the feature is absent, require an executed compiler-owned rejection
   without an output binary before calling it UNSUPPORTED; otherwise use
   NOT_EXECUTED. Zero-step runner failures are NOT_EXECUTED.

LLVM draft #1308 supplies scripts/verify-dop-atto-aot.sh for real LLVM IR
and Clang guest execution, but the execution gate still needs a stepful,
verified exact-head receipt. Java draft #2272 is only a closed scalar cpu {}
preview and not interchangeable with the two-array guest fixture; Java
#2550/#2554 host storage and unsupported inverted declarations must not be
counted as positive guest execution. Wasm, Forge and .NET require their own
real compiler and runtime execution receipts, not host storage tests.

## Execution-profile split: Java JIT versus native AOT

The v1 positive-receipt schema now has an **explicit Java JIT path** instead
of demanding a fictitious JIT executable. For a `PASSED` JIT receipt,
`executionProfile: "jit"` requires:

- `backend: "java"`, `executionStage: "managed-guest"`, a real zero guest
  exit status and `guestArtifactSha256: null` (explicitly no native guest file).
- `jitEvidence.compilerClassTreeSha256`: SHA-256 of the sorted
  compiled Java class-file hash manifest. It must be identical to the
  top-level `compilerSha256` field. The source-local workflow now records
  the digest before guest execution and requires the same digest after.
- `jitEvidence.runtimeBinarySha256`: SHA-256 of the resolved JDK `java`
  executable actually selected by the source-local workflow.
- `jitEvidence.junitReportSha256`: SHA-256 of the validated two-case Surefire
  XML report, `jitEvidence.reportClass: "dev.oreslang.DopScalarGuestParityTest"`,
  and the exact guest case names
  `identicalScalarSoaSourceCompilesAndReturnsZeroFromRealJitGuest` and
  `incorrectGuestChecksumIsDetectedByActualCompiledExecution`.
- `executedTests: 2` and `discoveredTests: 2`, plus the usual exact-head,
  `checkout-head`, `compile-guest`, `execute-guest`, runner, timestamp and
  independent GitHub API job correlation requirements.

For `executionProfile: "aot"` (or older receipts with no profile), the
existing `guestArtifactSha256` remains compulsory and `jitEvidence` must
be absent. Artifact-backed execution stages are now bound to the actual
backend: Java Native Image uses `nativeaot-guest`; LLVM and Forge use
`native-guest`; Wasm uses `browser-guest`; and .NET permits emitted managed
CIL (`managed-guest`) or NativeAOT (`nativeaot-guest`). The historical
`"aot"` label means an independently hashable emitted artifact for .NET CIL,
**not** proof that the CIL was compiled to native machine code. A Java JIT
run cannot claim `PASSED` by omitting `executionProfile` and fabricating a
legacy AOT hash. An unknown or host-only execution profile is not a valid positive
receipt. The positive JIT profile is **only supported for Java** in this v1
contract; it does not assert portable machine-code/JIT compilation detail
without an independent code generation witness.

These are **structure validations**, not actual attestations. Even a synthetic
fully populated receipt with two valid-looking digests does **not** establish
source, compiler, runtime binary or Surefire report provenance: a separate
trusted collector must independently hash the source-side files, validate the
JUnit report contents, verify the exact workflow steps and fetch the matching
GitHub job/run. The current source-local Java draft
[PR #2571](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2571)
has authored the runtime/JUnit hash measurements plus a sorted digest of
its compiled Java class-tree manifest (as a source-local compiler fingerprint).
The verifier must still independently bind that manifest to the exact
compiler source/tree and executable JDK; a self-reported class-tree digest is
not proof of guest code generation. Java has **NOT_EXECUTED** on a runner. LLVM native [PR #1308](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1308)
retains its real AOT output hash checks, also **NOT_EXECUTED**.

Run `node --test tests/dop-execution-profile-v1.test.mjs tests/dop-execution-integration-v1.test.mjs`
for 18 source-free JIT/AOT profile and full-receipt tests, including negative
backend/stage mismatches and the previously admitted legacy-JIT artifact spoof.

## Independent GitHub run/job snapshot correlation

`verification/dop-github-run-snapshot-v1.mjs` adds a second, fail-closed
verification layer. Given a receipt, the contract, an independently fetched
GitHub Actions workflow-run record, its **complete first page** of job records,
and a pinned expected repository name, `validateDopGithubSnapshot` checks
that the claimed HEAD, repository, run ID, job ID, admitted runner ID,
conclusion, and named timestamped steps match the GitHub records. It rejects
zero-step jobs, partial pages, wrong-run jobs, duplicate job identities, and
mismatched step names or timestamps. Its receipt requires
`ciJob.jobId` (positive safe integer) for that API correlation.

Retrieve snapshots independently from the authenticated source-repository
GitHub REST API, not from a PR-author-supplied JSON attachment:

- `GET /repos/OWNER/REPO/actions/runs/RUN_ID`
- `GET /repos/OWNER/REPO/actions/runs/RUN_ID/jobs?per_page=100`

If pagination is required, the verifier deliberately rejects the incomplete
response instead of silently sampling a page. This module **does not fetch
remote data by itself**; callers must authenticate the source and confirm
the exact API origin. Even an externally retrieved run/job snapshot cannot
attest compiled guest bytes, CLI executable provenance, or artifact hashes;
those require separate independent job/artifact and source-tree checks.

Run: `node --test tests/dop-scalar-guest-v1.test.mjs tests/dop-github-run-snapshot-v1.test.mjs`.
The GitHub-snapshot fixtures are *synthetic attacks and a positive shape
control*, not proof that a remote compiler actually executed. Do not
promote `NOT_EXECUTED` when a job has no runner or executed steps.

## Read-only source-GitHub REST evidence collection

`verification/dop-github-api-v1.mjs` now retrieves the exact workflow run
and its first (up to 100 jobs) job page from GitHub's fixed HTTPS REST
endpoints, using an explicitly authorized token with **Actions read**
permission on the source repository. It makes exactly two GETs, disallows
HTTP redirects, bounds each streamed JSON reply to 1 MiB and 15 seconds,
requires canonical uncompressed JSON, rejects invalid UTF-8, duplicate decoded JSON keys and excessive nesting, and neither checks out source nor transfers binary
artifacts or private Git objects.

Call its CLI with a small receipt JSON file:

```sh
GH_TOKEN=... node bin/verify-dop-github-run-v1.mjs \
  receipts/llvm-dop-v1.json \
  ores-truffle-oreslang/oreslang-source.llvm \
  RUN_ID
```

Before network access the CLI opens the local receipt and versioned manifest
as bounded regular files with a no-follow descriptor, rejects FIFOs and leaf
symlinks, checks stable file metadata, and uses the same duplicate-key-rejecting
JSON reader as authenticated REST responses. On hosts lacking a secure
no-follow/nonblocking file-open primitive the CLI refuses to run rather than
silently relaxing input safety. This guards leaf paths; callers must still
control and review ancestor directories and local filesystem permissions.

The script refuses a missing token, a backend/repository mismatch against the
five pinned source organizations/repositories, or a receipt referring to a different
run, then passes the **independently fetched run/jobs records** to
`validateDopGithubSnapshot`. Its only positive classification is
`CORRELATED_NOT_GUEST_ATTESTED`. It is **not a release gate by itself**:
independent source-tree, compiler, executable and artifact-hash checks,
a source-local stepful guest run, branch protection and independent review
are still required. A private conformance-repository `GITHUB_TOKEN`
normally cannot read another private source repo; obtain explicit
read-only repository-scoped access or run this on the approved source
side, not by mirroring private source.

Run `node --test tests/dop-github-api-v1.test.mjs tests/dop-evidence-file-v1.test.mjs tests/dop-github-run-snapshot-v1.test.mjs` for 35 focused source-free JSON/file/run provenance adversarial and control groups, including head-repository, job source SHA and rerun-attempt checks. The HTTP tests exercise no-Content-Length streaming as well as refusal of compressed and forged media types. The
positive controls use a mocked transport and do not imply GitHub runner
admission, native code generation or executed guest evidence.

## Separate future gates

- Add compiler-owned inverted AoS/SoA/AoSoA layout selection and generation/
  ownership checks: stale and foreign handles, overlapping loans, close while
  borrowed, swap-delete reuse, forbidden actor-state escape and cancellation.
- Add real scalar/SIMD **guest** instruction comparison with partial tails,
  unaligned accesses, checked integer arithmetic and defined floating-point
  NaN/signed-zero semantics. An admission-only Wasm SIMD test is insufficient.
- Only after a device ABI exists, add typed gpu { cpu {} } and
  cpu { gpu {} } source checks, upload/download ownership and physical GPU
  receipts. Explicit GPU calls must never fall back to CPU silently.

No private GitHub source-tree transfer or cross-organization CI mirroring is
part of this contract. The source-owner's security approval is required for
any independent private runner/export, separately from this test corpus.
