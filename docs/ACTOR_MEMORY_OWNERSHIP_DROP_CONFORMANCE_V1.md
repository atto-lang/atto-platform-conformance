# Actor-owned memory and exact-drop conformance v1

**Status: source-only semantic contract.** Neither this file nor a passing Node
harness provides proof that any compiler accepted, type-checked, compiled or
executed these fixtures. The attached manifest deliberately has zero verified
runtime backends.

The source-positive fixture `synchronous-owned-drop.ores` defines a
serial `Worker` actor with one persistent scalar field and two immutable
owned scalar temporaries per message. Eight inputs, `1..8`, must result in
the final handler value `1004`. A native implementation should reclaim
both temporary owner slots before the scheduler admits the next message,
while keeping `total` alive until shutdown. The expected final native
owner count **after authenticated retirement** is zero.

The negative fixture `reject-scoped-borrow-escape.ores` attempts to return
`rt borrow temporary` from a synchronous handler and must be rejected
without outputting guest LLVM IR. The canonical mutable borrow spelling
is `rt mut borrow`, not legacy `rt borrow mut`.

## Backend status (no release claims)

- **LLVM:** Experimental compiler/runtime patch
  [#848](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/848).
  Its independent [#849](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/849)
  CI gate must successfully build LLVM, execute the compiled guest, and
  publish an exact-head receipt. Until then, runtime verification is false.
- **GraalVM/Java:** Pending equivalent source-level borrow/drop lowering.
- **.NET:** Pending equivalent source-level ownership/drop lowering.
- **Wasm and JS:** Pending equivalent source-level ownership/runtime behavior;
  their host memory models need not match LLVM's physical implementation.

`node --test tests/actor-memory-source-contract.test.mjs` validates only
source-blob hashes, canonical fixtures, exact backend inventory, negative
oracle and claims that would otherwise overstate proof.

## Proof still required

For each backend, preserve an exact source SHA/tree, backend/compiler revision,
compiler command and exit status, linked/target artifact SHA, guest exit and
output, runtime native-memory drop counters, independently observed actor
retirement, and genuine runner job IDs with nonzero executed steps.
A source-free verification script cannot manufacture any of these facts.

Extend later with cancellation, throw/raise unwinding, await frame retention,
FFI loan drain, repeated retirement and randomized actor mailbox schedules.
No zero-GC or minimal-GC claim is made here.
