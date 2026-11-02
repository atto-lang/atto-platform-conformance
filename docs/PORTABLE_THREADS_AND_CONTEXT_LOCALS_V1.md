# Portable OS threads and execution-context locals — v1 (AttoLang / Oreslang)

**Status:** proposed normative contract, **NOT_EXECUTED** on guest compilers. Host-only pthread tests do not prove AttoLang source compilation. The spelling below is an API proposal; no new declaration keywords are required.

## Three independent ownership/lifetime domains

| API | Logical owner | Where stored | Retirement |
| --- | --- | --- | --- |
| \`Thread.spawn\`, \`JoinHandle<T>\` | One OS thread | Host-managed native/runtime thread context | OS thread exits, all TLS destructors run, then join |
| \`task { ... }\`, \`Task<T>\` / \`Future<T>\` | One logical coroutine | Scheduler continuation, **not** OS TLS | Physical task quiescence after cancel/finish |
| \`define actor\`, \`ActorRef<T>\` | One logical actor | Actor-owned arena and sealed state | Supervisor seals mailbox and retires actor/arena |
| \`ThreadLocal<T>\` | Current admitted physical thread | TLS slot keyed by Thread identity | Slot destructor before thread completion |
| \`TaskLocal<T>\` | Current logical task | Task frame/context slot | Scope exit or physical task retirement |
| \`ActorLocal<T>\` | Current logical actor | Actor-private slot / state container | Actor physical retirement |

Tasks and actors **may migrate across OS worker threads**; their local values and scopes MUST follow their logical identities, never their carrier's \`ThreadLocal\`. Untrusted code cannot read carrier TLS. Host callbacks lacking an admitted AttoLang thread/task/actor identity return \`NoExecutionContext\`; they must not silently attach to the nearest context.

## Source-level API

\`\`\`oreslang
// Thread is a dedicated OS thread, NOT a coroutine, and requires thread capability.
// The closure is permitted only when the compiler statically lowers it to a named, non-suspending AOT entry with an owned `Send + 'static` capture-record argument. No executable closure is transported at runtime. All captures must be compiler-inspected; borrowed actor state, unsized/unknown/dynamic lexical environments and foreign callbacks fail closed.
let Box<dyn Worker + Send> worker = make_worker();
let JoinHandle<int> handle = Thread.spawn(
    ThreadOptions { name: "decode-0", cpu_affinity: Option.none() },
    rt take || -> int {
        thread_cache.set(Box<Decoder>.new());
        return worker.run();
    }
)?;
// From a Task or Actor, never block the carrier:
let int output = await handle.join_async()?;
// For approved foreign/blocking hosts only:
let int output2 = other_handle.join_blocking()?;

// Immutable task context binding is lexical and migrates with continuation.
let TaskLocalKey<string> trace_id = TaskLocal.key<string>();
let Future<int> f = task {
    return TaskLocal.with(trace_id, "request-7", || -> int {
        return compute();
    });
};

// ActorLocal requires an admitted actor turn; mutable values use sealed state gates.
// Within Actor's receive/owned methods:
let ActorLocalKey<int> count_key = ActorLocal.key<int>();
handle_state(critical-write |s| -> {
    ActorLocal.set(count_key, 3);
});
\`\`\`

\`Thread.spawn(options, closure) -> Result<JoinHandle<T>, ThreadError>\`. \`join_async() -> Future<Result<T, ThreadError>>\` is cancellation-safe: cancelling a waiter does **not** cancel/kill the OS thread, consume its join right, or free captures. One join winner consumes the result; extra attempts yield \`AlreadyJoined\`. \`join_blocking()\` is restricted to an approved foreign/blocking host or compiler-proven dedicated thread context; it must not park a scheduler carrier. A dropped handle is retained by its structured scope/supervisor for join, error reporting, and physical cleanup; **no silent detach**. Thread creation fails with \`UnsupportedCapability\` rather than secretly running as a Task. Thread options (affinity, name, stack size, NUMA and realtime class) are validated at admission; unsupported requested guarantees fail, never silently degrade.

\`ThreadLocal.key<T>()\` creates a typed key with bounded quotas. \`get()\` returns a scoped immutable loan, \`with_mut()\` a scoped exclusive loan and \`set(rt take value)\` transfers ownership; loans cannot escape the current physical thread or cross suspension. Runtime destructors release values in safe order before the physical thread terminates. Access to ThreadLocal from a migratable Task or Actor is rejected unless the compiler proves a non-suspending, explicitly pinned native-thread scope; **pinning cannot be inferred**. Key destruction must not invalidate live values. When thread creation fails, captured arguments/Box ownership roll back to the caller.

\`TaskLocal.with(key, value, callback)\` scopes a binding to that logical Task. Nested scopes shadow and restore, including throw/raise/cancel/defer. Child Tasks do not inherit task locals by default; a controlled explicit \`TaskLocal.snapshot(keys)\` may propagate only Copy/Clone/Send-safe immutable values at spawn. A task moving between carriers preserves its local context and does not touch the carrier TLS. Task locals cannot become thread affinity tokens.

\`ActorLocal<T>\` is per-actor private data, conceptually an actor-owned state slot. Its mutable access is fenced by actor turn identity, generation, critical-read/critical-write, and exclusive state-loan rules. Independent Tasks do not inherit it. Actor migration does not copy/reset the slot. Hot reload must explicitly migrate schema/version or reconstruct state; no stale actor-generation handle may access it. Actor destruction reclaims its arena after physical quiescence.

## Ownership / smart pointers / state containers

- \`Box<T>\` transfers a unique owned heap allocation at Thread launch only if \`T: Send\`, with exactly-once drop on completion or roll-back. A raw actor arena pointer is **not** Send.
- \`Arc<T>\` may be captured across threads only for compiler-proven \`T: Send + Sync\` and an allocation domain authorized for cross-thread atomic reference counting. \`Arc<Mutex<T>>\` or \`Arc<RwLock<T>>\` gates mutable access; \`Arc<T>\` alone does not.
- \`Rc<T>\`, an ordinary \`rt borrow\` / \`rt mut borrow\`, actor-state guards, mutable TaskLocal loans, and unsized dynamic values lacking proof are **not** thread captures.
- \`Box<dyn Trait + Send>\` may transfer; \`Arc<dyn Trait + Send + Sync>\` may share. A \`dyn Trait\` without explicit bound is not automatically Send/Sync merely because a concrete implementation is. Vtables, finalizers and dispatch remain valid across AOT backends.
- \`StateContainer<T>\` is not automatically Send/Sync/Share: owner-bound containers remain tied to Thread/Task/Actor owner and generation. Explicit shared containers must enforce lock/read-write authority, nonescaping references and shutdown fencing. Blocking a native lock inside a Task is forbidden unless it can suspend the continuation; wait-for graph and timeout policy required.
- \`ThreadLocal\`, \`TaskLocal\`, and \`ActorLocal\` must never magically make captured non-Send values Send or grant cross-tenant authority.

## Portability and backend rollout

Native LLVM/Forge may use pthreads on POSIX, Windows native threads on Windows; Java/Graal uses genuine platform threads, not Java virtual threads for \`Thread.spawn\`; .NET uses dedicated native-backed threads; Wasm requires host worker/threads capability and appropriate shared-memory/atomic support, otherwise \`UnsupportedCapability\`. \`Task\` remains coroutine work, even on platforms with no OS threading. No guest compiler may publish runnable artifacts until typed source capture/Send/Sync/locality checks and backend OS-thread creation/join/cleanup are proven at exact HEAD.

\`ThreadOptions.cpu_affinity\` and thread-owned state are intended to support locality, but OS TLS does **not** imply CPU pinning or NUMA memory locality. Actors/Tasks should use scheduler placement hints separately; over-pinning hurts work-stealing and throughput. GPU work stays in \`gpu task\` and device-fence lifetimes: a CPU thread does not directly grant device buffer ownership.

**Conformance evidence:** \`contracts/portable-thread-context-v1.json\` contains proposed guest-code tests with \`NOT_EXECUTED\` labels. Native tests prove only pthread reference-substrate behavior, not guest language acceptance, AOT, or five-backend parity.

## Single portable thread entry ABI (reconciled with draft #311)

`thread.spawn(named_entry, rt take arg, options)` is the fundamental ABI form. `Thread.spawn(options, rt take || -> R { ... })` is **strictly compiler-verified sugar**: it generates a non-suspending, statically reachable entry symbol taking one fully owned `Send + 'static` environment record. The resulting code/vtable/cleanup must be retained in AOT images, with atomic transfer on success and rollback to the caller on failed admission. A dynamic function or closure cannot be accepted as an entry unless its complete target and capture layout are known at compile time; `Task`, actor channels and `Topic<T>` must not carry the closure as data. `join_async` and suspending `join()` are equivalent non-parking observation surfaces; `join_blocking` requires explicit dedicated native-thread proof and cannot park actor carriers. No backend is entitled to mark these candidate APIs implemented until real guest source compiles and executes at an exact head.
