# Task / Future / Observable interop security and liveness audit (2026-10-27)

**Status: SOURCE INSPECTION + PROPOSED REPAIR GATES, not a successful five-backend implementation audit.** Current checked-in conformance branch contains models and proposed \`.ores\` fixtures only. All source execution/native AOT claims remain pending.

## Evidence examined

- Java current-main \`OresScheduler\`: resumable Task, source \`Await/Cooperate/Done\`, owner-bound scheduler, cycle-aware Future await graph, separate scheduler-carrier and callback boundaries.
- Java current-main \`OresFuture\`: runtime-only completion, cancellable raw \`OresFuture\`, detachable waiter registration, deferred cancellation and notification-drain receipt.
- Java current-main \`TaskHandle\`: distinct \`result()\`, \`getDone()\`, task cancellation and post-quiescence logical-resource cleanup. \`TaskScope\` owns tracked child cancellation/joins.
- Java draft Task-as-Future projection #1379 explicitly returns the same cancellable \`OresFuture\`; it is **not** proof of a safe public non-owning conversion.
- Java \`docs/REACTIVE_STREAM_TASK_INTEROP_V1.md\` already proposes \`Observable.from_future\`, \`first():Future<Option<T>>\`, \`single():Future<T>\` and rejects bare \`await observable\`; source-level typed Observable bridge implementation remains unproven.
- LLVM current main has separate native signal/Task/Future contract foundations and drafts, but **not** verified source support for the proposed conversion matrix.

## P0 blockers / normative remedies

### I-01 — Raw Future capability leakage (authorization)

**Hazard:** exposing the very same cancellable runtime Future through \`Future.from_task\`, \`Task.to_obs\`, or \`Observable.from_task\` lets untrusted observers cancel an independently owned producer. In Java draft #1379 \`asFuture()\` returns a raw identical Future.

**Required:** project a distinct *observer-only* Future/Observable handle or a sealed trusted read-only view. The source producer's authenticated cancellation token MUST NOT be reachable from that handle, even through \`cancel()\`, nested \`first/single\`, \`select\`, \`Future.all/race\`, or re-export across an actor boundary. Cancel the **view/registration** only. Producer cancellation requires an explicit independently checked capability transfer. Include host and source malicious-observer tests and verify no identity/capability alias to the producer handle.

### I-02 — Terminal value vs quiescence (use-after-free / hot swap)

**Hazard:** \`Task.from_future\`, \`Task.from_observable\`, or \`#first\` can publish a value while the underlying publisher's callback, scheduler turn, owned lock release, actor arena or FFI loan remains active. An adapter's \`get_done()\` does not certify the upstream producer's physical retirement.

**Required:** hold **two distinct private receipts**: (a) the adapter's subscription/waiter plus callback-notification drain and owned lexical/lease cleanup; (b) actual owner-scoped producer \`get_done()\`/quiescence. Never replace (b) with (a), and never make the receipt cancellable by the guest. A cleanup failure *quarantines* loans and must not become safe DONE. Actor STOP and generation retirement join every actually owned producer and adapter independently. For \`#first\`, request unsubscribe promptly, then delay reclamation until detach/drain is physically certified. If the result contains a borrowed resource whose lifetime depends on subscription cleanup, require borrow/region proof or prevent public success until the relevant safety barrier.

### I-03 — Subscribe-before-token synchronous emission (premature success)

**Hazard:** \`subscribe(callback)\` can invoke \`on_next\` and \`on_complete\` or \`on_error\` before it returns a valid unsubscribe token; cancellation may also win during registration. A successful Future visible before a failed/invalid subscription can retain a stranded callback and forge resource retirement.

**Required:** bounded \`REGISTERING -> ACTIVE -> TERMINAL -> DRAINED\` admission with a **one-time subscription identity**, staged synchronous notifications (for cardinality \`#single/#first\` at most two are needed), validated unsubscribe+drain witness before externally publishing buffered terminal success, and atomic winner selection against cancellation. A null/invalid detach token or registration exception defeats any pre-return success. Cleanup action is invoked **at most once**, outside lifecycle/arbiter locks. Invalid/failed unsubscribe is a retained cleanup failure, not safe completion. Late or duplicate post-terminal events are inert but diagnosable.

### I-04 — Cardinality ambiguity & type erasure

**Hazard:** \`#single\` accidentally acts like \`#first\`, \`#first\` silently returns raw T, or an error is interpreted as normal empty completion.

**Required:** compiler-checked named \`mode=#single\` and \`mode=#first\`. \`#single: Future<T>/Task<T>\` succeeds **only after exactly one on_next AND on_complete**. Zero => \`EmptyObservableError\`; second => \`TooManyElementsError\`. \`#first: Future<Option<T>>/Task<Option<T>>\` wins at first element as Some and unsubscribes; empty completion => None. Direct \`await Observable<T>\` remains a type error. \`Observable<void>\` from a void Future/Task is event-only: complete with zero emissions. Thus converting it with \`#single\` yields EmptyObservableError; with \`#first\` yields None. Never manufacture a fake void value, and do not collapse \`Option<T>\` data None into an absent emission.

### I-05 — Multi-subscriber non-Copy result duplication

**Hazard:** \`Future.from_task\` and \`Observable.from_future\` replay values to multiple subscribers. If \`T\` is affine/move-only, this can duplicate a handle/capability, double-release or read freed memory.

**Required:** compile-time one-claim move semantics across all aliases or an unforgeable dynamic exclusive observer admission for the one permitted affine claim. No second subscription, no lazy re-read of moved source, no implicit deep copy through \`Future.all\`, \`share\` or \`to_obs\`. Only proven Copy/frozen/shareable T supports multi-subscriber delivery; \`rt share\` must be authorized for the relevant domain. Failed claims preserve the original owner's lifetime.

### I-06 — Callback reentry / quota starvation / hard real-time

**Hazard:** native completion hooks, host \`CompletableFuture\` callbacks or timer/IO/carrier code may run guest observers inline, reenter actor state under locks, or retain an unbounded number of subscribed observers.

**Required:** callback only enqueues a bounded scheduler/actor continuation (never guest-code invocation). Capacity includes *registered callbacks + enqueued notifications + retained result/payload bytes + terminal-drain receipts*; admission rejects/backpressures before subscriptions become visible. One OS carrier must progress while a Task awaits another Future. No per-adapter executor, per-subscription threadpool or blocking \`join()\` on carrier. Hard-RT profiles must have preallocated bounded registration and deterministic scheduling, otherwise reject at compile/admission time.

### I-07 — Effect, cancellation, panic and cross-domain trust

**Hazard:** treating a user-raised \`CancellationException\` as genuine cancellation, demoting panic into \`on_error\`, or resuming with stale hot-generation/foreign actor capabilities.

**Required:** genuine CANCELLED only from runtime-authorized authority, arbitrary thrown cancellation-named errors remain FAILED. Typed throws/raises/recover semantics must survive; untrappable panic routes supervisor CONTROL and cannot be caught by Observable operators. Compiler validates Send/Sync and actor Sendable independently, affine \`rt take/share\`, permission scopes, actor sealed state and generation tickets. Every stale or foreign continuation/owner key is rejected before callback publication, not just detected on cleanup.

### I-08 — Fake-green conformance

**Hazard:** proposed .ores examples can exit successfully without printing or asserting their expected values; parser rejection can falsely satisfy a compiler-negative fixture; zero-step Actions can be misreported as successful tests.

**Required:** machine-readable expected value, exact error category, event sequence/cancellation identity and \`get_done\` receipt per fixture, verified by a real compiler/executable runner. Negative fixtures must assert the intended type/ownership diagnostic; generic syntax errors do not count. Evidence includes exact source tree SHA, compiler/executable hash, command+exit/status, runner assigned with nonzero actual steps, trace schema/version, backend/profile and sanitizer/native-AOT mode. Never change \`pending\` without matching independently inspected receipts. Add source-free \`node --test\` manifest/oracle check, but it does NOT constitute source runtime proof.

## Minimal verification order

1. Run \`npm test\` in the exact conformance branch: validates manifest/inventory and deterministic pure reference-state interleavings ONLY.
2. Implement Java guest parser/formatter/type-checker and fail-closed negative checks, then execute actual Java source with single carrier and deterministic callback registration/cancellation races.
3. Prove caller-side observer capability cannot cancel Task and \`#first\` cleanup cannot release borrowed resources ahead of physical quiescence.
4. Prove exact-head GraalVM Native Image executable and LLVM native full AOT binary against the same typed fixtures; include ASan/UBSan where applicable.
5. Run equivalent positive/negative and hard/soft-RT profile checks on WASM/Forge/.NET, with unsupported syntax rejected before lowering. Keep release gate closed until all requested backends have executable receipts.

**Tracking:** conformance draft PR #192; Java #2150; LLVM #1083; WASM #149; Forge #113; .NET #183. No authorized Git source replication to alternate organizations is implied by this audit.
