# Safe pre-emption, actor re-entrancy, and async generators — contract v1

**Status: normative proposed compiler-admission rule; backend verification pending.** The JavaScript tests in this PR are a **policy/state-machine model**, not Java/GraalVM, LLVM, Wasm, or browser integration tests. Do not interpret a green model test as language-runtime parity.

## Physical carrier pre-emption is NOT actor re-entrancy

Pre-emption releases a worker/carrier for another runnable task. Re-entrancy admits a different invocation into the *same actor* while a former invocation has not logically completed. Both require continuation support, but pre-emption does not grant re-entrancy. In particular:

- A **serial actor** has exactly one actor-wide admitted HTTP/message handler until logical completion, including the duration of await, channels, generator activity, and rt cooperate. Do not call receive() for another message merely because the first handler parked.
- An **ordinary actor** may someday permit separately proven re-entrancy on a pending await, but not automatically on budgeted cooperation, not under live state loans or critical tickets.
- An explicit cooperate or automatic quantum handoff retains the logical actor turn and prioritizes the resumed continuation over subsequent actor DATA messages. An independent actor or requester may use the released carrier immediately.

## Single proof rule for every suspension site

A compiler may lower await, *_blocking, readch, writech, select, rt cooperate, budget probes, or generator emission into an actual handoff **if and only if**:

1. The affected guest frame *and caller chain* are continuation-lowered into heap-owned state: program counters, evaluation stack, locals, iterator cursors, exception/defer/finally stacks, move/drop flags, task/actor identity and budgets. Never pretend an ordinary JVM/native stack can be resumed elsewhere.
2. The handoff is at an **instruction commit boundary**. No partly applied state mutation, half-move, queue registration, native call, destructuring assignment, effectful callback, or exception transition. Resume at the distinct successor PC; do not replay a committed side effect.
3. No live unsafe borrow, mutable projection, ephemeral receiver, MutexGuard, actor-state Access, unsuspendable native frame or ordinary synchronous critical scope crosses the boundary. A logical suspend-critical ticket is not equivalent to ownership of the data it protects.
4. Completion, exception, cancellation, timeout, and close converge on **exactly-once cleanup**. If finally/defer cleanup can suspend, its own continuation and finalizer protocol must first be proved. Until then, reject explicit suspension in unlowered cleanup and defer automatic handoffs there. The language's independent rule forbidding return directly inside finally still applies; a nested callable can return from its own body.
5. Logical fuel, reductions, wall/CPU quota, cancellation, priority, actor incarnation and security context persist across physical carriers. For UNTRUSTED tasks, unproven continuity forbids handoff, including indirect await paths, rather than refreshing a per-carrier budget.
6. A single execution lease prevents two completions from resuming the same task. Publish a runnable continuation **only after** the prior guest/Truffle/actor carrier has fully unwound. Cancellation before physical exit must delay physical resource release.
7. Suspension effects are checked transitively through imports, callbacks, generics, dynamic calls and *_blocking library wrappers. Ordinary non-suspending functions may not gain a hidden yield.

**Fail-closed rule:** an explicit suspension without the proof is a compile-time error; an automatic pre-emption probe that cannot satisfy it is a cancellation/quota-only checkpoint. An OS Thread.yield call is never a guest continuation.

## Hybrid reductions plus monotonic time

The runtime charges task-local, weighted reductions at executed calls, allocations, loop backedges and known-cost intrinsics. At compiler-proven probes, a reduction threshold **OR** elapsed monotonic time threshold requests a scheduler handoff, provided another task is runnable. The time source is sampled at bounded probes; it does not interrupt guest code. An explicit rt cooperate requests its own handoff and should not depend on a quantum threshold. Already-ready await/channel/select need not park physically, though effects must still be legal.

Initial Java documented defaults are 512 backedges / 2 ms checked every 32 ordinary loop backedges, and 128 / 1 ms checked every 16 explicit cooperative loop backedges. Benchmark 500 / 5 ms as an alternative profile; do not change constants without measuring fairness, throughput, JIT/GC and instrumentation overhead. Treat all targets as *soft*, not guaranteed hard pre-emption deadlines.

Compiler insertion sites: only a post-commit loop backedge, already-lowered statement boundary, lowered intrinsic, or a continuation/trampoline recursion boundary. A tight non-tail recursive function may have many pending frames; it cannot be safely pre-empted at arbitrary recursion depth until those frames are heap-lowered. A tight native/FFI call cannot be made pre-emptible by a nearby poll. A *_blocking call must use an actual asynchronous I/O path or isolated blocking executor, not block an Oreslang scheduler carrier.

## Channel/select race linearization

readch/writech/select registration and parking must be an atomic handshake. Resolve ready-before-park, close-before-park, cancel-before-park, timeout-before-park, and concurrent completion exactly once. Losing select arms must relinquish registrations without consuming a message. A parked writer retains ownership of its message and bounded resource credits until the documented linearization/acknowledgement point.

## Async generators: distinguish three yields

- **rt cooperate** yields the carrier while keeping the same logical generator/task.
- **await/channel/select** suspend waiting for another operation to become ready.
- **generator yield VALUE** publishes one item and parks until a consumer demands the next item. It is a demand/backpressure protocol, not permission for a second producer or actor handler.

One generator has at most one active producer pull; concurrent next() calls must have a defined reject-or-bounded-queue policy. Every element is emitted exactly once with an immutable result snapshot. close(), cancellation, iterator drop, parent actor stop, delegated yield*, pending next() and source exception converge on one finalization state. A close racing with an active producer may request cancellation, but physical disposal waits for producer carrier exit; never skip suspended finally/defer. Preserve the primary exception with cleanup failures suppressed, never replace it.

## Test gate / current source audit

Required real-backend tests: nested loops and break/continue; imported callback suspension; tail and non-tail recursion; forced pre-emption at every legal PC; exactly-once writes; carrier migration and runnable peer fairness; critical/borrows/guards; HTTP + mailbox serial admission during await; wake-before-park for each channel/select outcome; UNTRUSTED quota continuity; generators with nested yield*, blocked next(), cancellation while suspended in finally, and physical producer exit; JVM JIT/Native Image AOT/hybrid and LLVM source-lowered execution with race stress/ASan as appropriate.

The current Java ACTOR_PREEMPTION.md documents continuation-backed loop checkpoints but not universal source-recursion or ordinary sync-function lowering. Java SUSPENSION_CONTRACT.md records incomplete transitive effect enforcement and virtual-thread I/O caveats. Java draft #567 explicitly records a suspended-finally cancellation-release gap. LLVM draft #127 implements host actor lanes but does not establish full guest await/generator lowering. Backend evidence therefore remains pending.

Sources: Java docs/ACTOR_PREEMPTION.md, docs/SUSPENSION_CONTRACT.md, PRs #483/#567/#637; LLVM PRs #127/#196; Erlang reductions (erlang.org/docs/27/apps/erts/erlang.html), Kotlin cancellation (kotlinx.coroutines), C# TAP compiler-state-machine model (learn.microsoft.com), Java virtual threads (docs.oracle.com/javase/26/core/virtual-threads.html), Tokio cooperative budget (docs.rs/tokio).
