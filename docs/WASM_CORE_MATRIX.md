# Native Oreslang → core Wasm → browser E2E gate

The `bin/wasm-core-conformance.mjs` executable takes absolute paths for an actual built guest.wasm, its adjacent experimental v1 artifact manifest, and the exact browser artifact module. It executes in a subprocess with a five-second deadline. It only counts success if the verified guest's entry actually returns an i64 BigInt equal to the expected number.

Run with `--wasm=/absolute/guest.wasm --manifest=/absolute/guest.wasm.artifact.json --browser-module=/absolute/oreslang-browser/src/artifact.mjs --expected-i64=42`. A missing artifact, mismatch, unavailable browser adapter, host import, hash mismatch, timeout or crash is a failure. The npm unit suite skips this E2E check when inputs are absent and labels the skip; that is NOT feature parity.

The compiler source revision, executable hash and binary digest must be separately pinned in CI receipts. This is only the scalar guest subset, not proof of GraalVM parity, compiler-inferred effects, actors, async I/O or WASI components.
