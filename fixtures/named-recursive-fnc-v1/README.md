# Named recursive fnc guest probe

The merged source-only tests validate the exact user example and nine blob-pinned fixtures. Run:

    node --test tests/named-recursive-fnc-v1.test.mjs

The separate executable probe rebuilds a compiler from a trusted clean Git checkout, verifies both independently supplied head/tree pins and runs the eight smoke candidates. It is expected to fail until compiler support exists. Configure these environment variables using independently verified Git object IDs:

- ATTO_COMPILER_REPO
- ATTO_EXPECTED_COMPILER_HEAD
- ATTO_EXPECTED_COMPILER_TREE
- ATTO_EXPECTED_CONFORMANCE_HEAD
- ATTO_EXPECTED_CONFORMANCE_TREE

Then run:

    node tests/named-recursive-fnc-guest.mjs rust-wasm
    node tests/named-recursive-fnc-guest.mjs forge-native

Rust is the native-hosted compiler emitting Wasm, not the browser-hosted compiler or the independent Wasm backend. Forge emits C++ then builds and runs the native binary. Require exact 64-bit value, not exit status or lossy Number conversion. Wasm panic_code=1 and Forge E_OVERFLOW/70 are target-specific terminal overflow indicators, not evidence for a catchable typed exception ABI. Forge's name-resolution diagnostic mapping is deliberately not certified: a rejected source alone cannot pass the negative case. A successful smoke report is not a pass for the extended exact fib(55) guest or other compiler profiles.

Run only on trusted source trees with an authorized runner, isolated from secrets and privileged credentials. No unapproved cross-org source export. This script does not authenticate CI, and must not be used to fabricate required status checks. Retain actual executed steps and receipts separately. No guest evidence has been produced by adding the probe.
