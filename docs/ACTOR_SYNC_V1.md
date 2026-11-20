# Oreslang Actor Sync v1 — canonical five-backend conformance candidate

Status: **candidate-unattested**. The canonical 24-case inventory lives in [`contracts/actor-sync-v1.json`](../contracts/actor-sync-v1.json). This document is a normative proposal to review alongside existing virtual-actor (VA), persistence-sidecar (PS), and Cloudstate/Akka (CL) contracts, not a declaration that the native guest ABI has shipped.

## Semantic contract

An existing explicit `spawn` actor is a real supervised actor with a concrete incarnation. Optional virtual resolution adds a stable `ActorKey=(trusted_tenant, namespace, actor_type, object_id)`; it does not convert `spawn` to virtual or permit an actor's isolated heap to be shared. A virtual actor has zero or one live **authorized writer**. It may have many eventually consistent read-model subscribers. Activation is transient; logical key persists across deactivation, migration and restart.

A source-level guest actor uses `define isolated actor ... as ... end`, sealed `state`, and non-reentrant `handle_state` with `critical` synchronization. A `suspends fnc` may acquire a `critical` section asynchronously, but its body cannot suspend. No `async` method modifier or `critical suspends fnc` is allowed. A delayed continuation must revalidate its actor/incarnation/lease state **before** any commit.

A durable mutation must be expressed as typed input, deterministic state transition, and an explicit persistence effect, not an unguarded mutation of shared-memory state. The provider commits revision CAS, operation-id/idempotency result and the outgoing change record in a single serializable transaction. The actor cannot externally announce completion before the configured commit boundary. On timeout after an uncertain commit, return `OutcomeUnknown` with stable operation identifier, not a false failure that encourages duplication. Network publishing is **at least once**; external effects require idempotent consumers.

A snapshot includes actor key, epoch, revision, schema fingerprint, and owned encoded state. A subscription cursor is a **revision** in the same actor key's committed log, not a native address or OS stream offset. The changefeed must be bounded in entries and bytes and support async cancellation. A new subscriber takes an atomic checkpoint and then streams revisions **strictly after** that checkpoint; when compaction renders its cursor unavailable, report `ResyncRequired` and require an authenticated fresh snapshot. Projection state + acknowledged cursor are committed atomically. Replica reads carry an explicit staleness mode; default authoritative writes remain single-writer.

An activation epoch is a **fencing token**, not proof of distributed consensus. A local SQLite/POSIX lock cannot elect a single writer across machines. Production multi-host writes must be gated by an authorized durable lease owner plus a transactional epoch comparison. When ownership is uncertain because of partition, refuse strong writes. Actor-owned heap pointers/borrows never appear in snapshots, messages, outbox blobs or cross-tenant handles.

## Versioned ABI sketch (not yet accepted source syntax)

- `resolve_virtual<T>(tenant-scoped namespace, actor_id) -> ActorRef<T>` requires an authenticated principal and activation capability. No caller-supplied raw tenant identifier grants authority.
- `call(actor_ref, command, operation_id)` is asynchronous and returns typed `Result<CommitReceipt, DurableError>` including possible `OutcomeUnknown`.
- `snapshot(actor_ref, read_consistency) -> Result<Snapshot<T>, DurableError>` returns copied, authenticated data.
- `watch(actor_ref, after_revision, bounded_budget)` exposes a cancellable, typed async iterator; stream transport is backend-specific.
- `persist_effect` is a compiler-checked sealed-state transition effect, not a callback allowed to perform I/O inside `critical`.
- CRDT active-active must use audited explicit types, separate from normal single-writer mutable actor fields. No implicit LWW merge or clock-based consensus.

Until parser/typed lowering and source guest execution are shown on each backend, spellings here are **conceptual** and the conformance ledger records `NOT_EXECUTED` or `UNSUPPORTED`.

## Canonical envelope

```text
version | authenticated-tenant-capability | logical-actor-key |
activation-epoch | actor-incarnation | operation-id | revision |
schema-fingerprint | bounded-serialized-payload | optional-reply-receipt
```

The payload does not grant identity. Validate lengths, schema, tenancy, capabilities, epoch, and model before allocating actor-owned buffers. No borrowed guest references may escape into an asynchronous host continuation or storage sidecar.

## Evidence: host-only vs native guest

The [Durable Objects PR #11](https://github.com/ores-truffle-oreslang/oreslang-durable-objects.ores/pull/11) contains a trusted local SQLite WAL host reference, two-process sync, cursor/resync and fencing work. It is a useful *storage* slice but does **not** prove any of the AS01–AS24 cases executed as native `.ores` across all backends. It also lacks multi-host leases, a real broker and production auth.

**Five independent backend gates:**

| Backend | Current constraint | First native acceptance |
| --- | --- | --- |
| Java/GraalVM | actor scheduling exists; guest durable sync adapter pending | source actor → async persistence effect → committed reply/recovery |
| LLVM | source actor/OresVM slice exists; durable actor ABI integration pending | native actor owned heap + transaction bridge + stale epoch rejection under sanitizers |
| Wasm | persistent actor/host broker contract, but source guest path still pending | sandboxed Wasmtime tenant activation + capability-only host imports |
| Cranelift | scalar-only JIT, source actors explicitly rejected | actor IR/ABI and isolation before enabling sync; keep unsupported |
| .NET Native AOT | actor runtime host facilities; full source guest adapter pending | source actor lowering + native AOT durable turn and replay receipt |

Do not claim `PASS` from host-only C++/Rust/JS/Python unit tests, syntax rejection, an unexecuted workflow, or another backend's compiler. Every positive receipt requires an exact source head/tree, fixture hash, compiler/runtime SHA-256, nonzero job steps, exact observed guest oracle and raw logs. The static inventory verifier guards metadata consistency but **cannot authenticate or reproduce an arbitrary URL/log receipt**. Independent review must validate these.

## Delivery dependencies

1. Finish storage host reference audits: outbox/consumer quotas, idempotency, atomic projection replay and crash/fault cases.
2. Ratify typed effect/ABI spelling in Oreslang's core grammar, preserving current explicit actor semantics.
3. Java/GraalVM first guest vertical slice, then LLVM guest+sanitizer; each must pin exact head and execute real guest.
4. Wasm/Wasmtime, .NET Native AOT and Cranelift implementations independently; Cranelift requires prior actor support.
5. Run the AS01–AS24 cases against **identical guest fixture bytes**, negative oracle and fault harness, proving cross-backend semantic behavior. Keep draft until stepful CI and independent review, including no unauthorized private source transfer.

## Source module milestone (2026-11-01)

The [Java/Graal source-progress draft PR #2442](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2442) implements `stdlib/actor_sync.ores` in native Oreslang. It is **local metadata behavior** only: `CommitWindow` for uncertain durable receipts and `ReplicaCursor` for strict sequence/gap/epoch checks. The source does not perform storage I/O, activate real actors, authorize callers or publish a changefeed.

The canonical copy is `fixtures/actor-sync-v1/stdlib/actor_sync.ores` (Git blob `3aae079ffe3be8bc2eb2b77bacbd6bddf7e1ce65`). The executable guest input `fixtures/actor-sync-v1/cursor-progression.ores` (Git blob `a454e7107ab62bbaa38cca44627c794b3bf0d4c2`) is **byte identical** to the Java PR test resource. `fixtures/actor-sync-v1/manifest.json` pins both hashes, expected stdout and distinct NOT_EXECUTED/UNSUPPORTED backend states. Java JUnit exercises the guest source through `LinkedProgramRunner`, but its hosted checks have not executed due to CI runner admission.

Keep AS01–AS24 marked NOT_EXECUTED/UNSUPPORTED because the fixture proves, at most once executable, portable *cursor semantics*, not real durable actor activation, authenticated persistence or network synchronization. A complete guest ABI additionally needs the full asynchronous storage, supervision and tenancy semantics in the preceding sections.

The Java userland module deliberately uses signed 32-bit `int` revisions, capped at 2147483646; the native SQLite reference stores 64-bit revisions. Cross-toolchain ABI numeric widths and overflow behavior **must** be reconciled before native persistence can be marked interoperable.

## AS25 — durable observed-epoch fencing, and .atto target

AS25 requires every backend to persist the **maximum observed actor generation** when a newer-epoch event is encountered, prevent any further stale/current delta or projection read, survive reopening and process crashes, and require an independently authenticated complete snapshot with epoch at least that maximum before lifting the fence. No backend currently has an executed AS25 guest receipt. The C++ SQLite reference adds a staged legacy-schema migration and fail-closed handling for old poisoned projections without a recorded required generation, but it is not guest parity evidence.

`fixtures/actor-sync-v1` contains three canonical transitional `.ores` programs and byte-identical `.atto` versions (including the stdlib source). Each `.atto` file has the same Git blob as its `.ores` counterpart; `manifest.json` pins both and marks AttoLang extension execution **NOT_EXECUTED**. The public source extension target is `.atto`, and no backend receives a `.atto` PASS from compiling old `.ores` files. The source-free contract checker now requires 25 semantic cases across five toolchains.
