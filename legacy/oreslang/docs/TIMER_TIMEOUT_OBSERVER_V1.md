# Timer/timeout observation v1 — cross-backend acceptance contract

**Status:** candidate normative contract, NOT executed guest parity. 2026-10-28.
Applies to Java/GraalVM, LLVM native, .NET NativeAOT, WASM and Forge.
All source examples are **candidate syntax** until the specific backend compiles
and executes them with an exact source SHA and binary identity.

## Core distinction

- A `Timer` is an owner-bound registration in a monotonic deadline source.
- A `Future<T>` is an observable, independently cancellable completion view.
- A `Task<T>` represents independently scheduled work, with distinct
  cancellation authority, lifetime and retirement receipts.
- `await time.after(d)`, `await time.sleep(d)` and
  `await time.timeout(d, existing_future)` **must NOT require an explicit
  `Task` wrapper or spawn an extra Task per await**. The calling async
  callable has an implicit scheduler-owned resumable continuation frame.
  An ordinary synchronous helper cannot directly await outside an explicitly
  `suspends`-capable or async context. The uniquely resolved zero-argument source `main` entrypoint
  entrypoint is the exception: it already has a scheduler-owned implicit
  Task and may directly `await` without an additional source Task.
- `time.set_timer(d, callback)` creates a timer capability, not a new actor.
  It dispatches callback work only via the owning scheduler/actor serialized
  turn. Timer/broker threads never invoke guest code.
- `time.sleep_blocking(d)`, if exposed, is a logical suspending wait; a
  carrier **must never block** on Thread.sleep, pthread sleep, or a hidden pool.

## Timeout arbitration

`time.timeout(d, future)` returns a **distinct Future<T> observer**. There is
one linearization winner between source success/failure/cancellation and
deadline expiry. An input already terminal at subscription wins even when
`d=0`. A positive duration starts at logical registration, not after a
producer callback or expensive user hook.

Timeout first: settle the observer with a guest `TimeoutError` (an Error
subclass), detach its producer waiter, revoke its timer and leave the
producer untouched. Cancelling the observer has the same separation:
**observer cancellation never implicitly cancels a shared producer**.
Source first: preserve its value, original error identity or cancellation,
revoke the timer and detach the waiter. No ghost waiter, double notification,
negative quota or stale actor generation is permitted.

To terminate **owned Task work**, require a separate explicit capability for
Task/TaskScope cancellation. Logical terminal publication and physical guest
frame/native callback **retirement are separate receipts**. No actor heap
or captured resource may be reclaimed merely because a timeout won.

## Suspension authority across actor entrypoints

The ordinary `async`/`suspends` effect requirement applies to ordinary
synchronous helpers and instance methods. There are three existing
scheduler-owned exceptions, all of which reuse their current continuation
without spawning a fresh guest Task:

- The uniquely resolved zero-argument `main` entrypoint, including non-public
  root or module declarations. A helper overload of `main` with arguments
  does not inherit root-turn suspension authority.
- The synchronous `actor fnc` entrypoint that already owns a mailbox turn.
- A class-based actor's synchronous `receive(ActorMail<T>)` hook, whose
  mailbox turn is resumable and remains serialized by the actor runtime.

Actor `on_start` must be synchronous through readiness completion, and
ordinary non-actor methods do not acquire suspension authority by calling a
Future-producing builtin. All borrowing/loan checks are still required,
and should produce their specific diagnostic rather than being hidden by a
generic outer effect error. This actor suspension authority does **not**
authorize `time.*` registrations inside actors while their timer ownership
and retirement path remains fail-closed.

## Timer and interval ownership

A timer stores owner domain + generation/incarnation + resource identity.
Admission is bounded per owner and globally, including idle intervals.
Cancel/expiry/owner close has exactly one terminal winner and each reservation
is released exactly once. A zero-delay timer must yield to a later scheduler
turn. A recurring demand-driven `interval.next()` supports exactly one
outstanding consumer, does not queue missed ticks and yields monotonically
increasing indices. Publish the incremented index *before* invoking any
synchronous Future observer, including reentrant `next()` calls.

Callbacks are always mediated by owner scheduler admission, serial actor
state authority, capture/borrow checks and actor lifetime leases. A callback
must never execute from a clock thread, or after owner revocation; cancelling
a RUNNING callback is not preemption. Self-await deadlocks (serial handler
awaiting its own queued callback) must be rejected or reported as typed
deadlocks. FFI loans and actor-state exclusive guards cannot escape across
suspension without a compiler-checked pin/lease.

## Evidence rule

A backend is not compliant merely because it can parse examples, accept
runtime host tests, or pass a no-step/synthetic CI job. Require **executed
identical .ores fixtures**, expected values or typed rejects, clock-controlled
race vectors, source/head/tree identity, compiled guest executable identity,
and physical retirement / resource receipts. Report unsupported forms as
typed rejects. Do not substitute interpreter/native host substrate tests for
guest AOT execution evidence. A carrier in another GitHub org requires prior
private-source authorization; a private destination alone is insufficient.

The machine-readable manifest at
`fixtures/timer-timeout-observer-v1/cases.json` is a **test plan**, not a
claim that compiler/runtime integrations exist.
