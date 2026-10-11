# Native Oreslang → core Wasm → browser E2E gate

The `bin/wasm-core-conformance.mjs` executable takes absolute paths for an actual built guest.wasm, its adjacent experimental v1 artifact manifest, the exact browser artifact module plus its explicitly pinned SHA-256. It executes in a subprocess with a five-second deadline. It only counts success if the verified guest's entry actually returns an i64 BigInt equal to the expected number.

Run with `--wasm=/absolute/guest.wasm --manifest=/absolute/guest.wasm.artifact.json --browser-module=/absolute/oreslang-browser/src/artifact.mjs --browser-module-sha256=<64-lowercase-hex> --expected-i64=42`. A missing artifact, mismatch, unavailable browser adapter, host import, hash mismatch, timeout or crash is a failure. The npm unit suite skips this E2E check when inputs are absent and labels the skip; that is NOT feature parity.

The compiler source revision, executable hash and binary digest must be separately pinned in CI receipts. This is only the scalar guest subset, not proof of GraalVM parity, compiler-inferred effects, actors, async I/O or WASI components.

## Adapter code identity and provenance boundary

The browser adapter entry module SHA-256 is mandatory, passed independently to the conformance CLI. Its file bytes are hashed **before** the dynamic import, and the report includes this digest. CLI rejects duplicate flags to avoid argument replacement. This prevents a misconfigured/unpinned *entry* adapter from counting as evidence, but the imported `src/loader.mjs` and `src/inspect.mjs` dependencies are not covered by the entry-module digest. CI must separately pin and verify the complete browser source Git tree, and run from an immutable trusted checkout. A filesystem mutation between the hash check and module import is still possible without an immutable checkout; do not claim the standalone SHA check closes that race.

Set `ORESLANG_BROWSER_ADAPTER_SHA256` in opt-in cross-repo tests, from independently verified source bytes, rather than calculating the expected hash from arbitrary runtime input. The artifact digest and compiler provenance must also be proven separately. This check is host harness hardening, not runtime backend equivalence.
