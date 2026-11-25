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

### 3.1. Cross-runtime host-stage observation (Java and analogous foreign futures)

The Java `OresFuture.from(CompletionStage<T>)` bridge is an **observer adapter**:
cancelling the observed `OresFuture` must not call `cancel()` on its foreign
stage merely because it implements `java.util.concurrent.Future`. An owning
`TaskScope` or capability may cancel the producer separately; an observer
has no right to revoke unrelated consumers' work.

A `CancellationException` reached through exceptional-completion propagation
is **not itself proof** of authenticated cancellation. The Java bridge requires
**both** a cancellation-shaped terminal exception and the foreign
`Future.isCancelled()` host state before mapping into CANCELLED. A host stage
that spuriously reports `isCancelled() == true` while supplying an unrelated
`IllegalStateException` must remain FAILED and retain the original error.
A stage without reliable cancellation state must preserve the exceptional
failure rather than invent cancellation authority. Host implementations can
differ in what `isCancelled()` means: `CompletableFuture` itself treats direct
exceptional completion with `CancellationException` as cancelled. This means
a foreign stage's reported cancellation is a host signal, **not cryptographic
or Oreslang-owner authentication**. Full guest-level authenticated cancellation
continues to require an Oreslang runtime-owned outcome/capability.

Test cases should include: cancellation of a borrowed adapter while the host
stage and independent observer continue; explicit host cancellation; propagated
`CancellationException` on an uncancelled dependent stage (must stay FAILED);
late host completion after observer cancellation; and a completion/cancellation
race. A generic foreign `CompletionStage` does not provide callback
unregistration, so the adapter's completion closure should retain the
Oreslang observer only **weakly**. This prevents a permanently pending host
stage from retaining a dropped observer's actor/task object graph while still
allowing a strongly held observer to receive ordinary completion. A retained,
late foreign callback must not resurrect cancellation. Weak capture does not
guarantee collection, unsubscribe the foreign callback, or establish a bounded
foreign-stage registration budget; those remain separate integration concerns.
Separately verify that a terminal Future's host notification-drain receipt
does **not** imply physical `Task.get_done()` retirement.

The same non-retention boundary applies to callback-only host registrars:
`OresFuture.fromCallback(registrar)` provides a single-shot completion
capability that an untrusted foreign registrar may retain indefinitely.
Its callback may only weakly retain the observer; a strongly held observer
must still accept exactly one producer settlement. A first late callback
after observer cancellation is ignored, while a second notification remains
a deterministic duplicate error. This weak reachability is **not** a
garbage-collection receipt or proof that a foreign registration was freed.
There must be no attempt to revoke the foreign producer merely to release
a borrowed listener.

The Java regression targets are
`src/test/java/dev/oreslang/runtime/OresFutureHostAdapterIsolationTest.java`
and `src/test/java/dev/oreslang/runtime/OresFutureCallbackRetentionTest.java`
on draft #2201. These are host-runtime regression tests only. They cannot be
used as substitutes for source-language guest execution, Native Image, actor
generation fencing, or independent backend receipts. Status is **PENDING** until
the exact-head Java JUnit suite actually executes.

### 3.2. Source-free fixture admission hardening

The source-free Node harness opens both `manifest.json` and every pinned
`.ores` fixture using `O_NOFOLLOW | O_NONBLOCK`, then verifies the opened
file descriptor with `fstat` before reading exact bounded bytes through that
same descriptor. It rejects symlink swaps, directories, FIFOs, oversized
inputs, mid-read truncation and growth; platforms lacking these no-follow
facilities fail closed rather than silently following links. This protects
harness input admission, **not** guest/compiler runtime sandbox isolation.

The seventh Node test exercises regular-file success and symlink/directory
rejection. Local mutation probes also confirmed symlinked manifest rejection
and nonblocking FIFO rejection. All eight guest-source fixtures and their
existing `sourceGitBlobSha1` identities remain unchanged.

## 4. Acceptance and evidence

The manifest records four positive guest-source targets plus four negative type-check targets, including deeper nested Futures that must retain their remaining layer after `flat_map`. These are *not* assertions of current backend support. Targets: Java/GraalVM (JVM and Native Image), LLVM native, .NET full NativeAOT, wasm32 guest, Forge native. Unsupported semantics must fail closed, without parser-only success being reported as runtime support.

For each case, an authorized real compiler must emit exact fixture digest, compiler commit/tree, binary SHA-256, invocation, meaningful runner steps, explicit positive stdout/value or specific negative diagnostic, scheduler event trace, producer count, cancellation authority, and independent physical `get_done` receipts where applicable. Status is PASS/FAIL/UNSUPPORTED/INFRASTRUCTURE_ERROR or PENDING; a zero-step job or a Node source-free manifest test cannot promote PENDING.

**Private-source safety:** no cross-organization mirroring or source-bearing artifact writes without the reviewed private-source authorization policy. Preserve draft PR gates until stepful exact-head execution exists.
