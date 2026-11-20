# PR #1 — paired pinned compiler source-check evidence, staged reconciliation

Historical head f0dce5101a689065f6702aa4deec785fb9ce4018; newest platform-conformance main 29ad3b0522a1e5130274a296d49708f155997ff1.

The historical 28-file PR is not applied as a wholesale replacement of modern main: it would overwrite current test admission, security incidents, backend registry and new conformance contracts. Instead, this integration adds the standalone `src/paired-proof.mjs` and source-free JUnit-style Node test `tests/paired-proof.test.mjs` without rewriting `fixtures/manifest.json` or pinning stale Java/LLVM source revisions.

The paired gate requires **both** separately produced reports to be fully configured/verified, with a non-empty independently computed fixture SHA-256 manifest, matching fixture set and distinct backend identities; it explicitly returns `certifiesRuntimeParity=false` and `certifiesCompilerBuildProvenance=false`. It must never be relabeled as executable guest parity, signed source-to-binary attestation or full actor coverage. We do not wire the historical `bin/verify-paired.mjs` CLI because its assumptions about all fixtures being shared are incompatible with current six-backend heterogeneous manifests.

Remaining work: adapt CLI to current heterogeneous manifest intersection and missing-fixture rejection; run authorized independently built pinned Java and LLVM tools on the same source cases, compare normalized typed outputs for actual runtime parity, document all evidence hashes. Keep draft until all targeted checks and independent review execute.
