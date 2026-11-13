# ACTOR_TASK_POOL_AFFINITY_V1 — actor-owned logical task scheduling

Status: **TARGET / candidate conformance contract**, not five-backend runtime
certification. AttoLang uses `.atto`; Oreslang compatibility identifiers remain.

## Ownership rule

When an authenticated actor turn evaluates `task { ... }` or `cpu task { ... }`,
the logical child Task belongs to the **same actor incarnation**, is scheduled
through the actor's existing bounded task/continuation mailbox, and can only
run on that actor kind's admitted carrier pool.

Physical worker pools may be shared among actors, but cannot be borrowed from:
- the root task / supervisor CONTROL scheduler;
- ActorGroup Mailman CONTROL workers;
- timer, I/O, HTTP reactor or foreign Future-completion callbacks;
- another actor, another tenant/isolate, or a stale restarted incarnation.

No separate physical thread pool is created per Task or per actor. A Task
may resume on a different physical carrier **of the same actor pool** after
`await`, but the scheduler must reauthenticate runtime, actor ID,
incarnation generation, actor kind, scheduler domain, dispatch admission
and physical single-writer lease before each guest instruction segment.
Observational thread ID, source trace ID or a forged actor ID confers no
execution or sealed-state authority.

Nested `task { }` inherits the actor domain and cancellation lineage, not
supervisor authority. `TaskLocal` follows the logical child; `ActorLocal`
is usable only through admitted actor-state access/critical gates. A task
must never capture raw `self`, actor state, mailbox messages, live guards,
unsendable borrows, or host/supervisor capabilities. COPY/MOVE transfer
must be identity-bound to the compiler-checked AST and atomic on admission.

Every live actor incarnation MUST maintain a bounded, runtime-owned Task
census. Registration of the initial scheduler Task and the STOP admission
seal are one serialized transaction. A child Task's parent is inferred
from its authenticated executing Task turn, not accepted from a freely
forgeable pointer/ID. Parent `get_done()` MUST join each registered transitive
child's physical retirement, including when the parent result is already
terminal; cancelling an already-terminal parent must still revoke its
outstanding descendants. Removal of a parent lifetime record cannot strand
registered children or permit premature actor resource reclamation. Hosts
must not close the actor's Task census before physical actor DONE.

These are language-level obligations. Backend implementations may use a
fixed-capacity ledger, pinned actor heap records, or an equivalent structure;
the specific native host ABI is not mandated by the contract.

For UNTRUSTED actors, child tasks must share the enclosing actor's
fuel/wall/CPU/continuation admission accounting; no new budget is minted for
a nested child. If the backend lacks these controls, the compiler/runtime
must reject `task { }` inside UNTRUSTED actors instead of falling back
to the root scheduler.

STOP seals new admission, requests child cancellation, preserves a bounded
cleanup-only continuation lane, and does not complete actor `get_done()`
or reclaim state until guest cleanup and physical task retirement are
witnessed. A Task's initial registration and STOP's cancellation snapshot
MUST linearize under the same actor-incarnation admission gate. A check
performed before an unlocked `start()` call is insufficient: a concurrent
STOP may otherwise miss the new Task. In particular, an actor whose scheduler
was initialized before STOP cannot create a new Task during a surviving
cancellation-cleanup turn. Only already-admitted, authenticated lexical
unwind continuations may execute after STOP. `Future.isDone` is not proof
of quiescence. Panic goes to supervisor CONTROL as a *notice*, never as
execution of the failed child.

`task scope` inside an actor remains a separate feature; reject until its
physical lifecycle, quotas, and hot-reload generation integration is proven.

## Acceptance fixtures

`fixtures/actor-task-affinity/v1` contains:
- checked scalar-capture Task creation, await/resume and reply;
- independent negative actor `self` capture;
- optional negative UNTRUSTED quota-gate case for backends without support.

### Actual executable backend gate (not satisfied by static fixture tests)

Run the same **compiler-produced guest** program for every supported backend,
including Java/Graal JVM and AOT, LLVM native, Wasm worker/single-thread
profiles, .NET NativeAOT and Forge as applicable. Assert:
1. exact authenticated actor runtime/kind/incarnation before and after await;
2. worker carrier belongs to the expected actor-kind pool, never CONTROL;
3. completion delivered by foreign producer does not run guest code;
4. two actors cannot concurrently run the same actor-state turn;
5. STOP, cancellation, restart and stale future callbacks fail closed;
   initial Task admission races atomically against STOP, including when the
   actor's source scheduler already exists; cleanup cannot spawn new Tasks;
6. source self-capture rejected by compiler, including nested Tasks;
7. UNTRUSTED quota unchanged across nested child and suspend/resume;
8. a parent finishes before a suspended child, but its `get_done()` remains
   pending until the child physically retires, and parent cancellation can
   still revoke that child; stale/foreign parent identity cannot admit tasks;
9. STOP atomically seals a bounded census and cancels all registered tasks,
   including nested children, without requiring the application to enumerate
   them; no registry/census memory is reclaimed before actor DONE.

For unsupported backends, an explicit compiler rejection is acceptable as
an honest capability statement, **not** executable parity.

Evidence receipts must identify exact source/head/tree SHA, compiler digest,
test runner and nonzero executed steps, guest exit/status, assertion counts
and sanitizer results where relevant. A zero-step failed GitHub Actions run
is `NOT_EXECUTED`. Static Node manifest tests are not guest-execution proof.

Java candidate: https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2999
