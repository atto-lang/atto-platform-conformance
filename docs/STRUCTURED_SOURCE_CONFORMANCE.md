# Structured-source conformance v1

This is a byte-pinned, limited i64 class conformance contract. Three fixtures match the original files in oreslang-wasm exactly, including their original Git blob hashes.

Two positive cases cover multi-field class reads and exclusive mutable borrows, both returning 42 as real LLVM-to-Wasm32 guests. A negative case rejects overlapping mutable/shared loans before artifact output.

Source execution evidence: https://github.com/akrion-sim/akrion-sim-e2e/actions/runs/38113193431

The tests here check schema, fixture integrity and explicit backend status; they are not themselves a compiler or runtime execution proof. GraalVM remains `pending` until the *same source* executes with equivalent behavior and diagnostics there. This is not proof of heap-backed objects, actor ownership, async suspension or a public structured-value Wasm ABI.
