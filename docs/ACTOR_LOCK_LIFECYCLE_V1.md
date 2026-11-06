# Actor- and Task-Owned Lock Lifecycle v1 (conformance proposal)

Status: **model and contract only; no compiled Oreslang backend passes claimed** (2026-10-22).
The executable JavaScript test under `tests/actor-lock-lifecycle-v1.test.mjs` is an abstract state machine. It is not a replacement for Java/LLVM end-to-end tests, atomic memory-model proof, stress testing, or distributed consensus verification.

## Decision: do not put lock state in supervisor mailboxes

Locks live in runtime-owned, sharded, quota-bound shared metadata outside every actor arena. A supervisor owns the lifecycle policy and receives STOP/PANIC/DONE, but does not serialize each lock operation. ETS-like tables may index named locks or policy metadata; their table-owner/heir features do **not** prove arbitrary lock rows are automatically released. Erlang-style `pg` membership is eventually consistent and **cannot** be a lock grant authority.

A lock's authorization is a runtime-minted opaque capability containing:
- runtime ID + actor ID + **incarnation**, and optional Task ID + Task generation;
- lock ID, read/write mode, permit generation, and explicit scope (Task by default; actor only on authorized transfer);
- a non-exportable owner token and a quiescence witness.

Lock states: `AVAILABLE`, `HELD_READ`, `HELD_WRITE`, `RETIRING`, `POISONED`.
An actor death is **not** a normal guard close from an arbitrary host thread. A normal native OS mutex may never be "unlocked" by a different thread. Runtime-aware logical admission or generation-checked handles must be used instead.

## Lifetime linearization contract

1. **LIVE**: Tasks may acquire locks with a nonparking fair bounded queue. Multiple *logical Tasks of the same actor* are distinct owners, even after migrating physical carriers. Re-acquiring the same nonrecursive permit within one Task fails.
2. **STOP/CANCEL**: Atomically fence new acquisition and guest admission by owner generation. Unlink pending waiter tickets immediately, with exactly-once queue/counter settlement. This is **not** yet proof of physical quiescence.
3. **QUIESCE**: Wait until active guest turns, continuations, native callbacks, scoped descendants, and all state-backed loans have left their protected execution boundary. Do not forcibly steal a host mutex from an active carrier or release an arena first.
4. **REVOKE**: After quiescence, invalidate outstanding permits and release in O(held + waiting) via an actor/task reverse index. Poison any shared mutable region whose recovery invariants cannot be proven after an abnormal incomplete write. Wake eligible next waiters only after the previous owner is fully inactive and the value is safe.
5. **DONE**: Publish terminal actor/Task completion only after revocation and required cleanup bookkeeping. If quiescence or resource-specific safety cannot be proven, **quarantine** the grant/region and report a terminal cleanup failure rather than grant to a new actor.

### Actor identity reuse / incarnation monotonicity

A stable actor ID may not have two active incarnations. After `STOP`, the old
incarnation remains authoritative for cleanup until **physical quiescence,
permit revocation, and retirement** complete; a replacement using that actor
ID must be rejected before retirement. The next incarnation must be a strictly
higher positive integer than every generation previously admitted for that ID.
A stale/replayed or decreasing generation is rejected even if the earlier
incarnation has retired. Different actor IDs remain independent. Stale task
handles from earlier incarnations cannot obtain new grants or revoke permits
belonging to the successor. This is a bounded **source-free model contract**;
it does not by itself establish any compiler/runtime backend enforcement.

Both release and grant must be linearizable. A queued Future cancellation racing with direct handoff must have one winner; if grant wins, the permit remains owned and cannot be stolen until the new owner's quiescent cleanup. Never invoke guest callbacks or Future subscribers while holding lifecycle, CONTROL, queue, or supervisor metadata locks. Keep wait/unlink and retirement bookkeeping bounded.

### Failure effects

A caught `throw` or recovered `raise` normally unwinds lexical guards; only an unrecovered failure terminating a Task/actor triggers lifetime revocation. `panic` and supervisor STOP trigger owner shutdown. `defer/recover/tear_down` are useful for application cleanup but **never** the only means by which permits are released. A Task cancel releases its own permits after Task quiescence, not all its actor's permits. Actor-scoped permits remain held until actor quiescence. Actors cannot forge Task IDs or transfer ownership merely by copying a guard.

An **actor-local** mutex must be inaccessible to foreign actors; its state normally dies with the actor, but stale guards must be generation-fenced. For a **shared** mutex, automatic release also requires protected-data integrity: incomplete mutable writes are rolled back transactionally or the lock is poisoned until explicit repair. The runtime must not regrant a half-mutated value.

### Distributed case

Cross-node locks require a separate consensus-backed lease coordinator, quorum-safe epoch retirement, and **monotonically increasing fencing tokens**. Local supervisor death or `pg` membership notification alone cannot authorize a successor during a partition. The *protected resource* must check the fencing token on each relevant write. A holder whose lease expired must not rely on local revocation to protect an uncooperative or partitioned external service. Fail closed if the target resource cannot enforce fencing or another suitable conditional-write protocol.

## Existing code evidence and integration gates

- Java main: `src/main/java/dev/oreslang/runtime/OresMutex.java` has `Local` segment ownership, `Shared` semaphore/async waiters, poisoning and `GuardFuture`. **P0:** `Shared.reserveDomain` / `activeDomains` / `WAITING_ON` use `currentExecutionDomain()`, not a Task/continuation owner. Multiple logical handlers in the same actor cannot safely acquire independently. Guard release is not currently bound to ActorCell finalization.
- Java main: `ActorRuntime.ActorCell.finalizeStopLocked` establishes carrier quiescence and finalizes under `lifecycleLock`. The lock cleanup integration must **not** run arbitrary Future callbacks synchronously while that monitor is held; introduce a two-stage bookkeeping/notification boundary and ensure DONE follows permit settlement.
- LLVM main: `CriticalGate`/`LogicalMutex` are native scheduling substrates, not guest Mutex/RwLock proof. `ActorResourceRegistry` provides incarnation-aware quiescence and can own a native lock-revoker handle only after all activity tickets/loans are discharged.
- Existing drafts: Java PRs #754 (queued timeout/cancel settlement), #808 (RW integration), #1433 (ETS reference), #1550 (Task quiescence). Review and rebase these **before** applying a second queue or lifetime model.

**Release gates:** actual Java JDK25 exact-head mutex/actor Task tests, LLVM compiled guest tests with sanitizers/TSan, fault injection into STOP/PANIC and foreign carrier callbacks, bounded interleaving and model checking, explicit reader/writer fairness and dirty-write recovery, and distributed lease expiry with stale-token rejection by the resource. Only real backend runs may promote `runtimeVerified` status.

The reference state machine models acquisition, cancellation/handoff order, quiescence, incarnation fencing, RW grants, dirty-writer poisoning, and token checking. It intentionally does *not* model consensus, host memory fences, true parallel data races, or actual guest code generation.
