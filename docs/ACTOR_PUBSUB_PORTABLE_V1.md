# Actor/ActorGroup portable in-memory pub-sub v1 (proposed)

**Status:** normative target + executable *JavaScript reference oracle*, **NOT** an implemented or guest-executed five-backend feature. Versioned machine-readable cases: [portable-v1.json](../contracts/v1/actor-pubsub/portable-v1.json). Run `node --test tests/actor-pubsub-portable-v1.test.mjs`. The model has no threads, compiler or actor scheduler: passing it proves only that the model agrees with the vectors, not real linearizability, runtime safety, or compiler parity.

## Zero language keywords

Do not create `define publisher` or `define subscriber`. This is a typed standard library and runtime protocol. Minimal public types: `PubSub`, `Topic<T>`, affine `Subscription<T>`, `PubSubDelivery<T>`, `PublishReceipt`, and existing `ActorGroup` / affine `GroupMembership`.

Illustrative Oreslang source **only; not parser-verified**:

~~~ores
let bus = PubSub.local()
let events = bus.topic<Event>("orders.created")?
let group = ActorGroup.new()
let member_a = group.join(worker_a)?
let member_b = group.join(worker_b)?
let group_sub = bus.subscribe(events, group, capacity: 32)?
let audit_sub = bus.subscribe(events, audit_actor, capacity: 32)?
let receipt = bus.try_publish(events, rt share Event(id: 42))?
group_sub.unsubscribe()
await group_sub.get_done()
~~~

Each actor receives `PubSubDelivery<T>` via the ordinary `receive(Message)` actor path. No synchronous guest handler invocation from `try_publish`, no separate actor lifecycle, and no implicit parking or host-thread blocking. Synchronous `try_publish` is a nonblocking admission attempt; async behavior can be added later by explicit composition with existing scheduling and channel primitives.

## Scope, names, ownership, and authority

- `PubSub.local()` creates an explicitly owned broker within one runtime/isolate domain; the broker is not an ambient singleton. The application/service creates and passes a capability to authorized actors. Cross-tenant publication and subscription require explicit, independently checked authority; a topic name is not authorization.
- Topic identity is **(broker instance, exact name)**. Once associated with a `T`, the name cannot be associated with a different `T` until that broker closes. Names are case-sensitive ASCII, 1–128 bytes, match `^[A-Za-z][A-Za-z0-9._/-]{0,127}$`. Oreslang symbols (`#ready`) are not string topic names, and identical names in two brokers do not alias.
- `T` must be `Sendable`; `rt share` enforces transitively immutable, lifetime-safe publication. No mutable pointer/borrow, borrowed actor arena, non-sendable host object or untracked interior mutation crosses the boundary. On failed admission the caller retains the exact original payload/share capability for retry.
- `Subscription<T>` is an **affine revocable control handle**, minted per registration and bound to its owning broker and target generation. Copying or forging a handle does not create an additional registration. An actor may hold multiple subscriptions.
- `GroupMembership` is a distinct affine capability for (group, actor incarnation). Actors can join multiple groups. A second join into the same group while live returns `AlreadyMember`; leaving closes only that membership. A group never owns the actor's lifecycle merely through membership.
- Joining a group is not subscribing to any topics. `subscribe(topic, group, capacity)` dynamically routes to current group members. In contrast `subscribe(topic, actor, capacity)` targets that actor directly. Each distinct subscription is independent; **no overlap deduplication** (two groups with one shared actor => two deliveries).
- Broker, actor, group and subscription IDs must be generation/identity fenced; restarted actors do not regain subscriptions or memberships from an older incarnation. An actor's termination revokes memberships and direct subscriptions; closing a group closes subscriptions targeting it.

## Atomic publication and bounded capacity

The publication *admission linearization point* is a single broker-defined atomic point shared by `try_publish`, subscription add/remove, group join/leave, target termination and close. The implementation may shard internally, but must preserve an equivalent observable serialization per topic and membership snapshot. No user callback executes while broker admission/lifecycle locks are held.

1. Validate topic and publisher capability, payload safety and broker state; take an eligible-target snapshot.
2. For each **(subscription, actor incarnation)** recipient reserve one outstanding slot. Outstanding = queued + active delivery attempts; capacity is a positive finite per-recipient bound.
3. On *any* quota, full, closed, or contention failure, roll back every reservation without a sequence number, queue entry, transfer, or handler call. `Full` and `Busy` are explicit ordinary `Result` errors, not panics. No implicit loss or automatic retries.
4. After all reservations succeed, assign one nonwrapping unsigned 64-bit topic sequence and atomically commit all enqueues. If no subscriptions or eligible members exist, the publish still succeeds with zero recipients and a sequence, but retains no event for future subscribers.
5. `PublishReceipt` reports the accepted topic sequence and number of recipient delivery attempts, **not** consumer processing acknowledgement.

Per-topic publication sequences are globally increasing across publishers. Each subscription-recipient queue starts delivery attempts in increasing topic sequence, but may observe gaps when not eligible for earlier publications. Different recipients are independently scheduled. Completion order can differ; no transaction across handlers is promised. Race scheduling may choose either order of concurrent publishers but every recipient must observe a consistent admitted order.

The baseline guarantee is **at most one delivery attempt to each eligible recipient of each successful publication**. No persistence, replay, retransmission, automatic deduplication, exactly-once application processing, or implicit acknowledgement. Optional `LATEST`, `LOSSY`, wildcard, durable, and async waiting policies are out of scope for core v1; they must use explicit versioned extensions instead of silently changing `try_publish`.

## Unsubscribe, cancellation, and quiescence

`unsubscribe()` is idempotent: it fences future admission *and handler starts*, cancels queued-but-not-started deliveries, and does not arbitrarily interrupt running guest code. `await subscription.get_done()` completes after all already-started handlers leave their execution boundaries and their owned shared references are released. A handler must never wait on its own subscription's quiescence.

Membership leave similarly fences future group deliveries and cancels queued deliveries for that membership's actor in subscriptions of that group only. Actor stop/panic fences new starts across all its subscriptions, removes its memberships, and waits for relevant in-flight work at the existing actor lifecycle quiescence barrier. Broker close prevents future admissions, cancels pending deliveries, and waits for in-flight work before final reclamation. Idempotent close must never resurrect an old handle or lose a refcount.

**Important distinction from bounded Channel<T> close:** the existing bounded-queue contract preserves already-admitted items for FIFO drain after channel close. Pub-sub *subscription cancellation* intentionally discards queued items. Implement this through explicit subscriber-generation cancellation and queue/reference cleanup. Do not relabel a Channel close as unsubscribe or silently weaken the bounded-queue contract.

## Errors and failure isolation

Ordinary operations use `Result<_, PubSubError>`: `InvalidName`, `TopicTypeMismatch`, `AlreadyMember`, `InvalidCapacity`, `Full`, `Busy`, `ResourceExhausted`, `Closed`, `SequenceExhausted`, `StaleActor`, `StaleTarget`, `NotShared` as appropriate. In the final Oreslang API, a failed `try_publish` must return ownership of the original payload/capability, consistent with the core bounded-queue rejected-push ownership rule.

An actor's `throw` or `raise` follows the existing recover/catch contract. An unrecovered failure that becomes `panic` routes to the supervisor CONTROL path; the broker must not catch and retry it or publish it as a normal event. Closing one group or terminating one subscriber cannot shut down unrelated groups, actors, brokers, or topics.

Resource caps must be finite for real-time/embedded profiles. No implicit global group registry, actor-thread pinning, JVM object identity, CLR channel semantics, Wasm worker semantics, or Redis network behavior can leak into the guest source contract.

## Redis adapter boundary

Redis Pub/Sub, Streams, or other network transports are **explicit bridges**. They are not `Topic<T>` implementations with hidden transport semantics. The bridge accepts encoded remote events, validates type/capability/quota, and attempts local `try_publish`; local backpressure may produce an explicit bridge-level error. Remote delivery, acknowledgement, ordering, retention and replay rules are not upgraded by this API.

## Existing .NET draft #327 and migration gates

The open draft [oreslang-source.net PR #327](https://github.com/ores-truffle-oreslang/oreslang-source.net/pull/327) already has an `ActorPubSub` host substrate and a **different** experimental `actor-pubsub.v1` contract. Its topic scope is group-bound; publication/subscription require membership; duplicate group join is idempotent; ordering is only per publisher/subscription; and it exposes RELIABLE/LATEST/LOSSY modes. Those are **not automatically compatible** with this portable core. Do not merge the two without explicit version negotiation or compatibility migration. Keep PR #327 draft until source lowering, safety gates, and shared vectors agree.

## Conformance and evidence

`contracts/v1/actor-pubsub/portable-v1.json` defines 20 shareable action vectors (PS001–PS020) covering topic identity, empty topic, actor fan-out, overlapping groups, multi-membership, order, all-or-nothing full, in-flight accounting, unsubscribe/stop/close, immutable payload, stale generations, and group eligibility. `models/actor-pubsub-portable-v1.mjs` is an executable deterministic trace oracle, not a compiler or concurrent proof.

For **each backend**: run the same fixture from an exact checked-out source SHA, separately report source parsing/type checking, runtime substrate behavior, and an actual compiled guest execution trace; reject unsupported guest syntax before artifact creation. Run stress tests for concurrent atomic admission and lifetime refcounts with sanitizers where appropriate. Must not promote `NOT_EXECUTED` to passed on the basis of an oracle run, host-only test, zero-step CI, a fake compiler, or a guessed source-binary relationship.

The required source backend matrix is Java/Truffle, LLVM/native, Wasm, Cranelift/Forge, and .NET NativeAOT. The five-backend ledger lives in `contracts/v1/actor-pubsub/backend-status.pending.json`. The portable contract cannot be called implemented until all five have produced independently executed, exact-head, nonzero-step guest evidence.
