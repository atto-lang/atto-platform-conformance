# Public playground: 43-example backend execution matrix (v1)

This private conformance ledger pins all **43** published `.atto` sample source Git blobs at site commit `77d48789295d42c20f39c0810c3257b63b4e1fe8`, site Git tree `3821c8b035cbd05ccbd1c75b693f7ca665409951`.

**Eight accepted sample guests executed** and the ninth was an expected `E_IMMUTABLE` compilation rejection (no output artifact) in Rust native / wasm32 compiler and the pinned site. The approved source-to-Wasm compiler run is documented at [private runner #43757643264](https://github.com/zed-pkg-test/oreslang-private-pr-validation-20261012/actions/runs/43757643264) using exact source tree `d1a0c428ba810115a3cfeaa3106583b09bda6c88`. Site verification ran at [#43756990286](https://github.com/atto-lang/atto-lang.github.io/actions/runs/43756990286).

The **34 syntax previews are NOT EXECUTED** in this matrix, including when a separate feature branch already compiles a subset. Java/GraalVM, Oreslang LLVM, Wasm, Forge and .NET have **NOT EXECUTED** marks here for *all* 43 snapshots. This intentionally does not claim those compilers lack support; it means that the exact source blobs were not executed against them in these receipts.

The manifest holds only immutable identities, statuses and links. It does not embed a public candidate compiler binary or copy private implementation files. Tests fail closed on omitted/duplicated previews, invented evidence, and falsely promoted backend statuses.

## Extending a backend row

1. Pin the same source Git blob SHA and executed compiler Git head/tree, toolchain and guest ABI.
2. Run positive and negative programs through that backend, with no emitted artifact for the negatives. Record stdout, exit/panic, ownership and actor traces where relevant.
3. Distinguish parser-only acceptance from executable guest output and distinguish intentional target unsupported diagnostics from infrastructure NOT_EXECUTED.
4. Add a new immutable executed receipt for the backend and update the matrix validator together. Independent review is required for any status promotion.

Run: `python3 -m unittest discover -s tests -p 'test_playground_example_matrix.py' -v`.
