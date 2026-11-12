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

For UNTRUSTED actors, child tasks must share the enclosing actor's
fuel/wall/CPU/continuation admission accounting; no new budget is minted for
a nested child. If the backend lacks these controls, the compiler/runtime
must reject `task { }` inside UNTRUSTED actors instead of falling back
to the root scheduler.

STOP seals new admission, requests child cancellation, preserves a bounded
cleanup-only continuation lane, and does not complete actor `get_done()`
or reclaim state until guest cleanup and physical task retirement are
witnessed. `Future.isDone` is not proof of quiescence. Panic goes to
supervisor CONTROL as a *notice*, never as execution of the failed child.

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
6. source self-capture rejected by compiler, including nested Tasks;
7. UNTRUSTED quota unchanged across nested child and suspend/resume.

For unsupported backends, an explicit compiler rejection is acceptable as
an honest capability statement, **not** executable parity.

Evidence receipts must identify exact source/head/tree SHA, compiler digest,
test runner and nonzero executed steps, guest exit/status, assertion counts
and sanitizer results where relevant. A zero-step failed GitHub Actions run
is `NOT_EXECUTED`. Static Node manifest tests are not guest-execution proof.

Java candidate: https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2999
