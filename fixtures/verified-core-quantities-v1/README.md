# Verified Core quantities v1 corpus

These cases exercise the candidate file-local signed-i64 quantity profile from
`atto-spec/proposals/verified-core-quantities-v1.md`. `cases.json` records
expected scalar results, compile-time rejections, and arithmetic failures.

Run the same corpus through each local compiler from the
`atto-platform-conformance` checkout:

```sh
node bin/verify-verified-core-quantities-native.mjs java /path/to/atto-source.java
node bin/verify-verified-core-quantities-native.mjs llvm /path/to/oreslang-llvmc
node bin/verify-verified-core-quantities-net.mjs /path/to/atto-source.net
node bin/verify-verified-core-quantities-rust.mjs /path/to/atto-source.rs/target/debug/attoc
```

The Java runner builds the compiler and runs actual Atto source through
Truffle. The LLVM runner uses the provided compiler and links its generated IR
with Clang. The .NET runner builds the compiler and executes the generated CIL
in CoreCLR through the repo's existing host. For LLVM, division failures
share the native trap signal. The runner additionally checks the named guards
in emitted IR. Successful executions and the checks performed here are scoped
to these profiles. A fixture or runner is not an authenticated CI receipt.

All four runners expand the same 23 checked-in cases with 96 generated cases (119 total). The Rust driver invokes a real `attoc`, verifies exit 1 with the exact source diagnostic and no artifact on rejection, instantiates emitted Wasm with no imports, checks the full signed-i64 result, and checks `panic_code` 1 or 2 on an actual engine trap. Its local compiler/source/artifact digests are observations, not authenticated provenance; bind them to an exact checkout/tree in the CI gate before claiming parity. The Rust source candidate is #523. No successful full 119-case compiler run is claimed here.
