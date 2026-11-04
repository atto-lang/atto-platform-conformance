# Unified execution, safepoint and preemption contract v1

Status: **proposed backend-neutral normative contract and source-free reference oracle**. No backend is certified by this change. This document complements `NIO_ACTOR_EXECUTION_V1.md`, common-source `CALLBACK_DISPATCH_AND_PREEMPTION_V1.md`, and Task borrow-safety v1. In an ambiguity, stronger ownership, scheduling and shutdown requirements govern.

## Separate identities and authority

- **Actor**: mailbox, generation and exclusive physical actor-turn authority; it is *not* an OS thread. CPU cooperation of a synchronous message retains its logical message place ahead of younger USER messages.
- **Task**: independently scheduled, owned continuation with lexical TaskScope parent, cancellation lineage and physical retirement receipt. It has no implicit actor-state or mailbox authority.
- **Future<T>**: one producer result and zero or more observers; creating an observer does not spawn another task or convey producer cancellation authority. `await` suspends a continuation without parking a carrier.
- **Generator/async iterator/Observable<T>**: resumable / demand-driven or multi-value protocols. Observable is not directly awaitable. Subscribers cannot synchronously reenter guest code during registration/settlement.
- **Scheduler carrier**: bounded physical thread/worker authority, independently accounted from ready tasks, suspended tasks, mailbox depth, and pending I/O.

## Execution and fairness

1. Ordinary synchronous loops and compiled synchronous collection combinators must have automatic source-safe reduction checkpoints; no `await` or opt-in needed. Checkpoints include nested calls and exceptional/defer paths where compiler IR proves safe continuation storage.
2. A per-task **reduction quantum and elapsed-time budget** determine when to request a yield. Elapsed time is advisory when a frame is unsuspendable. A watchdog reports overruns but is not evidence of forceful native preemption. Backend-specific weighted reductions may differ; tests assert bounded peer progress rather than identical instruction counts.
3. A preempted synchronous actor handler releases the carrier without admitting a younger USER message ahead of the ready continuation; serial actor semantics persist across truly pending `await`. The logical actor turn is retained across I/O suspension and generation changes until physical retirement; only the carrier lease is released. A saturated USER ready queue must not permanently strand the suspended owner's wake: a bounded, separately accounted CONTROL reserve can admit the owner, while younger same-actor USER tickets remain ineligible. Cancellation cleanup retires the owner before younger USER work may execute.
4. Live unpinned stack loans, critical-read/write guards, mutable actor-state loans, and foreign frames must never be silently migrated across an unsafe safepoint. The compiler either supplies owned/pinned proof with valid effects or rejects before executable lowering. It must not unconditionally yield while holding a no-yield guard.
5. Ready and CONTROL queues and timer/I/O wake tickets are finite. Saturation rejects/adapts with an explicit bounded policy; CONTROL progress remains possible when DATA is full. A one-shot I/O completion or cancellation accepted for an already-suspended Task is latched once in that Task when both queues are full, then automatically promoted on available queue credit; never drop it expecting a reactor retry. A latched completion is not a running Task or physical retirement receipt. No implicit OS thread per actor, Task, Future, connection or subscriber.

## Cancellation, I/O and physical retirement

6. Kernel readiness/reactor callbacks perform bounded host bookkeeping only; they must not execute source callbacks. Each I/O registration issues an opaque per-task registration ticket/epoch in addition to task identity, owner generation and token. A completion without that exact live ticket fails closed; reusing the same descriptor/token for a later wait must not allow an old completion to wake it. Registration/completion races and duplicated/stale wake events admit at most one fresh dispatch under current owner generation. Cancellation and retirement revoke the ticket.
7. Cancellation linearizes only while the Task is nonterminal: once a success/cancel terminal result has been selected, a later cancellation request is rejected as a no-op even if physical retirement is still pending. Cancellation request, Future terminal delivery, removed waiter, and Task logical terminal **do not** themselves authorize actor arena / FFI / capture reclamation. Retire only after the last guest carrier exits, cleanup/defers finish, scoped descendants physically drain, and any device/foreign fence is satisfied.
8. Native blocking APIs must use an explicitly bounded blocking/dirty execution pool or be rejected. Nonblocking advertised `_blocking` source APIs may have sequential source semantics but cannot park the ordinary carrier during readiness wait.
9. User-created FFI/atomic/shared-memory facilities require separate permissions and Send/Sync/ownership proofs. No blanket actor-state access or unsynchronized mutable heap sharing is implied by a shared execution substrate.

## Five-backend admission gates

| Backend | First executable admission target |
| --- | --- |
| Java/GraalVM | JVM loop+Task+Future+actor progress and cancellation/physical retirement; exact-head JDK25 and native-image evidence |
| LLVM | Compiler-owned resumable source continuation, native scheduler and FFI isolation; native-AOT execution and sanitizer safety |
| .NET | CIL source Task + continuation ownership, bounded runtime carrier scheduling, native-AOT and cancellation tests |
| Wasm | Worker/event-loop-safe cooperative continuation, no fake OS-thread guarantees, generation-fenced JS host callbacks |
| Forge | Forge-source lowering to continuation ABI; independent bounded carrier and actor-domain enforcement |

A backend that cannot meet a capability **must reject it before executable artifact emission**, not silently run a thread-per-task fallback or report parser-only acceptance as execution parity.

## Evidence and oracle limits

- `src/unified-execution-model.mjs` and `tests/unified-execution-model.test.mjs` form a deterministic *source-free* admission/fairness/retirement illustration. No runtime, compiler, native-image, race detector or actual time-budget proof is claimed.
- `contracts/v1/unified-execution-cases.v1.json` enumerates required future guest fixtures. Every backend is initially unverified; passing `npm test` changes none of those statuses.
- To promote any case, attach exact source commit and tree, contract blob, real compiler source fixture and execution result, executed CI job steps (not zero-step runner failures), ownership/diagnostic proof, and independent review. Explicitly disclose unsupported cases.
- Never move private compiler source into a different organization without the approved private-source security policy and carrier ledger; Actions minutes do not override confidentiality gates.

## October 27 implementation candidates (not runtime parity)

- Java/GraalVM [draft #2158](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2158) broadens loop-suspension recognition through source call graphs and adds a real guest `receive -> count_in_helper` regression. **Release gate:** executable source returns the correct value; its synchronous actor message retains ordering; compiler-derived receiver/capture/loan authority is safe when nested task cooperates. Pending exact-head JDK25 and GraalVM native-image tests. Bare static AST analysis is not proof.
- LLVM [merged #1087](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1087) extends the existing opt-in source→LLVM IR→native AOT integration harness to drive three independent scalar frames at distinct reduction credits, ensuring exact increments and completion. **Release gate:** execute this exact compiler IR/native binary; record runner and fixture identities. The harness chooses the interleaving, so this is not evidence that native production scheduling automatically provides fairness.

Neither PR changes the fail-closed status of the other backends. The added manifest cases `transitive-sync-helper-loop` and `native-scalar-multipeer-aot` remain `guestVerified=false` for all five backends; a host-only or zero-step Actions run cannot promote them.

## Future combinator admission gate (2026-10-27)

A Future that is already settled is still not proof that `map`, `compose`/`flatMap`, `flatten`, or `onSuccess` are scheduler-free: the Java implementation starts a new scheduler-owned continuation Task for these operations. Under a live no-yield guard, the launch must be denied **before** evaluating callback arguments or submitting the continuation. A rejected launch must cause no child registration, mutable capture transfer, callback execution, or receiver release. This principle applies to every backend, including explicit standalone Future chains and Task/Future interop; unsupported lowering fails closed.

Java [draft #2158](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2158) includes an explicit preflight and a settled-Future guest regression; both are **NOT_EXECUTED** pending source-org runners and JVM/native-image proof. LLVM [#1087](https://github.com/ores-truffle-oreslang/oreslang-source.llvm/pull/1087) is merged, but its recorded local stand-in checks are **not compiler-produced Oreslang guest evidence**. The `future-chain-no-yield-admission` acceptance case remains unverified on every backend.

## Sealed source-actor receiver authority and physical retirement (2026-10-27)

For each mutable source actor receiver, preserve a **single immutable runtime-owned actor identity** from state initialization through the final physical cleanup. Before any receiver method's guest code or scheduler Task admission, validate the executing runtime, exact actor ID, and one-owner physical carrier lease. Revalidate when a suspended receiver SourceTask resumes, including after cooperation, cancellation, and deferred cleanup. A detached async argument cannot clone an actor receiver or its sealed state. Cancel requests must not release the actor's state, arena or generation until scheduler task cleanup and carrier exit have physically completed.

Java/GraalVM [draft #2158](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2158) adds actor-ID stamping, a runtime physical-lease validation hook and two unexecuted actor source regressions (two actor instances with distinct receivers, plus cancellation of an infinite transitive helper before `get_done`). This is a **partial implementation, not release or correctness proof**. Follow-up requires source/bytecode and Native Image execution, verifier checks of receiver/loan access in critical scopes, hot-reload generation pinning and STOP/cancel/early-completion race tests. No backend's `verified` status is promoted.
