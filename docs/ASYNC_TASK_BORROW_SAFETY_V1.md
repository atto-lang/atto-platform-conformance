# Oreslang async Task borrow-safety contract — v1

**Status (2026-10-21): normative cross-backend safety gate.** Companion to `CPU_GPU_TASK_V2.md`. Backends may remain fail-closed until their compiler/runtime ownership chain is proved.

**Canonical ownership syntax:** `rt borrow value`, `rt mut borrow value`, `rt take value`, `rt copy value`, and `rt share value`. Oreslang source does not use C/C++ pointer-style `&` or `*` ownership operators.

## Ownership boundary

`task { ... }`, `cpu task { ... }`, and `gpu task { ... }` submit independent logical work immediately. Submission—not `await`—is the ownership-transfer boundary. Compatibility `nb` forms obey the same lifetime rules.

Every executable child requires compiler-derived admission tied to the exact checked Task expression, parent ownership epoch, execution domain, and runtime-created child identity. Launch authority is one-shot: a second initial dispatch/replay of the same child identity is rejected, and the identity/epoch/domain proof is revalidated on every physical resume. Reparsed/untyped ASTs, optimizer clones, foreign handles, or user-authored metadata cannot mint authority.

## Capture rules

1. Capture discovery is CFG-aware and lexical-scope aware. It includes nested Tasks, closures, `defer`/`finally`, channel/select callbacks, method receivers, classic `for` initializers, for-of/destructuring, pattern/catch/select bindings, and recursive lambda names. Unknown AST forms fail closed.
2. Copy-safe immutable values are snapshotted at submission. A non-Copy owned value transfers exactly once and requires a compiler-derived transitive Send proof. Parent and sibling continuations may not use the moved binding afterward. Unknown nominal or inferred ownership provenance fails closed unless the compiler can derive the complete transitive transfer proof.
3. Ordinary `rt borrow` and `rt mut borrow` loans, actor-state loans, guards, interior-mutable/raw/foreign capabilities, untrusted handles, and scheduler-local authority cannot escape into an ordinary independent Task. Wrapping them in classes, records, generics, closures, `rt copy`, `rt share`, or serialization does not make them Send-safe.
4. Scoped immutable READ borrowing is a distinct structured-concurrency capability. It requires an exact lexical TaskScope, exact allocation identity/generation, proven Sync referent, authenticated projection/range proof, exact scheduler child identity, and physical retirement before release.
5. Scoped mutable WRITE capture remains rejected until distinct WRITE authority, disjoint-place proofs, reborrow freezing, cancellation fencing, and runtime conflict control exist.
6. A `Future<T>` result must own, copy, or explicitly share its payload. Borrowed references, guards, actor-state projections, and device pointers cannot become ordinary Future results.
7. An independent Task never inherits actor `self`, actor state, mailbox-turn authority, or supervisor authority. Use message passing or explicitly owned/share-safe data instead.

## Suspension and reclamation

Treat `await`, blocking select/channel I/O, `rt cooperate`, compiler-inserted safepoints, carrier migration, cancellation, exceptional cleanup, and CPU/GPU transitions as continuation boundaries.

A live loan may cross a suspension only when storage lifetime and authority remain proven. Logical Future completion, timeout, or cancellation request is not physical quiescence. Memory/resource authority is retired only after scheduler-confirmed physical Task completion; GPU authority additionally waits for the real device-completion fence.

Dropped Task handles remain supervised descendants. Scope shutdown seals admission, propagates cancellation, and waits for physical child retirement without pinning a carrier.

## Backend release gate

- **GraalVM/Java:** positive Task execution may ship only with exact compiler→runtime admission, transactional capture transfer, suspension-safe continuation storage, actor confinement, cancellation/quiescence fencing, and executable regression coverage.
- **LLVM:** reject before LLVM IR until native Task continuation + ownership lowering exists.
- **WebAssembly:** reject before publishing/replacing a Wasm artifact until the exact pinned compiler/runtime proves Task ownership and guest-memory lifetime safety.
- **.NET:** reject before assembly/AOT publication until typed capture analysis, scheduler continuation lowering, and ownership lifetime enforcement exist.

A skipped test, zero-step workflow, parser-only rejection, or source-free model is not positive execution conformance.
