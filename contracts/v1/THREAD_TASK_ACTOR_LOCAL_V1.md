# THREAD_TASK_ACTOR_LOCAL_V1 — AttoLang native threads and scoped state

Status: **DRAFT target contract (2026-11-01)**. This file is a language/runtime acceptance target, not implemented compiler intrinsics, pthread support, or guest-parity evidence. AttoLang is the canonical language name and `.atto` is its canonical source suffix. Oreslang repository, ABI and schema names remain compatibility identifiers during migration.

## Decision

Expose an OS-thread abstraction in **AttoLang source**, independent of Java or pthread naming. `std.thread` creates a real platform thread when supported; `std.task` creates a *logical coroutine/continuation*, which may migrate between carriers. The compiler emits calls into a small target-dependent VM thread ABI. Never implement a promised OS thread by creating only a Task, a virtual thread, a coroutine, or a blocking-I/O wrapper.

For POSIX platforms, the LLVM/Cranelift native adapter can use pthread_create/join plus platform TLS, with pthread-specific types kept private. Windows uses its supported platform-thread bootstrap, GraalVM/JVM a real platform thread, and .NET NativeAOT a real runtime-attached OS thread. Wasm may offer threads only when the **embedder actually supports creation, shared memory, and atomics**. Otherwise return Unsupported **before** allocating any virtual thread or worker. A thread created for a tenant must be registered with its IsolateVM lifecycle before executing user code; it never grants actor execution authority.

## Target AttoLang `.atto` source API (illustrative; compiler lowering NOT YET VERIFIED)

    define module example as
      pub fnc calculate(Box<Job> job): int {
        return job.compute();
      }

      pub suspends fnc run(Box<Job> job): Result<int, ThreadError> {
        // calculate is an AOT-resolved *entry symbol*, not a transported closure.
        const Result<JoinHandle<int>, ThreadError> created =
          thread.spawn(example.calculate, rt take job, ThreadOptions.default());
        const JoinHandle<int> handle = created.expect("thread admission failed");
        return await handle.join();
      }
    end

Normative surface:

- `thread.spawn(entry: StaticThreadEntry<Arg,R>, rt take arg: Arg, options: ThreadOptions) -> Result<JoinHandle<R>,ThreadError>` requires Arg: Send + Owned + 'static and R: Send + Owned + 'static. The entry lowers to an **AOT-resolved non-suspending function symbol** with exactly one owned argument: either an explicitly named function or a **compiler-synthesized static function** for a statically known `rt take` closure. An owned closure is only surface syntax: the compiler moves its explicitly audited capture environment as the ABI argument and retains the generated entry's machine code, type layout, cleanup, and checked ABI. Dynamic function values, runtime code loading, borrowed captures, actor state, and unverified Send/Sync witnesses are rejected. This does **not** make closures legal in channels or pub-sub.
- `JoinHandle<R>.join_async() -> Future<Result<R,ThreadError>>` (with `join()` as a suspending source alias): never parks an actor carrier/critical body; returns one terminal result or panic/exit error; a concurrent second join is rejected. Cancelling an awaiter does not consume the join right. `join_blocking()` is available only in compiler-proven dedicated/foreign blocking-thread context, never an actor/task carrier. A join handle is affine, not serializable or Sendable actor-message data.
- `ThreadGroup` / `thread.scope` owns all handles and mandatory physical join/drain before resource deallocation. There is no unsafe forced thread kill or fire-and-forget detach in v1. Cancellation is a request via a generation-fenced `StopToken`; physical thread exit and destructors are separately witnessed.
- `thread.current_id() -> ThreadId` is observational, opaque and incarnation-fenced; it never grants ownership or access. `ThreadOptions` has bounded stack/name/priority hints and an explicit tenant admission budget. No realtime guarantee or CPU-core pinning inferred from hints.
- `thread.is_supported() -> bool` is an informative capability query. `spawn` must still independently enforce quota, permissions, target capability, and current IsolateVM generation. Quota exhaustion or unsupported platform returns a typed error; no silent Task fallback.
- Spawning from an actor must be explicitly authorized and quota bounded; actor mutable state must NOT be borrowed into a new thread. Host callbacks/foreign POSIX threads cannot execute guest actor code without VM attach and fresh scheduler admission.

## Three local-storage domains, not one

| Domain | Owning lifetime | Migrates on await? | Mutable access | Cleanup |
| --- | --- | --- | --- | --- |
| `ThreadLocal<T>` | Physical OS thread + VM attach incarnation | **No**; different on next carrier | Only on owning physical thread | Thread exit, before VM detach |
| `TaskLocal<T>` | Logical Task + continuation generation | **Yes**, carried in scheduler frame | Task-owned lexical/scoped access; no escaping borrow across await | Task physical completion/cancel drain |
| `ActorLocal<T>` | Actor incarnation + actor-owned arena | Independent of carrier | Only through authenticated actor turn/critical state gates | Actor STOP and quiescent retirement |

`ThreadState<T>` is a thread-owned mutable state container (a declared/injected owned value, *not* a magic shared variable). `TaskState<T>` and `ActorState<T>` have their corresponding owners. Proposed `@State(scope=THREAD|TASK|ACTOR)` may generate typed accessor keys, but compiler must check each declaration; annotation alone never makes an unsafe type transferable or provides runtime authority. Prefer ordinary explicit actor `state` + `handle_state` for durable business state. A restart creates a *new actor-local table*, never revives the old incarnation.

Local APIs must use declared typed static keys and checked generation/owner provenance; an arbitrary string, user integer, trace ID or caller-supplied actor ID cannot address someone else's slots. Define initializers and destructor/drop order explicitly; forbid ambient auto-inheritance by new thread, detached Task, unrelated actor, or supervisor restart. Structured Task children may **explicitly copy** immutable Sendable values; sharing a mutable TaskLocal box or RequestLocal authority is forbidden. A RequestLocal/HTTP exchange remains a *fourth*, separate logical scope, as specified in draft PR #248; do not secretly alias it to TLS.

A migratable Task must never store a physical TLS reference or a borrowed ThreadState pointer across suspension. A thread-pinned synchronous worker may use ThreadLocal directly, but a Task executing on that thread has no guarantee of returning to the same thread after await. Non-Send TaskLocal values require a separately verified pinned-task execution mode, which is **out of scope v1**. ActorLocal never allows arbitrary external thread access simply because that thread previously carried the actor.

## Ownership, data and concurrency rules

1. `Box<T>`: unique ownership moves at spawn only when T: Send; no alias survives the move. The spawned thread owns cleanup, with exact transfer receipt if spawn succeeds; on spawn error the caller retains the original owned argument (no partial move). The result moves through join only.
2. `Arc<T>`: shared atomic reference counting does **not** synchronize T's interior. For cross-thread transfer, require T: Send + Sync, or an explicitly proven synchronized container (such as `Arc<Mutex<T>>` with correct bounds). Maintain last-release lifetime/finalizer and VM attachment safety; do not treat Arc as a serialized message.
3. `dyn Trait`: only `dyn Trait + Send` transfers by unique ownership; a shared `Arc<dyn Trait>` also needs Sync. Compiler verifies every concrete implementation and AOT vtable/witness; unverified FFI objects, borrowed trait objects, captured lexical environments and forged witnesses are rejected. Dynamic dispatch itself is not a permission grant.
4. `StateContainer<T>`: binding to THREAD, TASK or ACTOR changes *ownership*, not Send/Sync. Actor-owned heaps/arenas cannot be smuggled into worker threads via Box/Arc/dyn; take an explicit immutable data snapshot and cross the permitted boundary. Thread-owned state is not directly inserted into actor state or channels. Even a correctly synchronized Arc is never an automatic cross-tenant or cross-IsolateVM capability; isolated heaps require explicitly permitted copied/snapshotted transport.
5. `thread.spawn` is a **code-and-data** boundary, not a message channel. The named entry symbol is never stored in a message. Actor channels and in-memory pubsub remain **data-only**: no closure, function value, lexical environment, vtable authority, thread handle or state-cell alias. Thread transfer requires Send and ownership; *actor/message transfer additionally* requires allowed transport shape (owned immutable copy, serialized/snapshot value or verified special transfer capability), not Send alone.
6. Locking must be explicit. No implicit operator overloading, implicit conversions, compiler-synthesized unsafe shared state or implicit Future/Option flattening. `critical {}` body cannot suspend; `join` and other potentially suspending calls are forbidden inside it. A thread may block on its own explicit synchronous operations, but actor carrier threads must not park to implement join/cancellation/admission.
7. Every thread, Task, actor and isolate has separately generation-fenced identity; reused OS thread IDs or arena pointers must never validate a stale state key. A failed spawn, panic, cooperative cancellation, exception, tenant retirement or supervisor restart must release allocations in reverse appropriate lifetime order and never execute guest cleanup on an unauthenticated callback thread.

## Backend admission / portability

- Java/Graal: JVM hosted and Native Image must prove **platform** thread creation, AOT entry reachability, correct isolate attachment, quiescent shutdown, and no lexical Java host objects in guest data. Do not assume Java VM heap isolation is native actor heap isolation.
- LLVM and Cranelift: POSIX `pthread_create`, `pthread_join`, `pthread_key_*` are implementation details; Windows uses a compatible OS bootstrap. Native thread state and Arc atomics require sanitizer-backed lifetime/race tests. Physical isolate/actor arenas retain their existing separation rules.
- .NET NativeAOT: use an explicitly attached OS/runtime thread with NativeAOT-compatible entry thunk; test NativeAOT binary, not a hosted-only CLR simulation.
- Wasm: capability-gated host spawn, shared linear memory/atomics, lifecycle/worker policy, and native guest proof. No assertion that a generic single-thread Wasm engine supports pthreads; fail closed on unconfigured or unsupported runtimes.
- All backends: target Linux/Windows/macOS where supported, bounded thread capacity, fail-closed unsupported target, no fabricated compiler receipts. AOT first; do not require runtime compilation or reflection to resolve a thread entry.

## Required exact-head test matrix

Compiler positive: named entry + moved Box<int>; statically known `rt take` closure lowered to an AOT entry + owned Send capture record; named entry + Arc of synchronized state; dyn + Send witness; owned join result; TaskLocal survives await/carrier change; ActorLocal survives carrier change but not restart; ThreadLocal belongs to same OS thread.

Compiler negative: unlowerable/dynamic captured closure; borrowed or actor-state capture in any closure; function in channel/pubsub; borrowed stack value; Box of !Send; Arc of !Sync; dyn with no certified witness; forged state-container scope; ThreadLocal borrow across await; actor heap reference to worker; `join` inside critical; unbounded spawn from unpermitted actor; suspended thread entry.

Native runtime: 2/8/32 threads with quotas and bounded admission; single-join terminal race; cooperative cancellation vs join; thread exit destructor order; OS TLS isolation with physical thread-ID reuse; task migration; actor restart; isolate retirement; panic during cleanup; concurrent Arc final release; compiler-produced guest executable. Use actual controlled carrier migration and OS thread observations, not merely labels in a reference model.

Evidence categories: contract/static checks; host-only native thread/Arc tests; compiler admission diagnostics; compiler-generated **guest** execution receipts. Record exact source tree, compiler binary digest, executed job steps and logs. Empty/null steps are NOT_EXECUTED, not a passed test. This draft makes no parity claim.

Related: conformance PR #248 (request/actor/task context), PR #118 (Send/Sync and carrier model), PR #292 (critical/suspends); production compiler changes must reconcile those interfaces rather than replace their ownership rules.

## Reconciliation with portable-thread/context PR #312

Both `thread.spawn(named_entry, rt take arg, options)` and `Thread.spawn(options, rt take || -> R { ... })` are candidate source spellings for the **same static AOT thread-entry ABI**. The latter is accepted only when the compiler can emit an ordinary non-suspending entry function with a statically laid-out owned `Send + 'static` environment, retain it under AOT tree-shaking, and enforce exact-once move/rollback and drop. Captures are never executable values transported through actor channels, Topic<T>, or pub-sub. If those compiler checks are absent, reject the closure form; do not silently interpret it via dynamic host callbacks or Tasks. This is a target-only compatibility decision, not executed backend support.
