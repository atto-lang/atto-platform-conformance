# AttoLang Task-owned timers and qualified hard real time — candidate v1

**Status:** Proposed backend-neutral semantic and evidence contract. **NOT** merged compiler/runtime functionality, guest parity, qualified timing, or certification. Tracked across all eleven atto-source.* repositories; hosted guest execution is a separate requirement from deterministic hardware and bootstrap-only targets.

Related existing contracts: `docs/TIMER_TIMEOUT_OBSERVER_V1.md`, `docs/TASK_BLOCKS_V0.md`, `docs/ATTO_NATIVE_THREADS_SCHEDULER_V1.md`, `docs/LOGICAL_CONTEXT_LOCAL_STORAGE_V1.md`. This contract preserves their semantics; it does not silently turn soft-RT `sleep` into certified hard-RT execution.

## 0. Direct async/await is first-class

Timer suspension is supported conceptually in **both** an existing async continuation and an independently spawned Task; no wrapper Task is required. These remain candidate .atto spellings until real compiler-backed guest execution is received:

```atto
pub async fnc main(): int {
    await time.sleep(1ms);        // Future<void>, no carrier blocking
    await time.after(0ms);        // zero duration still schedules a later turn
    return 42;
}
```

A `suspends fnc` may suspend its *caller* rather than spawning a child Task; ordinary non-suspending helper functions and actor `on_start` must reject `await`. An `async` callable/future continuation and a `Task<T>` are different concepts: `await` observes/resumes a current continuation, while `task { ... }` explicitly creates an independently scheduled child with an owned scope.

For shared futures, `await time.timeout(duration, future)` is a **read-only observer**; timeout winning never grants permission to cancel the independently owned producer. For a **TaskScope-owned child Task**, an explicit deadline policy may request cancellation, but its owning scope completes only after child physical quiescence and cleanup. Synchronous Future observer hooks and clock workers must never execute guest code.

Timer cancellation must atomically arbitrate timer expiry, owner cancellation, timeout, and hot-reload revocation. At most one wake may be committed; timer reservation/observer detachment is exactly once; late wakes must be ignored. Task-local state and trace span survive carrier migration; ThreadLocal stays with the physical thread and actor state remains generation-fenced.

In the strict hard-RT profile, `await` is admissible only when the complete suspension/wake path, bounded remaining actor turn, all reachable continuation effects, release jitter, scheduling interference and cleanup have qualified target-specific upper bounds. Arbitrary awaited network I/O, garbage-collected allocations or unbounded Task spawning must be rejected, not silently treated as hard real time.

Conformance candidate manifest: `fixtures/async-await-task-timers-v1/cases.json` (14 unexecuted candidate cases). Source-free contract assertions: `test/async-await-task-timers-v1.test.mjs`. Real compiler-backed execution is still the release gate.

## 1. Timer is not Task

`Timer` is a bounded, owner- and generation-fenced clock registration; `Future<T>` is a completion observer; `Task<T>` is independently scheduled, cancellable execution. These are distinct types and lifetimes.

- `await time.sleep(d)` and `await time.after(d)` use the **existing** caller Task or scheduler-owned async/actor continuation. The clock settles readiness and a scheduler turn resumes the suspended frame. Do **not** spawn a Task or block a physical carrier per timer. `0ns` resumes at or after a subsequent authorized turn.
- A Task may own zero or more timers. Task-local values, trace identity, cancellation context and source continuation persist through wake and carrier migration. Thread-local values belong to the actual carrier. Actor-local values remain bound to the owning actor, never to a clock thread.
- `TaskScope` owns child Tasks. At cancellation, the timer registration is revoked and its slot accounted for exactly once. Parent scope completion requires physical child retirement (including `defer`/finally cleanup and release of owned resources); a terminal Future value is not a retirement receipt.
- `time.timeout(d, sharedFuture)` is only an observer; a timer winning does **not** cancel the shared producer. An **owned child Task deadline** (candidate API; exact spelling TBD) instead requests cancellation through the scope and waits for bounded retirement. Both cases require one linearization winner for producer/cancel/expiry/owner-close races.
- A clock thread or native ISR carries **only opaque timer tickets** with runtime domain, task id, actor id/incarnation, scope and generation. It never calls guest code, dereferences actor-private storage, executes callbacks or grabs a Task guard.

## 2. Actor and Task ownership

An actor that awaits a timer suspends its current logical mailbox handler and releases the physical worker, **not** its logical non-reentrant turn. A later same-actor DATA message must not overtake the retained continuation. The clock posts readiness to a bounded CONTROL/WAKE lane; an authenticated actor lease and correct generation are required at the resumption boundary. Revocation on stop/hot reload does not imply immediate physical reclamation.

Task creation within an actor requires explicit compiler-checked task/heap/stack ownership, Send/Sync proof and actor-generation lease. Until those gates are implemented, the compiler/runtime must **reject** actor-owned Task/timer combinations instead of permitting a stale actor-pointer wake.

A mutex guard, critical permission or mutable borrow cannot silently live across a timer suspension. A suspension-aware guard must have a legal retained owner, bounded priority inversion and bounded cancellation cleanup; otherwise compilation must reject the await.

## 3. Ordinary vs qualified real time

Ordinary timers need a monotonic source, bounded quotas, fair wake scheduling and race-safe disposal. These make timeouts and backoff correct but **do not establish** hard RT. Hard RT requires deadline guarantees derived from worst-case bounds **on a specific qualified OS/RTOS, CPU and compiled guest binary**.

The compiler must fail closed for `mode: #hard` on targets lacking an admitted profile. No automatic downgrade to `#soft`; no hard-RT claim based on `rt cooperate`, low-percentile latency, generational heaps, NativeAOT of only a host runtime, or an unbound scheduler priority.

For the hard-RT profile, a timer release occurs at absolute monotonic `t0 + n * period` with checked arithmetic and a documented missed-release policy. Demand-driven `interval.next()` and `sleep(period)` loops **are not phase-accurate periodic release**. Reject over-capacity registrations or work that is not admitted by a schedulability analysis; drop/backpressure policy must be explicit and never be a silently delayed hard deadline.

### Timing budget

For each admitted task/actor timed job, prove with **worst-case upper bounds**:

- `releaseJitter + wakeQueue + blocking + claimToFirstGuestInstruction <= startDeadline`
- `startPath + WCET + higherPriorityInterference <= completionDeadline <= period`
- `startPath + cancellationCleanupWCET + interference <= cancellationDeadline <= period`

Use checked arithmetic. Include worst-case remaining non-reentrant actor turn, critical region, native FFI and scheduler interrupt/priority effects in the appropriate terms. Real timer expiry, scheduler claim and **actual first guest instruction** are distinct timestamps. A late timer ticket must report `DeadlineMissed` and suppress an incorrectly claimed on-time guest start. CPU execution beyond deadline must have an explicit supervisor policy; a delayed cooperative checkpoint is not an RT preemption guarantee.

A strict profile requires preallocated fixed-capacity timer and ready pools, bounded ingress and O(known bound) cancellation/cleanup, prestarted isolated priority/EDF workers, no dynamic class loading/JIT or unbounded allocation/GC on critical paths, qualified clock and FFI, documented lock ceiling/inheritance, memory residency, and a bounded load/overload response. Use a bounded RT-specific implementation rather than treating the ordinary shared timer wheel as the RT driver.

## 4. Evidence and release qualification

The candidate cases in `fixtures/task-timer-hard-rt-v1/cases.json` are **plans**, not executed backend passes. Require a separate executable guest pipeline for each backend with:

- immutable PR head SHA, Git tree SHA, exact compiler SHA and generated binary/hash;
- nonzero executed job steps and full test reports, with host-only/model tests segregated from compiled guest execution;
- deterministic clock-controlled cancellation/expiry/stop/hot-reload race tests, actor turn ordering, TaskScope cleanup/retirement, task-local migration and zero-delay suspension;
- actual `Task + time.sleep/after + native scheduler` guest execution, including actor limitations/rejections and typed hard-mode rejection on unqualified targets;
- target-hardware WCET, start-to-first-instruction latency bound, jitter, IRQ/interference, priority inversion, memory and admission analysis; detailed deadline-miss and physical-cleanup traces.

Zero-step CI, source-free model PASS, host CTest PASS and parser-only acceptance are not substitutes for these receipts. An external private-source test carrier requires prior explicit authorized destination and exact-head/blob/tree attestation. Until release evidence exists, report **HARD_RT_NOT_QUALIFIED**.

## 5. Related draft implementation work

Java timer substrate and source typing: `oreslang-source.java` #2203/#2208. LLVM timer fixed-capacity queue and actor-ledger handoff: `oreslang-source.llvm` #1123/#1144. Java-specific qualification preflight (synthetic policy tests only): `oreslang-runtime.realtime-java` #11. None of these alone proves hard-RT Task timers.

## 6. Eleven-backend std/time values parity gate (candidate; not a guest receipt)

The shared, **source-only** 11-backend inventory and 23 checked signed-i64
nanosecond reference vectors are in
`fixtures/std-time-parity-v1/cases.json`, with a common candidate source
`fixtures/std-time-parity-v1/manual-deadline.atto` expecting 12 exact
stdout lines. `test/std-time-parity-v1.test.mjs` verifies the independent
BigInt arithmetic, unique registry entries, current candidate Git identities,
and **fails closed** if a metadata edit tries to promote an unexecuted
backend to `PASSED` or `full_tree_verified`.

The independently owned `.atto` libraries from draft Java #1785, LLVM #882,
.NET #227, Wasm #290, Forge #235, Rust #545, Cranelift #100, JS #140 and
HDL #69 are **source candidates** only. `atto-source.atto` and
`atto-source.realtime` are compiler-bootstrap repositories without a
verified executable compiler. HDL requires a clock-domain hardware subset,
not ambient OS sleeping. Source bytes may differ per backend; public behavior
should match. Existing JS/Wasm host adapter and C++ queue tests are not
proof of compiled Atto `std/time` guest support.

Portable guest PASS requires an independent compiler, actual linked
`std/time` module, generated guest artifact SHA, executed positive and
negative fixtures, and complete per-head/tree provenance. **Host-only or
metadata-only tests never turn a backend green.** The private CI recovery
path must honor the source repository's effective protected export allowlist,
source owner authorization and exact destination ID; a source-free successful
alternate runner does not authorize copying private compiler trees.

### Borrow checking for mutable timer receivers (candidate; not compiled guest PASS)

AttoLang **`val` is `const mut`**: a non-reassignable binding with a mutable
referent, which may take an exclusive `mut self` loan. A default `const`
binding is read-only and cannot call `ManualClock.advance(mut self)`,
`Timer.poll(mut self)` or `Interval.cancel(mut self)`. `let mut` may
also hold a mutable referent; a `let` without `mut` is not sufficient.

The source-independent test sources are
`fixtures/std-time-parity-v1/borrow-positive-val-mutable-referent.atto`
(expected stdout `1`, `true`, `true`) and three
`borrow-negative-*.atto` fixtures (required compile-time ownership
rejection with **no** guest artifact). Java's backend-owned JUnit test
executes the positive `val` case and separately calls the production
compiler for the negative `const` cases; LLVM has corresponding native
AOT candidate fixtures and admission script. **No backend is certified**
until real compiler diagnostics and guest output are captured on exact
heads. Rejection due to an unsupported import, parser error or absent
library does not count as passing the borrow checker.

The nine active compiler-owned value/state implementations were audited
as the same normalized source body (comments/whitespace and Java-only
`monotonic_now` removed). This is **source consistency only** and does not
mean the nine independent compilers understand or execute that source.
The `.atto` and `.realtime` repositories remain bootstrap targets.

### Core/ownership invariant and negative duration classification (candidate)

In each of the nine active, separately owned `.atto` implementations, the
nanoseconds and scaled duration factories now reject **negative** values with
`NegativeDuration`, reserving `DurationOverflow` for positive scaled values
outside signed-i64 range. The 28 BigInt reference vectors include all five
negative scaled units. These reference checks are **not** guest execution.

The core compiler's ownership checks must also reject assignments to the
fixed `Duration.nanos` and `Instant.ticks_ns` fields after their constructors
return. A mutable owner binding (`val` or `let mut`) does not grant permission
to mutate a fixed class field. Two additional source fixtures,
`core-negative-duration-nanos-write.atto` and
`core-negative-instant-ticks-write.atto`, require **compile-time fixed-field
rejection with no output artifact**. Java's linked-compiler JUnit suite and the
LLVM AOT admission script contain the matching backend-local gates. Until
the exact-head source Actions execute, the eleven compiler matrix remains
`NOT_EXECUTED` for these two core ownership cases.
