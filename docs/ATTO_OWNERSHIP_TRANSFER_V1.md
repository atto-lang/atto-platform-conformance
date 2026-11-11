# Atto ownership transfer without a new move keyword — v1

**Status: candidate / unattested.** The fixture matrix is source-level work, not five-backend compiler or guest execution proof.

## Canonical semantics

- Transfer: `rt take x` consumes a non-Copy owner exactly once. Any subsequent use, including another take, is a semantic error.
- Shared and exclusive loans: `rt borrow x` and **`rt mut borrow x`**. Do not introduce the noncanonical `rt borrow mut x` spelling.
- Copy/share: `rt copy x` and `rt share x`, with transitive type and lifetime validation.
- `val` is a fixed binding with mutable referent capability; `let` is rebindable with read-only referent; `let mut` permits both; `const` is fixed and read-only. These differ from Rust's `mut` naming.
- There is **no need to add Rust's `move` keyword** for local transfer, independent Task capture, or deferred channel callbacks. A hypothetical `capture(...)` clause is **not** implemented or required by this contract.
- Independent Tasks capture owned non-Copy values at **submission**, not `await`. Captured immutable Copy scalars remain usable by the parent. Borrowed loans, actor `self`, actor state and non-Send guards cannot escape to independent work.
- Deferred `nb cb writech` callbacks acquire the non-Copy captured value at **registration**, even if never invoked.
- Bounded actor mailboxes are linearizable: a successful admission transfers once; failed full/closed admission must preserve sender ownership or return the unconsumed value. Never consume on rejection, and never roll back after publication. Borrowed state or guards cannot cross unproven suspension points.

## Five-backend gate

All 16 fixture IDs must be run on Java/GraalVM, LLVM, Wasm, Forge, and .NET from byte-identical `.atto` sources. Negative tests must produce **semantic ownership or mutability diagnostics**; rejecting unfamiliar syntax, skipped tests or zero-step CI never counts. Positive compiler cases must genuinely typecheck. `compiler-runtime` cases additionally require real Atto guest execution and exact output/exit behavior.

Record compiler head/tree, exact guest blob, diagnostic class or runtime result, CI job steps, backend mode and command. Require LLVM/Forge sanitizers, Java/.NET AOT and Wasm worker runs for release-grade claims. An alternate private CI organization requires approved security controls and verified source identity; lack of source org minutes is not authorization by itself.

The source-only validator is `node --test tests/atto-ownership-transfer-v1.test.mjs`. It checks integrity and evidence policy **only**.

Existing related contracts: `docs/ASYNC_TASK_BORROW_SAFETY_V1.md`, `contracts/collection-ownership-sync-v1.json`, and `contracts/actor-buffer-transfer-v1.json`. In particular the latter already models full/closed mailbox rejection without consuming a sender's payload; these Atto fixtures do not establish real mailbox execution.

AttoNATS PR #12's async NIO guest sends INFO/PONG for one connection. It does not establish full NATS behavior, sealed actor-state compiler admission or backend ownership parity.
