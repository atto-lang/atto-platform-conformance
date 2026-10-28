# Oreslang Task/Future chaining v2 — explicit layers and authority

**Status:** target language contract, not executable parity. Companion acceptance manifest:
`fixtures/future-chaining/v2/manifest.json`. The Node manifest test is a **source-free structural check**, not a compiled guest execution.

Related: [issue #205](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/issues/205),
[Java draft #2195](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2195),
[Java canonical flat_map draft #2201](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2201),
[Java Future-pipe draft #2048](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/2048),
[interop draft #192](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/192),
[nested wrapper draft #201](https://github.com/ores-truffle-oreslang/oreslang-platform-conformance/pull/201).

## 1. Types and execution

- `Future<T>` represents a detachable observation of an already-started producer, not authority to cancel its Task or physically reclaim its memory.
- `Task<T>` is a scheduler/scope-owned execution with cancellation authority and separate `get_done()` physical-retirement receipt. An already-running Task is **not** a lazy recipe.
- `TaskStep<T>` is a single-use deferred factory for bounded `Task.parallel_limit`, `Task.series`, DAG, and retry admission. Calling a Task combinator over existing Futures never secretly restarts them.
- `Future.from_task(task { ... })` creates exactly one eager producer Task, no adapter Task. `Task.from_future(f)` creates one waiter Task, no replay. These conversion contracts are owned by PR #192.

## 2. Chaining: canonical source member names

| Expression | Statically required output | Contract |
| --- | --- | --- |
| `Future<A>.map(A -> B)` | `Future<B>` | preserve B even if B is a Future |
| `Future<A>.flat_map(A -> Future<B>)` | `Future<B>` | remove exactly one returned Future layer |
| `Future<Future<B>>.flatten()` | `Future<B>` | remove one layer only |
| `await Future<A>` | `A` | suspend waiter, remove one layer only |
| `Future<A>.compose(...)` / `.flatMap(...)` | same as `.flat_map(...)` | legacy compatibility; formatter can later normalize |
| `future |> checked_stage()` | checked type-dependent Future result | compiler-lowered operator, **not** a direct `.map` call |

`map(A -> Future<B>)` **must** yield `Future<Future<B>>`; never turn this into `Future<B>` for compatibility. Direct invocation `fn(future)` does not magically become a checked Future-aware `|>` stage. For `Future<Future<Future<C>>>`, a single `await`, `flat_map`, or `flatten` must not collapse all three layers.

The checked source `|>` path in Java draft #2048 is intentionally different: a checked unary stage returning a Future can flatten that stage's returned layer. Preserve compiler-issued provenance and prove stage ownership rather than rewriting arbitrary direct calls into lifted operations.

Only `snake_case` is canonical for newly specified Oreslang methods. Do not silently equate observational `on_success` with legacy dependent-future `onSuccess`: a detachable callback registration needs its own tracked, scheduler-confined, once-only API (Java issue #1916).

## 3. Effects, cancellation and ownership

1. `map`, `flat_map`, and `flatten` preserve the producer's logical result and never inherit upstream cancellation authority just by receiving a Future. Stage-created work is owned only with a checked explicit scope/capability. No caller can cancel a borrowed input merely by cancelling a derived observation.
2. Ordinary user-thrown `CancellationException` is `FAILED`; genuine runtime cancellation is authenticated `CANCELLED`. Trap/recover ordinary errors without swallowing untrappable actor panic or supervisor CONTROL notices. A `Future<Result<T,E>>` value-level `Err(E)` is not the same as a FAILED Future.
3. Callback execution is scheduler-queued and non-inline (including already-settled Futures and synchronous registration). Callback thread/I/O/reactor/actor-turn reentry is forbidden.
4. Affine/move-only results can be claimed once. Multiple observers require Copy/shareable payload or checked exclusive transfer; no alias reclaims actor arenas.
5. `Future.all/zip/any/race` observe existing Futures; do not treat fail-fast result settlement as producer retirement. `Task.parallel_limit` admits lazy child TaskSteps, holds concurrency credits until `get_done` confirms retirement, and drains owned children before scope reclamation. Preserve parent cancellation/authentic ownership boundaries and stable error aggregation.
6. Retry operates on a *new* Step per attempt with explicit idempotence/effects, bounded attempts, timeouts/backoff and admission quotas. Never retry an existing settled Future. Stream `merge_map`/etc require bounded demand, with `switch_map` only cancelling owned inner work.

## 4. Acceptance and evidence

The manifest records three positive guest-source targets plus three negative type-check targets. These are *not* assertions of current backend support. Targets: Java/GraalVM (JVM and Native Image), LLVM native, .NET full NativeAOT, wasm32 guest, Forge native. Unsupported semantics must fail closed, without parser-only success being reported as runtime support.

For each case, an authorized real compiler must emit exact fixture digest, compiler commit/tree, binary SHA-256, invocation, meaningful runner steps, explicit positive stdout/value or specific negative diagnostic, scheduler event trace, producer count, cancellation authority, and independent physical `get_done` receipts where applicable. Status is PASS/FAIL/UNSUPPORTED/INFRASTRUCTURE_ERROR or PENDING; a zero-step job or a Node source-free manifest test cannot promote PENDING.

**Private-source safety:** no cross-organization mirroring or source-bearing artifact writes without the reviewed private-source authorization policy. Preserve draft PR gates until stepful exact-head execution exists.
