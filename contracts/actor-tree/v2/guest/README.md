# V2 compiled guest certification gate — DRAFT

The signed-i64 candidate now has **exact-source compiled LLVM guest execution** on a funded runner; Java/GraalVM execution of the same source and FD3 host audit/parity remain unverified. It adapts the real compiled three-actor scalar guest in LLVM PR #180 into a new four-hop source fixture sending INT64_MIN twice downstream (A → B → C) and INT64_MAX twice upstream (C → B → A). The original LLVM scalar runs provide the starting baseline. The new source's own LLVM execution is independently verified by funded run https://github.com/zed-pkg-test/java-app/actions/runs/38282112924; it does not certify Java/GraalVM behavior or FD3 host audit semantics.

The source Git blob SHA-1 and normative V2 schema SHA-256 are pinned in manifest.json. The validator in ../validation/guest-parity.mjs requires real executions on **both** llvm-native and java-graalvm. Its unit tests deliberately use synthetic inputs and **are not runtime evidence**.

## Required trusted CI invocation

Run the Node 22+ verifier from the repository root, passing four flags:

- --llvm-runner /trusted/ci/build-and-run-llvm
- --graal-runner /trusted/ci/build-and-run-graal
- --llvm-authority /trusted/ci/llvm-registry-authority.json
- --graal-authority /trusted/ci/graal-registry-authority.json

The runner executables MUST compile precisely ORESLANG_GUEST_SOURCE (verified by Git blob SHA), then execute the real compiled guest, exiting with code 43. No shell-generated mock or host-side substitute qualifies. The CI job must verify the source compiler tree/blob SHAs, build artifacts, runtime executable, and preserve the raw run logs.

Each trusted host runtime (not guest logging) must emit **exactly one compact JSON object and newline on inherited file descriptor 3** (ORESLANG_GUEST_AUDIT_FD=3). JSON contains exactly kind=oreslang-v2-guest-audit, backend, sourceGitBlobSha1, trace, physicalDone. The trace follows the existing V2 normative four-message JSON Schema; physicalDone contains three entries of the shape {actor, done:true, cleanupDrained:true}, one per verified route incarnation.

The authority files are independent host-generated registry snapshots: expectedPipelineId, expectedSchemaHash, expectedRoute. Generate them **before reading any trace fields**, and never copy route or schema authority from the untrusted guest trace. The compiler and runtime still need genuine host-owned FD3 instrumentation and independent authority provisioning; neither backend has a completed integration demonstrated by this PR.

The comparator checks exact source identity, signed-i64 endpoint values, all four typed hops, separately trusted actor identities, complete physical DONE receipts, and normalized Java/LLVM parity. It rejects missing backends, stale generations, forged routes, missing receipts, duplicate-key/noncanonical audit JSON, and substituted schema hashes.

**Security and proof boundary:** the checker does not attest arbitrary runners or protect FD3 from a compromised host. Only a reviewed, funded, exact-source CI workflow invoking real compiled guest binaries can establish executable provenance. The older LLVM aggregate stderr evidence, unit-test fixtures, structural TypeSpec/Ajv tests, and bounded TLC checks cannot be promoted into full compiled guest certification. Keep PR #13 draft and unmerged until that evidence exists.


## Runner environment hardening

The verifier's `guestRunnerEnvironment()` forwards a small allowlist of
runtime discovery variables (such as PATH, LANG, JAVA_HOME and library
locations) and overwrites the four `ORESLANG_GUEST_*` control variables
with host-selected values. It deliberately does **not** inherit
GITHUB_TOKEN, cloud credentials, SSH_AUTH_SOCK, HOME, or arbitrary CI
environment variables. Negative unit tests assert these exclusions.

This is only environment scrubbing. It does **not** confine a child process
that can read the host filesystem, write FD3, or access inherited process
privileges. Real guest certification still requires sandboxed runners,
host-only audit descriptor authority, reviewed compiler/runtime provenance,
and separately authenticated physical DONE receipts.

## Real LLVM guest execution evidence

Funded run: https://github.com/zed-pkg-test/java-app/actions/runs/38282112924

The runner checked 162 LLVM compiler/runtime source Git blobs and the exact source Git blob SHA-1 above. It built the real LLVM compiler, compiled this precise guest to LLVM IR, linked the real native scheduler and MessagePack runtime, and executed the resulting binary. The guest exited 43, reported two typed forward and two backward hops, ended at INT64_MAX, recorded three physical actor STOP receipts, and closed its actor group with active=0. It emitted real native SOURCE_PIPELINE_ADMIT events with INT64_MIN along the data path and INT64_MAX on the reverse result path.

**Evidence boundary:** the executed native compiler/runtime currently emits admission/STOP diagnostics on stderr; this is not the new structured host-audit FD3 interface. The current proof is executable LLVM single-flow signed-i64 boundary support, *not* a full V2 cross-backend runtime certification. The separately required Java/GraalVM same-source guest, trusted authority records and canonical FD3 trace are still pending.

## Java/GraalVM signed-i64 dialect execution (NOT same-source parity)

Funded Java/GraalVM 25 run: https://github.com/zed-pkg-test/java-app/actions/runs/38282982409

An independent Java-dialect fixture, now committed to Java PR #645, compiled and executed three actor stages with two INT64_MIN downstream values and two INT64_MAX upstream values. Its source Git blob is 8fcb0a15ff5001b2b4c41a6159438121a6d53577, **different** from the LLVM guest source blob 34c2dc0de8816df2f2f8bfbd3c12814ef2afbdb6. The Java run passed 1,471 Maven tests and its exact expected four-hop stdout result. The Java parser required a real fix to accept the negative signed-i64 endpoint without allowing positive overflow (parser blob f5b5a74ff5830467b6aaf320f8f6ac774e88050a).

The same-source release gate remains BLOCKED until frontend syntax/lowering is reconciled, the exact same .ores Git blob executes in both backends, and each real host writes authoritative FD3 V2 audit records. These two green dialect-specific runs **cannot** be combined to claim compiler or source parity.

## 2026-10-12 verifier authority-order hardening

The verifier reads and validates **both preprovisioned authority snapshots before
launching either compiler/guest runner**. A guest runner that writes or alters
an authority file after execution cannot update the already captured expected
route, request and schema in memory. Each authority file must contain exactly
one compact canonical JSON object followed by a newline, with the closed fields
`expectedPipelineId`, `expectedSchemaHash` and `expectedRoute`.
Duplicated JSON keys, unexpected authority fields and accessor-backed
in-memory evidence fields fail closed.

The pure comparator returns `status: "trace-equivalent"` and
`certified: false` even for matching traces. This prevents synthetic fixture
self-tests or caller-supplied capture objects from being described as
authenticated guest-runtime proof. An independent runner-provenance gate and
actual same-source execution on both backends are still required.

A second manifest/source verification after execution detects persistent
worktree changes during the run, but does not establish what bytes the guest
compiler actually consumed. FD3 host ownership must be enforced by the
separate trusted runner/runtime integration rather than inferred from JSON.

## Nested evidence and FD ownership boundary

The exported comparator now rejects getter-backed nested payloads, sparse
arrays, reference-aliased mutable evidence, unexpected prototypes and
non-JSON number values before reading the capture. This is defense in depth
for direct API callers; canonical JSON parsed from FD3 has no JavaScript
accessor properties or shared references.

**FD3 isolation is not yet independently proven.** The parent process passes
FD3 to the trusted backend wrapper. That wrapper must compile and launch the
guest in a separate child process with FD3 closed, capture native host-owned
scheduler events through an authenticated private channel, and write the
witness on FD3 itself. The Node launcher does not enforce that grandchild
descriptor isolation, so FD3 JSON alone is not sufficient provenance.
