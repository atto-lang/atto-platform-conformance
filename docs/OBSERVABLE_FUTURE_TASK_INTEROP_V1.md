# Observable<T> ↔ Future<T> / Task<T> — interoperability v1

**Status: proposed guest API / cross-backend conformance only. No runtime or source compiler parity is claimed.** Complements `docs/FUTURE_TASK_INTEROP_V1.md` and conformance issue #152. Extends the existing Java `docs/REACTIVE_STREAM_TASK_INTEROP_V1.md` contracts: `Observable.from_future(f)` emits once, `Observable.first()` yields `Future<Option<T>>`, `Observable.single()` yields `Future<T>`, and bare `await observable` is illegal. Both `task { }` and `nb { }` are eager Tasks; converting them does NOT re-execute their bodies.

## Canonical names and exact result types (all proposed)

| Expression | Static result type | Effect and subscription semantics |
| --- | --- | --- |
| `Observable.from_future(f: Future<T>)` | `Observable<T>` | observe same started Future, zero new Tasks |
| `Observable.from_task(t: Task<T>)` | `Observable<T>` | observe same started Task via read-only Future projection; zero new Tasks |
| `f.to_obs()` | `Observable<T>` | exact alias of `Observable.from_future(f)` |
| `t.to_obs()` | `Observable<T>` | exact alias of `Observable.from_task(t)` |
| `Future.from_observable(obs, mode=#single)` | `Future<T>` | one owned subscription; wait for exactly one value AND completion |
| `Task.from_observable(obs, mode=#single)` | `Task<T>` | one tracked adapter Task awaiting one owned subscription; not a new producer |
| `Future.from_observable(obs, mode=#first)` | `Future<Option<T>>` | one owned subscription, first value => Some(T), empty completion => None |
| `Task.from_observable(obs, mode=#first)` | `Task<Option<T>>` | one tracked adapter Task; same first/empty contract |
| `obs.single()` | `Future<T>` | existing proposed Observable terminal operator; same cardinality as `#single` |
| `obs.first()` | `Future<Option<T>>` | existing proposed Observable terminal operator; same cardinality as `#first` |

The `mode` argument is a **required named source argument in v1**, even for `#single`. This prevents an arbitrary stream-to-single conversion from hiding cardinality. The `#single` / `#first` symbols follow Oreslang's `#` symbol syntax and are compiler-known modes, not arbitrary strings. Incorrect/missing modes must fail closed; no runtime-erased generic overloads. `mode=#single` is the recommended default policy, **not** an implicit default parameter.

### Canonical guest examples

```oreslang
const Future<String> f = Future.from_task(
    task { return "result"; }
);
const Observable<String> a = Observable.from_future(f);
const Observable<String> b = Observable.from_task(
    task { return "another result"; }
);
const Observable<String> c = f.to_obs();

const Future<String> exactly_one = Future.from_observable(a, mode=#single);
const Task<String> adapter = Task.from_observable(b, mode=#single);
const String value = await adapter;

const Future<Option<String>> first = Future.from_observable(c, mode=#first);
const Option<String> maybe_value = await first;
```

`t.to_obs()` is also supported and identical to `Observable.from_task(t)`. This API creates no `Future.new(task { ... })` alias. `Task.from_observable` may be lowered as `Task.from_future(Future.from_observable(obs, mode=...))` but MUST own one adapter, one subscription and its structured physical cleanup; not two adapter Tasks.

## Single-result source ⇒ Observable<T>

- **Hot/started origin, observer-driven delivery.** `from_future` and `from_task` wrap an already-started result. They do not restart producer work per subscription, and do not create a Task or dedicated OS threadpool.
- For successful nonvoid `T`: exactly one `on_next(T)`, then one `on_complete()` **in that order** per admitted subscriber, including late subscribers after the Future settled. `Future<void>` / `Task<void>`: **zero values then completion**, represented as `Observable<void>` if the compiler supports this event-only type; never invent a payload. `Future<Option<T>>` is one Option value (including None), not zero values.
- For ordinary failure: one terminal `on_error(cause)` and no values. Authentic producer cancellation remains CANCELLED as a distinct terminal outcome, never converted to an ordinary `on_error(CancellationException)`. Untrappable panic goes to supervisor CONTROL; it cannot be treated as a catchable Observable error.
- Unsubscribing/cancelling a borrowed observer detaches its registered listener **only**. It NEVER cancels or physically retires the original producer. `Observable.from_task` retains originating TaskScope lifetime and producer `get_done()`; a subscription's shutdown is not the producer's physical-quiescence proof.
- Two subscriptions to the same source both observe success/error/terminal outcome as permitted by `T`'s capabilities; `T: Copy` or approved immutable `rt share` can be delivered to several, but **affine/move-only T cannot be duplicated**. Compiler must enforce exclusive single-consumer result claim or reject multi-subscribe until a sound ownership implementation exists.
- No guest observer callback runs inline on timer, I/O, JNI or producer completion threads or underneath actor/scheduler locks; enqueue delivery to subscriber's scheduler/actor turn. Terminal-before-subscribe and synchronous settlement must be serialized without a lost signal.
- Admission, waiter registrations, pending notifications and per-subscriber demand are **bounded**. A single-value source may reserve one item of credit or wait for demand; may not allocate unbounded buffering. No invented replay cache that leaks mutable payloads or capabilities.

## Observable<T> ⇒ Future<T>/Task<T>: terminal reduction

`Observable` is a 0..N source. **Bare `await obs` is a compile-time error**; no implicit `Observable<T>` to `Future<T>` or `Task<T>` coercion. The explicit `mode` determines cardinality and type.

### `mode=#single`: exactly one

- Subscribe once **when the conversion is invoked**; Future represents an already-initiated reduction.
- First `on_next(value)`: provisionally capture exactly one checked result, do **not** publish success yet. `on_complete` with exactly one captured value: publish success. Empty `on_complete`: `EmptyObservableError`. Second `on_next`: fail with typed `TooManyElementsError`, revoke subscription and release provisional value safely.
- Pending or infinite Observable with one emission and no terminal completion: remain pending; caller can use separately bounded timeout/cancellation. A `#single` collector must **not** silently act like `#first`.
- `on_error(err)`: reject preserving exact typed cause and authenticated fatal routing, release captured value, unsubscribe. Authentic producer cancellation propagates an authenticated CANCELLED result only when proved; an ordinary user-thrown cancellation-named error is FAILED.
- If values are affine, capture/transfer with one compiler-owned claim; no double consumption or use after unsubscribe. No spilling unbounded values.

### `mode=#first`: first or None

- Subscribe once. First item atomically wins; produce `Some(value)`, detach subscription and settle without waiting for completion. Empty `on_complete`: produce `None`. `on_error` before a value preserves failure; authenticated cancellation preserves cancellation.
- A winner racing an error, cancel, second event or terminal event uses one linearization rule; no double completion or reentrant guest callback. Unsubscribing after first is **subscription cancellation**, never an unauthenticated cancellation of a shared source producer.
- Returning `Future<Option<T>>` / `Task<Option<T>>` matches existing `Observable.first()` semantics; **do not** silently throw on empty for `#first`.

### Ownership/lifecycle/scheduling

- `Future.from_observable` creates one bounded reduction/subscription state machine, **no Oreslang Task merely to wait**, though a cold Observable may admit its own explicitly owned producer upon subscription. The bridge owns *subscription rights*, not the external producer. The target Future is the observation of this reduction and can cancel the reduction's own subscription.
- `Task.from_observable` creates exactly one tracked adapter Task and the same one subscription. Cancellation requests stop *adapter and its owned subscription* and then await their physical quiescence before releasing captured `T`/borrowed arena memory. It cannot cancel an independently owned Observable producer.
- **Synchronous subscription callbacks:** stage all `on_next/on_complete/on_error` until registration returns an authenticated valid unsubscribe/retirement token; if registration fails, terminal success must not escape first. Detach exactly once after terminal/cancel/race, even for synchronous first/empty/multi emission.
- `Task.get_done()` for adapter waits for its continuation, its subscription callback drain and all **owned** cleanup, but it does not assert the physical retirement of a separate producer. Actor STOP, hot generation fencing and borrow scopes must join the actual producer's retirement as appropriate.
- Multiple subscribers to hot Observable still follow explicit broadcast/share; `Observable.from_ch` still represents competing-consumer work sharing, not a hidden broadcast. No new privilege to access sealed actor state or re-enter actor handlers.
- Cancellation, error and panic effects survive the conversions unchanged. The guest cannot resolve/reject a Future using a forged token; source `T` must pass Send/Sync, `rt take/share/borrow`, generation and permission gates. Full AOT, deterministic bounded admission, no reflection or mandatory GC.

## Required verification

See `fixtures/observable-future-task-interop/v1/manifest.json` for positive/negative/race vectors. All begin `pending` with `runtimeVerified=false`.

Require real parser/formatter/type/effect/ownership validation and actual guest execution for Java/GraalVM and LLVM full-native AOT, plus explicit WASM/Forge/.NET parity. Cases cover success, failure, authenticated cancellation, void, late subscribers, duplicate subscriptions, synchronous registration, second item violation, first empty vs single empty, infinite single, cancellation/STOP/hot generation, affine result double-read rejection, demand/backpressure quotas, callback scheduler confinement, TaskScope physical retirement, and five-backend conformance. Exact source SHA, compiler executable hash, runner id/executed steps, trace and sanitizer output are mandatory before marking any vector verified.

Source-org zero-step Actions are infrastructure failures, not test passes. Do not export private source to an unapproved carrier; do not infer cross-backend support from documentation.


## Security audit closure rules (2026-10-27)

The binding audit `docs/OBSERVABLE_TASK_FUTURE_INTEROP_AUDIT_20261027.md` identifies eight mandatory release blockers I-01 through I-08. They remain OPEN for real source/runtime parity until checked execution evidence exists. Especially:

- **I-01 (capability identity)**: a result Observer/Observable projection must *not* return the same cancellable source Future identity. `cancel()` on the observer must detach only its own registration; private producer cancellation token never escapes.
- **I-02 (two retirement witnesses)**: winning `#first` and detaching subscription are not proof the original Task/actor producer has stopped. Adapter-owned subscription callbacks must physically drain before releasing borrowed arenas or publishing a clean `get_done` receipt.
- **I-03 (terminal-before-registration)**: synchronous success/error/cancel while subscribing is provisional until the unsubscribe token and its cleanup contract have been validated. An invalid/throwing detach action prevents clean physical retirement; retain/quarantine the resource loan rather than claiming success.
- **I-04 (void cardinality)**: `Future<void>` and `Task<void>` project to event-only `Observable<void>`: no on_next. Consequently `mode=#single` is EmptyObservableError; `mode=#first` yields None. A nested `Option<T>` value of None is still **one emitted value**, never treated as zero events.
- **I-05 (affine claims)**: a second subscriber must not gain a duplicate claim to move-only T. Require static exclusive ownership or a runtime unforgeable one-subscriber permit and fail closed.
- **I-08 (observed evidence)**: the manifest's `reference-traces.json` is an *independent pure model*, not guest execution. A green compiler fixture needs expected typed value/trace/cancel classification and actual binary behavior, not just successful exit or generic syntax rejection.

No design-level oracle, local Node reference model, interpreter-only path, or GitHub Actions job with zero executed steps certifies Java Native Image, LLVM AOT or five-backend parity.
