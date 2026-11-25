# AttoLang logical context storage — request, Task, actor (v1 proposal)

Status: **proposed design and executable-conformance requirements**, not implemented/parity-certified. New guest fixtures use `.atto`. Pthread TLS is a separate, already existing *host-side* capability, and is not the backing for these three scopes.

## Scope identities and meanings

| Guest API family | Storage owner | Ends at | Intended content |
|---|---|---|---|
| `RequestLocal<T>`, `RequestContext` | supervisor-minted HTTP request/stream generation | request terminal + fenced descendant work | trace ID, request ID, principal capability, request-specific data |
| `TaskLocal<T>`, `TaskContext` | logical Task incarnation | Task completion/cancellation/retirement | trace span, task settings, task scratch state |
| `ActorLocal<T>`, `ActorContext` | logical actor incarnation (actor id + generation) | actor FINALIZED | actor configuration, context, scoped cache handles |
| `ThreadLocal<T>` | physical OS thread | thread exit | native libraries, native scratch |

Do not implement RequestLocal/TaskLocal/ActorLocal with pthread TLS, Java ThreadLocal, .NET ThreadStatic, or Wasm-worker globals. The scheduler stores logical scope identity in its execution descriptor and restores the current logical view for every admitted turn/resumption. No *unsupervised* ambient request binding to an actor singleton is permitted: concurrently handled HTTP requests have different RequestContext instances even when their ActorLocal is the same.

## Typed API surface (proposed, NOT yet accepted syntax)

- `RequestContext.current() -> Option<RequestContext>`; available only during authorized request-scoped execution, including a still-live structured request child Task.
- `TaskContext.current() -> Option<TaskContext>`; available during a Task turn.
- `ActorContext.current() -> Option<ActorContext>`; available during an actor's own admitted turn; external pthreads do not inherit it.
- `RequestLocal<T>`, `TaskLocal<T>`, `ActorLocal<T>` are typed keys with `get()`, `with_value(fn)` and an owned `set()/replace()` where the scope permits mutation; never expose mutable borrowed references across suspension.
- `Scope.with_value(key, value, callback)` introduces dynamically scoped overrides, restored on normal exit, throw, raise, cancellation, and unwind. Async suspension resumes with the same logical override, independent of carrier thread.
- Key identities must be compiler-/runtime-minted with type identities, domain and generation checks. No guest-controlled integer slot can access another scope or reinterpret the stored type.

These APIs are not additional language keywords; they are typed core-library facilities. `RequestContext.current()` must fail closed outside a live request. A missing local value is Option/Result, never an uninitialized pointer.

## Propagation rules

1. **Within one request:** the handler and structured child Tasks get the same *request identity*. Immutable, explicitly inheritable request values may be viewed by descendants; their cancellation/deadline stays request-scoped. No detached Task may retain the request lease after finalization.
2. **Within one Task:** TaskLocal belongs to the Task and survives suspend/await/select and worker migration. Spawned child Tasks get *their own* TaskLocal store, with explicitly marked inheritable values copied/snapshotted at spawn, never an unqualified mutable alias. Overriding a child's value never changes the parent's.
3. **Within one actor:** ActorLocal belongs to the actor generation and is visible only to authorized actor turns. Multiple actor requests share actor identity but not request identity. ActorLocal persistent mutable data is still **sealed actor state**: changes must use `handle_state(critical-read |s| -> ...)` / `handle_state(critical-write |s| -> ...)`, or separately proven atomic/synchronized typed containers; ActorLocal is **not a back door** around these checks.
4. **Across ActorRef.send:** ambient RequestLocal, TaskLocal, ActorLocal, request authentication and response-writer capabilities are **not implicitly transmitted**. Send explicit, bounded, serializable context metadata in a typed envelope with supervisor-authenticated origin if needed. The receiving actor establishes its own turn-scoped context.
5. **Across isolates/process/network:** nothing ambient is inherited. Explicitly serializable fields need validation, quotas, transport provenance and generation fencing. No live response writer, principal capability, FFI pointer, mutable arena loan or local storage handle may cross as data.
6. **Across a native OS thread:** no implicit inheritance of logical request/task/actor context. Thread captures require `Send` (and shared references appropriate `Sync`/capability proof). Any allowed explicit snapshot is immutable, bounded and authority-reduced.

## Request context and HTTP

One request has a supervisor-minted identity containing tenant, isolate, request/connection generation, deadline, cancellation ticket and trace data; only some fields are guest readable. A request-specific response writer is an authenticated *revocable capability*, not a serializable local value or raw socket descriptor. On cancellation/disconnect/end it stops accepting work, even if a stale Task later resumes. An actor serving concurrent requests MUST resolve RequestContext from the currently admitted request turn, never by setting a mutable actor-global `current_request` field.

Streaming/WebSocket lifetimes are separately typed sessions: do not extend an ordinary HTTP request indefinitely by holding a pointer to its locals. The supervisor controls terminal state and descendants. A request scope cannot finish successfully until its structured child work is completed or cancelled and fenced.

## Storage vs arena ownership

Logical local values and heap allocation are different contracts. Each scope may have a bounded owned region: `RequestArena` for per-request scratch, `TaskArena` for per-task frames, `ActorArena` for actor-generation-owned persistent data. Scope completion revokes keys/capabilities then drops owned values exactly once and retires its arena only after claims, foreign callbacks and pinned loans quiesce. `Box<T>` can be moved into a scope if lifetime-safe; `Arc<T>` can hold `Send + Sync` immutable/shared backing under a separate lifetime proof. `dyn Trait` must not erase these auto-trait obligations. No borrowed RequestArena/TaskArena reference may escape its scope or cross await without compiler-proven pinning and lifetime.

For a concurrent request or actor, `RequestLocal<T>` / `ActorLocal<T>` do NOT grant unsynchronized mutable access. Read-only snapshots are convenient for propagation; shared writable state requires a checked `StateContainer<T>`/critical section, atomic primitive or explicitly synchronized owner.

## Backend parity design

- Java/Graal: bind logical scope handles in actor/task continuation metadata, not Java ThreadLocal as authority; deterministic cleanup on logical scope retirement; native-image metadata AOT generated.
- LLVM: logical context IDs and slot maps in execution/continuation/actor/request records with generation fences; actor/request arena drop after quiescence; never piggyback on `_Thread_local` scheduler carrier state as the owner.
- Forge/Cranelift and .NET Native AOT: same source-visible contracts with compiler-generated typed slot metadata; avoid reflection-dependent lookup.
- Wasm: same logical identities across workers; the absence of shared-memory threads must not change semantics. Unsupported transfers fail closed.

## Required compiler and executable conformance

All new cases live in `.atto`. At least:

1. Two HTTP requests concurrently served by the **same actor** have distinct request ids, mutable request state and cancellation.
2. One request suspends and resumes on a different carrier; RequestLocal survives, ThreadLocal does not follow it.
3. TaskLocal survives Task migration; child Task receives only the marked immutable snapshot; child override does not mutate parent.
4. A detached Task cannot use a completed request context or response writer, including following actor restart.
5. ActorLocal persists across actor turns but is erased on actor restart; old generation handles reject.
6. Direct mutation of sealed ActorLocal actor state outside critical-write is a compile error.
7. RequestLocal values never leak across ActorRef.send; explicitly serialized trace data is bounded and has validated origin.
8. Request cancellation and join-completion racing produce no double finalizer, stale wake, or leaked slot/arena.
9. Concurrent request-local mutable state is synchronized or rejected; no race hidden by scope-local terminology.
10. Native ThreadLocal remains independent of logical RequestLocal/TaskLocal/ActorLocal when the scheduler migrates work.
11. AOT builds for Java/Graal and .NET and native LLVM, Forge and Wasm execute equivalent source fixtures with known unsupported-platform cases clearly marked.

**Acceptance:** compiler-produced guest execution, exact backend head/tree/blob evidence, sanitizer/runtime tests and independent review. Docs, metadata checks, host-only mock tests, and source-free runner canaries are **not** guest parity evidence.
