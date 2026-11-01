# Critical, suspends, async generators, and actor turns: v1 target

**Status:** proposed breaking language contract; NOT implemented or parity-verified. This document is the five-backend acceptance target, not a replacement for executed guest receipts. Companion: contracts/v1/critical-suspension-v1.json.

## Three independent authorities

1. Suspension belongs to the **logical continuation**; no OS/carrier thread may park while waiting for critical admission.
2. Critical admission belongs to a **generation-fenced, scheduler-owned gate**, not a JVM monitor or OS mutex retained across a suspension.
3. Non-reentrant actor admission belongs to an **actor incarnation and logical message turn**. A serial actor may keep its *logical* turn across I/O suspension, but must release its physical carrier, any host lock, and all mutable state-access loans.

Do not conflate the actor turn with a lock permit, a state borrow, or a physical worker. Supervisor CONTROL has an independent admission path and must not starve behind the user mailbox.

## Declaration matrix

| Declaration | Target | Meaning |
| --- | --- | --- |
| fnc / routine | allowed | No potential suspension. |
| suspends fnc / suspends routine | allowed | May suspend; not a promise to yield. |
| critical fnc / critical actor method | allowed | Synchronous critical *body*; admission is a separate concern. |
| critical suspends fnc and suspends critical fnc | rejected | Body would permit suspension while owning a gate. |
| async fnc / async routine | rejected after migration | Use suspends and explicitly model a Future-producing task where needed. |
| async gen* or async generator fnc | allowed | Lazy async sequence; async applies only to the iterator protocol. |
| gen* or generator fnc | allowed | Lazy synchronous sequence. |
| suspend gen* | preserve existing generator contract | Scheduler-cooperative async iterator mode, not a general async function alias. |

Ordinary methods have no implicit global lock. A critical callable requires a statically established owner/gate and cannot be called synchronously across an actor boundary. Cross-actor invocation goes through an asynchronous actor-request/message API. Local fast-path execution is allowed only after scheduler admission.

## Critical block syntax and effect rule

~~~ores
pub suspends fnc update(): void {
    const value = await fetch_data();
    critical gate {
        apply_update(value);
    }
    await publish(value);
}
~~~

A bare critical { ... } is valid only where a unique ambient gate is statically known. Otherwise spell critical gate { ... }. Gate acquisition is a *potential* suspension point, so the enclosing callable needs suspends even when admission is uncontended. An uncontended admission must execute the body without an admission-only logical yield. A contended admission queues a bounded FIFO task continuation, relinquishes the carrier, and resumes *only* upon successful generation-checked handoff.

**The body never suspends.** This prohibition covers explicit await, channel/select operations that can wait, generator yield, cooperative scheduler handoff, spawned work that escapes a borrow, and transitive calls through generic functions, callbacks, typeclasses, dynamic dispatch, and FFI. Unknown effect summaries fail closed. Blocking host I/O and physical thread parking are also disallowed, even without a syntactic await. There is no implicit unlock/relock around awaits or preemption.

A protected mutable state loan is scoped strictly inside the admitted non-suspending body. No state loan, borrowed alias, guard or reference may escape to a Future, generator frame, closure, actor message, return value or foreign call. The compiler must prove correct release on return, throw, raise, panic and cancellation; runtime teardown fences stale permits. CPU work must be bounded to preserve scheduler fairness. Deadlines are cooperative: a timeout must never publish a half-completed state transaction or prematurely reclaim an active native loan.

## Non-suspending alternative

~~~ores
pub fnc attempt(): bool {
    try critical gate {
        apply_update_now();
        return true;
    } else {
        return false;
    }
}
~~~

try critical never enqueues, never suspends, and never blocks a carrier; it either enters immediately or follows the else branch. Nested entry into an already-held gate is rejected unless the compiler proves an explicitly supported same-continuation nesting rule. Lock-order inversion and self-await cycles must be detected/rejected; generic recursive locking is not enabled.

## Critical callable admission

A critical fnc or actor method has a fully synchronous body and cannot transitively invoke suspends effects. A local caller requiring queued admission must itself use a suspends context; a non-suspending caller needs try critical or an explicitly admitted intra-actor direct path. A remote actor request is asynchronous and separately preserves mailbox/turn admission; never invoke a critical actor method on a remote carrier by a raw blocking call.

## Async generators and call effects

~~~ores
pub async gen* events(): AsyncIterator<Event> {
    while true {
        const value = await read_event();
        yield value;
    }
}
~~~

Generator construction is lazy and does not run body effects. next() is an asynchronous pull and may suspend, subject to single-flight/backpressure and exactly-once close/cleanup. yield while owning any critical guard is forbidden. Do not auto-flatten nested Future or Option. Existing GENERATORS_V1 defines the canonical gen* spellings and iterator result/close protocol; this contract does not silently change it.

Callable types, imported signatures, generic instantiations, callbacks, method dispatch, typeclass implementations and cross-backend ABI must retain the suspends effect. Unknown effect rows cannot enter a critical body by dynamic call or by an FFI wrapper.

## Deadlines, generations and supervision

Critical acquisition observes queue_timeout_ms and total_timeout_ms, bounded FIFO, cancellation, and exactly-one successful admission. A cancelled/expired queued ticket is never admitted; racing handoff and cancellation has one linearized winner. An actor stop/restart/hot upgrade may revoke pending tickets from the retired incarnation but cannot reuse old ticket authority in the new generation. execution_timeout_ms applies to bounded cooperative body execution; cannot asynchronously interrupt half a mutation. channel_wait_timeout_ms applies to other waiting operations outside the critical body.

Serial actor non-reentrancy is a distinct logical reservation that can span await; physical carrier thread admission ends on suspension. CONTROL/STOP/PANIC and generation fencing remain live even when an ordinary handler is suspended. Reentrant actor variants require version-check or other invariant protection around each await.

## Breaking migration

Existing Java/Graal explicitly distinguishes async fnc (immediate Future<T>) from suspends fnc (potentially suspended T). Therefore simple text replacement is INCORRECT. Migrate call sites and Future/task ownership explicitly before enforcing async-function rejection. Preserve async gen* and historical parser aliases only under the dedicated generator migration. Likewise the earlier synchronous critical fail-fast and mandatory-yield suspend critical proposals conflict with the new semantics: migrate their consumers to try critical (fail-fast) or explicit scheduler yield, not silent behavior changes. Keep legacy stacks draft until integrated.

## Conformance and evidence

Manifest cases are planned positive/negative compiled Oreslang guest fixtures and native runtime witnesses. Source-free model tests only test a reference *model*, not the compiler, scheduler, actor implementation or FFI. Each backend (Java/Graal, LLVM, Cranelift, .NET NativeAOT, Wasm) must compile the SAME pinned fixture sources and run relevant native guests. Unsupported syntax must fail closed; parser-only acceptance is not a pass.

Report exact source commit/tree, source fixture blob identities, compiler build digest, nonzero executed job steps, actual compiler invocation, compiler diagnostics for negative cases and native guest execution for runtime cases. Zero-step/steps=null is NOT_EXECUTED. Single-backend consistency is UNATTESTED until separately verified against CI job logs, tree identity and runner evidence. No parity promotion from reference-model tests.
