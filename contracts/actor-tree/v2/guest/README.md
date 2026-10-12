# V2 compiled guest certification gate — DRAFT

The signed-i64 candidate in this directory is **not yet compiled or executed on either backend**. It adapts the real compiled three-actor scalar guest in LLVM PR #180 into a new four-hop source fixture sending INT64_MIN twice downstream (A → B → C) and INT64_MAX twice upstream (C → B → A). The original LLVM scalar runs are valuable baseline evidence, but they do not certify these new bytes or Java/GraalVM behavior.

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
