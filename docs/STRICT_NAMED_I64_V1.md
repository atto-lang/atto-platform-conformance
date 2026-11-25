# Strict named signed-i64 v1 — five-backend conformance candidate

**Status: NOT_EXECUTED on all five backends.** This is a source-free contract and receipt shape checker, not compiler support, stepful guest execution, AOT evidence, or parity certification.

## Canonical vectors and provenance

The exact 26-vector JSON at contracts/strict-named-i64-v1.json is byte-identical to the signed-i64 contract from [Java implementation PR #2641](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2641), head 6804d0d5045b2945770c3e0edc8082dbaef16215, Git blob 3f65f557f06e8cd0d34a738a0d357d6c2e477665, plus SHA-256 dacca2eaf503f854fd7f60ba135ff31b6c210d90aff8d117d4dedb5b88bedec5. The verifier pins both digests, validates every expected result using an independent Node BigInt reference oracle, and checks manifest and candidate guest-source SHA-256 digests.

Operations: Integer.rem(a,b) (truncating remainder); Integer.mod(a,b) (nonnegative Euclidean modulus including signed MIN); Integer.pow(a,b) (checked i64 exponentiation with nonnegative exponent); Integer.bitXor(a,b) (signed 64-bit XOR). Error categories: DIVISOR_ZERO, OVERFLOW, NEGATIVE_EXPONENT.

Each proposed .atto guest program prints the full signed-64 value through stdio.println(Integer.operation(a,b)) or deliberately triggers an error. Never infer a full-i64 result from the 8-bit OS process exit code. Positive and negative cases must run through a real authenticated backend compiler and guest execution target with an independently reviewed diagnostic mapping. Host-thrown exceptions are not automatically guest trap results.

## Run the source-free unit checks

~~~sh
npm test
node bin/verify-strict-named-i64.mjs
~~~

Without a receipt the second command must exit 2 and report NOT_EXECUTED, not PASS.

Once a source-owned compiler has been independently authenticated, the backend may supply its receipt containing: canonical backend and repository, source/compile commit SHAs, compiler binary and guest artifact SHA-256, manifest Git blob and SHA-256, execution mode, real GitHub Actions run URL, positive run/job/runner IDs, runner name, explicit exactHead=true and workflowHeadSha equal to the declared sourceCommit, exact attempt and successful nonzero step list, log SHA-256, guest execution status, and exactly 26 ordered full-value/error observations bound to deterministic guest-source hashes.

~~~sh
node bin/verify-strict-named-i64.mjs /path/to/one-backend-receipt.json
node bin/verify-strict-named-i64.mjs /path/to/five-backend-receipts.json
~~~

**Crucial:** this tool only checks receipt data shape and internal consistency. Fabricated evidence fields and matching fake reports could pass shape checking. Its accepted result is always SHAPE_ONLY_NOT_ATTESTED; its CLI says RECEIPT_SHAPE_ONLY. This is NEVER proof of GitHub Actions, compiler provenance, guest execution, ownership/GC claims, or cross-backend parity. A human/approved verifier must inspect and authenticate actual source-org step records, runner assignment, raw logs, compiler binaries, generated guest artifacts and observed results. For sealed full guest AOT, separately establish no interpreter/JIT fallback, closed-world code generation and correct ownership/GC boundaries. GraalVM Native Image or .NET NativeAOT host builds alone do not prove full guest AOT.

All unit-test receipts are deliberately synthetic and must never be promoted to backend evidence.

## Execution matrix

| Backend | Repository | Conformance execution |
| --- | --- | --- |
| Java/GraalVM | oreslang-source.java | NOT_EXECUTED |
| LLVM | oreslang-source.llvm | NOT_EXECUTED |
| Wasm | oreslang-source.wasm | NOT_EXECUTED |
| Forge | oreslang-source.forge | NOT_EXECUTED |
| .NET | oreslang-source.net | NOT_EXECUTED |

Blocking dependencies: source-owned Actions runner/billing [issue #315](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/315), independent source reviews and exact-head execution. Do not export private source to alternate organizations without separate approval. Existing draft [conformance #161](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/161) concerns signed-numeric source admission; it is not this named-operation executed guest contract, and its evidence cannot substitute for these five lanes.
