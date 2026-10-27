# Future<T> ↔ Task<T> interoperability — cross-backend contract v1

**Status:** proposed source-language and runtime conformance; **NOT IMPLEMENTED OR VERIFIED** by this document. Every compiler/runtime vector begins `pending`. Treat unsupported syntax as `unsupported`, not `pass`.

Tracks conformance issue #152, Java task #1468, Java Future constructor #1676, Java host Task projection #1379, LLVM Future constructor issue #742, and task composition contract in Java `docs/FUTURE_TASK_COMPOSITION_V1.md`. This v1 is normative for proposed behavior, not evidence that any backend supports it.

## Model

* `Task<T>` is an *already-admitted*, scheduler/domain/scope-owned computation; `task { ... }` and `nb { ... }` are eager. The Task has cancellation and an **independent physical-retirement witness**.
* `Future<T>` is a single-completion *result/observation*, **not** a job, a thread, or a proof that the producer physically stopped. It can be awaited, selected or combined without creating a task.
* `TaskStep<T>` is a **lazy, single-use** factory. Never infer serial or deferred execution from an already-running Task or Future.
* A scheduler may use bounded carrier threads, but no conversion may start a dedicated OS thread or a new pool. An `await` suspends cooperatively and resumes on the adapter Task's admitted scheduler/domain. A completion thread never runs guest code.
* Every task stays in its structured owner scope (or supervised detached owner) until physical quiescence, regardless of whether its public Future settles or a consumer cancels its observation.

## Proposed canonical guest surface (snake_case)

| Expression | Type | Scheduling | Ownership of upstream work |
| --- | --- | --- | --- |
| `Future.from_task(task)` | `Future<T>` | **zero new Tasks**; projects one result | originating TaskScope still owns Task |
| `task.as_future()` | `Future<T>` | same as `Future.from_task` | same; source alias, if admitted |
| `Future.new(task { return value; })` | `Future<T>` | **exactly one** eager Task | creating TaskScope |
| `Task.from_future(future)` | `Task<T>` | **exactly one** small waiter Task | adapter's TaskScope owns only adapter; not upstream producer |
| `Task.from_future(future, scope)` | `Task<T>` | same, explicit admitted scope/domain | adapter scope, not upstream producer |
| `task.get_done()` / `scope.get_done()` | physical-lifecycle observer | zero | required for safe memory reclamation |

The names above are **proposals**. The historical Java host `OresTask.asFuture()` returns the same *cancelable* `OresFuture`. **Do not expose that host method as a cross-domain read-only guest projection.** If retained for host compatibility, gate it behind explicit ownership/cancellation authority. The guest snake_case projection must be non-owning by default.

### Task → Future: result projection, not another task

```oreslang
let Task<int> t = task { return 42; };
let Future<int> f = Future.from_task(t);
let int value = await f;
```

Return/failure/cancellation classification and trace context originate from the one Task; no nested `Future<Task<T>>` or `Future<Future<T>>` is synthesized. Do not add an actor hop, OS thread or new TaskScope to implement this. Observer cancellation/detachment **never** cancels the Task unless a separate, authenticated, explicitly transferred cancellation capability is supplied. `Future.cancel()` on this view cancels **the view**, detaching its listener; it must not cancel the underlying producer. The source Task and its scope remain alive and independently observable.

The parser may admit `Future.new(task { return ...; })` as a constructor overload equivalent to the projection above. One Task is created by the `task` expression, not two. Bare `new Task(|c| -> ...)` is **not** an alias for a task block; Task is not a callback-completer constructor.

### Future → Task: dependent awaiter, not replay

```oreslang
let Future<int> source = obtain_async_future();
let Task<int> dependent = Task.from_future(source);
let int value = await dependent;
```

`Task.from_future(f)` admits one bounded, tracked Task equivalent to `task { return await f; }`, but with implementation-owned private waiter registration and safe handling of already-settled Futures. It does **not** re-run the producer, assume the Future is cold, or create a dedicated thread. When `f` settles, the adapter's continuation resumes on the adapter's scheduler, never on the producer's I/O/timer/callback thread.

If the adapter is cancelled, it detaches only *its* waiter and physically retires the adapter. It must **not** cancel `f`'s independent producer. The adapter's `get_done()` cannot serve as an upstream producer's physical-retirement certificate. If no owner for the upstream producer exists, a typed scoped adoption API must demand an authenticated unique ownership+retirement capability or reject; do **not** invent it from `Future<T>` alone. Foreign-domain Futures require explicit Send/Sync/permission checks and approved destination scheduler admission.

### Result ownership and completion authority

One affine/move-only `T` must never be consumed twice through `t` and its projected `f` (or through a round trip). Lowering must preserve **one result consumption claim** across all aliases. For Copy/shareable `T`, checking may permit multiple observers; for affine `T`, require an exclusive move of the result claim (e.g. consuming `rt take t` / `rt take f`) or reject until a checked projection exists. A Future wrapper never duplicates payloads, foreign capabilities, or ownership permits.

A `task { ... }` body resolves by **returning T** (or throwing a checked error), not by invoking `c.done`. Callback-based `Future.from_callback(|c| -> ...)` is a *separate* one-shot resolver API: callback resolve/reject/cancel authority belongs to that asynchronous operation and must be revoked on terminal settlement; returning from the callback registrar does not settle it. If its callback starts a Task, Task cancellation, scope and source-callback lifetime must be owned and tracked explicitly.

Cancellation is not inferred from a user-thrown CancellationException. Preserve authenticated CANCELLED vs FAILED (including an ordinary thrown cancellation-named error), success and value type. Untrappable panic still routes through supervisor CONTROL and must not be converted into an ordinary rejected Future. Guest callback execution must remain scheduler/actor confined; no callbacks under lifecycle monitors. Cancellation plus defer/finally/lock release must finish before `get_done()` can assert safe reclamation.

### No unsafe implicit coercions

- No implicit `Future<T>` ↔ `Task<T>` subtype relation; both directions use explicit checked adapters.
- No implicit nested flattening: `Task<Future<T>>` and `Future<Task<T>>` remain distinct.
- No unproven numeric conversion or Unknown/nested-generic erasure between `T` and requested output type.
- No synchronous host `get/join` on a scheduler or actor carrier; use `await`.
- Cycle detection remains mandatory, including `t` observing a Future derived from itself and cross-scheduler cycles.
- Actor mutable sealed state, borrowed stack loans, thread-affine locks and foreign handles cannot flow through the bridge without ownership, generation and suspension proofs.
- `Future.from_task` must not invent detached supervision and `Task.from_future` must not bypass queue/credit, scope cancellation, wall-clock quotas or hard-real-time admission.

## Acceptance matrix and exact-head evidence

Machine-readable vectors: `fixtures/future-task-interop/v1/manifest.json`. Proposed source examples in the same directory are **not certified parser passes**.

Required checks across **java/graalvm, llvm, wasm, forge, net** (embedded only when profile admits scheduler Tasks):

1. Task→Future and Future→Task success, void, failure, authenticated cancellation, panic; do not run an extra producer.
2. Already-completed Future and late completion; attach/detach/cancel races; at most one producer and one adapter admission; no subscriber leak.
3. Two consumers of an affine result must fail type checking (or be guarded by one exclusive compiler-proven claim); no double moves.
4. Cancelling a projected Future leaves original Task running; cancelling the adapter leaves upstream producer running; owner-scoped cancellation revokes both where separately owned.
5. A Task may report terminal Future result while physical cleanup is pending; only original producer's `get_done` authorizes arena/borrow reclamation. STOP/hot-generation swap must join actual producer quiescence.
6. No guest continuation on callback/I/O/timer completion carriers; bounded scheduler admission, progress with **one carrier**, and no deadlock when Future resolves synchronously during registration.
7. Reject self-await/cycles, missing Send/Sync, actor state escapes, wrong generic type, unsupported profiles, cross-generation handles.
8. True native **full AOT** (LLVM executable; Java/GraalVM Native Image), plus source-level parser/type/effect/ownership negatives and sanitizer verification. JVM interpreter-only or host-only tests do not prove source parity.

Per vector, require repository and exact commit/tree SHA, source fixture SHA, compiler binary version, executor/profile, result and normalized trace, executed test command, runner ID and real steps, ownership/quiescence receipts, and explicit PASS/FAIL/UNSUPPORTED/INFRASTRUCTURE_ERROR. Keep all `runtimeVerified=false` flags until evidence exists. No private source cross-org replication without the repository's reviewed authorization gate.
