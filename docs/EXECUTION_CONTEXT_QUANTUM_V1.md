# Execution-context scheduling and cycle-proof design (v1)

**Status:** proposed compiler/runtime architecture, not production implementation. This refines [SAFE_PREEMPTION_REENTRANCY_V1.md](SAFE_PREEMPTION_REENTRANCY_V1.md) and does not change existing Java/LLVM runtime capability claims.

## One logical execution context

The scheduler's resumable task and the source lexical exception/cleanup mechanism must operate on the same logical execution context (or on linked heap-owned frames with equivalent identity and lifetime). A context is **one task**, never a carrier thread; actor admission remains a separate policy.

Fields: task/incarnation ID; heap frame chain (PC, locals, expression temporaries, caller return PC); pending lexical control flow (NORMAL/RETURN/THROW/BREAK/CONTINUE/ARM_RETURN/CANCEL); unwind/defer/finally obligations and one-shot tokens; future/port/select wait registration; actor lane/critical/ownership admission; logical cancellation and lifetime lease; separate per-dispatch *soft* reduction/time quantum and cumulative logical fuel/wall/CPU quotas.

A normal cooperate preserves the frame/cleanup stacks without invoking defer/finally. The next dispatch resumes at the **post-commit PC**, not the beginning of an expression. Cancellation converts the pending flow to CANCEL and resumes cleanup on the *owning execution lane*. Cleanup can await only when the cleanup frame itself is resumably lowered; pending cancellation cannot discard a suspended finalizer. A direct return inside lexical finally remains forbidden. A nested independent callable can return from itself.

**Current-source facts (2026-10-11):** Java `SourceTask` already captures `SourceValueCont`, awaiting continuation and lexical runBlock defers. It samples `System.nanoTime()` every 32 trusted backedges; nominal loop quantum is 512 backedges OR 2ms. But cancellation in `OresScheduler.TaskRunner.cancelFromFuture()` can terminalize without unwinding pending defer/finally; Java #567 documents this as a release blocker. `recover` is **reserved and not executable** per `docs/EXCEPTION_EFFECT_ADMISSION.md`. This design must not be represented as existing `recover` execution.

## Clock semantics: `timeSinceLastYield()` vs dispatch time

For the scheduler's *quantum*, measure **active dispatched execution** from the latest resume/admission with a monotonic clock. An awaited Future could take minutes; that parked wall time must not consume the resumed turn's 2ms soft CPU fairness quantum. Maintain a separate task-lifetime wall deadline that *does* count parked time where policy requires. Do not use a single `lastYield` timestamp as both measurements.

## Hot path: compiler-generated loop backedge, not a clock on every iteration

Every unbounded loop/reentrant recursion cycle in continuation-lowered guest code must intersect a **proven resumable safepoint**. A lightweight integer countdown/decrement at every completed loop backedge is unavoidable for guaranteed cooperative progress absent signal-level stack-map preemption. Expensive monotonic clock reads and scheduler API calls happen only in the slow path, e.g. after 64 backedges or when an accumulated weighted reduction budget reaches zero:

```c
// Schematic SSA/IR, never user-source rewriting:
LOOP_BACKEDGE_COMMITTED:
  if (--local_backedges_to_probe != 0) goto LOOP_HEADER;
  local_backedges_to_probe = 64;
  ctx->reductions_remaining -= weighted_reductions_for_chunk;
  if (ctx->reductions_remaining <= 0 ||
      monotonic_now() >= ctx->dispatch_deadline_ns) {
    // This PC was statically proved resumable before code emission.
    if (runnable_peer_exists()) { save_post_commit_PC_and_handoff(ctx); return; }
  }
  goto LOOP_HEADER;
```

When reductions are tracked per executed operation (e.g. calls/intrinsics), charge them to the *same task-local counter*; do not double-charge a backedge. Runtime safepoint/cancellation checks are independent. An empty `for { }` remains observable as an endless loop but must reach the backedge probe. The instrumentation must be preserved by optimizing JIT/AOT passes and cannot be hoisted or eliminated as a pure unused counter.

The existing Java 32-backedge interval and 2ms/512 policy is a starting implementation. A 64/128/256-backedge sampling interval, 500 reductions/5ms candidate, timer-set preemption flag and backedge strip mining are **benchmark alternatives**, not established faster settings. A timer flag still requires a bounded check at safe backedges; OS timer expiry cannot itself move a JVM/FFM/native stack to an Oreslang heap continuation.

## Static control-flow cycle proof

Build an interprocedural control-flow graph covering loops, caller/callee recursion cycles, exception edges, imports/callback effects and async generator delegation. Mark a node *proved-resumable* only if the **entire caller chain** is continuation-lowered, ownership/critical obligations permit suspension, and the operation is committed.

**Proof:** remove all proved-resumable probe nodes from each reachable graph, then verify the remaining graph is acyclic. A reachable cycle without any legal probe is a possibly unbounded unpreemptible cycle. Either reject it for scheduler-run guest code (`UNBOUNDED_NO_YIELD_REGION`) or require explicit isolated execution with its own cancellation/fairness contract; do not silently pretend bounded threadpool fairness. Dynamic call targets/FFI without a proof are conservatively unsafe. This test is stronger than saying an SCC merely *contains* a probe: an SCC may contain both safe and unsafe subcycles.

Bounded no-yield critical regions can instead be admitted with a separate proven finite-bound/WCET policy; an indefinite `critical { for {} }` must not monopolize a shared carrier. Deferring unsafe pre-emption forever is *not* a fairness guarantee.

A loop backedge only checks the scheduler when the compiler knows the exact continuation PC, iteration state and exception/defer obligations, and no active ephemeral alias or guard would cross suspension. The compiler needs explicit source-to-heap-frame lowering for arbitrary non-tail recursion, not a plain call-stack poll.

## Actor and generator policy

Carrier scheduling is **not** a grant for actor DATA reentrancy. A serial actor's HTTP/message handler retains actor-wide logical admission across await, cooperation and generator suspension; its receive() does not accept a new envelope until complete. Other actors/requesters share released carrier threads. Nonserial actor reentrancy during a genuinely waiting await is optional and separately gated by safe state ownership and an explicit reentry policy.

`rt cooperate` yields the *task*, `await` parks on a dependency, and `yield value` publishes one async-generator item and parks until next consumer demand. All three preserve the execution context but have distinct scheduling/admission policies. At most one generator producer activation can be RUNNING; close/cancel/next races use single-delivery state and keep deferred cleanup obligations alive until physical producer exit.

## Required integration acceptance

1. Exact guest-source infinite empty loop proves peer actor progress and preserved actor serial admission.
2. Quantify clock reads per one million loop iterations; no `System.nanoTime` in per-iteration hot path. Measure added instructions/cycles and p50/p99 fairness.
3. Test nested loops, break/continue, side effects once, JIT inlining/vectorization, dynamic callbacks and non-tail recursion.
4. Reject an unbounded critical/guarded/borrowed no-yield loop; do not permit unsafe automatic yield.
5. Resume a suspended nested finally/defer on cancellation and context close; every cleanup token executes exactly once, including interrupted async generator close.
6. Prove logical quota remains across carrier migration and compare Java/GraalVM JIT, Native Image, LLVM, Wasm/browser profiles separately.
7. Confirm machine-level optimizer preserves scheduling observability and time source monotonicity. An allowed 2ms quantum is a **soft** objective, not a hard deadline.

## External implementation precedents

- Go: https://go.dev/src/runtime/preempt.go (compiler/runtime safe-points and signal-assisted asynchronous pre-emption).
- V8: https://github.com/v8/v8/blob/main/docs/runtime/tiering.md (cheap interrupt-budget accounting at loop backedges, deferred slow paths).
