# Named recursive fnc guest probe

The merged source-only tests validate the exact user example and nine blob-pinned fixtures. Run:

    node --test tests/named-recursive-fnc-v1.test.mjs

The separate executable probe rebuilds a compiler from a trusted clean Git checkout, verifies both independently supplied head/tree pins and runs the eight smoke candidates by default. It is expected to fail until compiler support exists. Configure these environment variables using independently verified Git object IDs:

- ATTO_COMPILER_REPO
- ATTO_EXPECTED_COMPILER_HEAD
- ATTO_EXPECTED_COMPILER_TREE
- ATTO_EXPECTED_CONFORMANCE_HEAD
- ATTO_EXPECTED_CONFORMANCE_TREE

Then run:

    node tests/named-recursive-fnc-guest.mjs rust-wasm
    node tests/named-recursive-fnc-guest.mjs forge-native
    node tests/named-recursive-fnc-guest.mjs rust-wasm direct-stage
    node tests/named-recursive-fnc-guest.mjs js-esm direct-stage

JavaScript runs the pinned production `src/program-v2.mjs` compiler directly in a fresh Node subprocess for each fixture, requires byte-identical source and serialized-IR emission, checks the exact fib(55) ESM syntax without executing it, and runs small guests in a separate bounded process. The entry module digest is not a standalone compiler binary digest; the full Git tree pin identifies the compiler source. The targeted negative maps only the exact `ProgramCompileError` for the out-of-scope `fib` call. Full-smoke overflow additionally requires the frozen, typed arithmetic error identity. This is Node ESM evidence, not browser-worker evidence or an allocation guarantee.

Rust is the native-hosted compiler emitting Wasm, not the browser-hosted compiler or the independent Wasm backend. Forge emits C++ then builds and runs the native binary. Require exact 64-bit value, not exit status or lossy Number conversion. Wasm panic_code=1 and Forge E_OVERFLOW/70 are target-specific terminal overflow indicators, not evidence for a catchable typed exception ABI. Forge's name-resolution diagnostic mapping is deliberately not certified: a rejected source alone cannot pass the negative case. A successful smoke report is not a pass for the extended exact fib(55) guest or other compiler profiles. Both profiles compile the exact fib(55) source without executing it. The direct-stage profile additionally executes four small value cases and checks the lexical-scope rejection; it lists the three skipped nested-recursion smoke cases and cannot emit full smoke_pass. Forge compile-only requires both emitted C++ and a built native artifact. Negative cases reject any filesystem entry at the artifact path, including a dangling symlink.

Run only on trusted source trees with an authorized runner, isolated from secrets and privileged credentials. No unapproved cross-org source export. This script does not authenticate CI, and must not be used to fabricate required status checks. Retain actual executed steps and receipts separately. No guest evidence has been produced by adding the probe.
