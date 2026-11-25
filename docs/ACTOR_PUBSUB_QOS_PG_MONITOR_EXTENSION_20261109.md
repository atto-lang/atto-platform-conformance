# AttoLang Actor Pub/Sub QoS and Group-Monitor Extension (2026-11-09)

**Status: SOURCE-ONLY PROPOSAL; NOT IMPLEMENTED OR VERIFIED IN ANY ATTO GUEST BACKEND.**

Stacked on #632 (payload admission), #631 (broker grant revocation), and #305
(portable v1). This is an additive reference-model experiment, not evidence
that an AttoLang compiler accepts these interfaces.

## Three responsibilities, not one

1. **ActorGroup** owns participation and membership grants, *not* actors'
   lifetimes or supervision trees. An actor may join multiple groups.
2. **Topic<T>/Subscription<T>** owns typed data fan-out, each consumer queue,
   delivery policy, credits, and admission receipts. Group membership does
   not automatically subscribe to topics.
3. **GroupMonitor** is a revocable observation capability for membership
   changes, not a Topic or mailbox. Monitoring cannot publish DATA, impersonate
   supervisors, mint join grants, or observe another tenant's membership.

This separation is inspired by Erlang OTP's `pg:monitor/2` and `gen_event`,
but it does not promise an Erlang-compatible API.

## Topic delivery policies (per topic, immutable after creation)

| Policy | Saturated recipient | Sequencing and notification |
| --- | --- | --- |
| RELIABLE | Reject *entire* fan-out with `Full`; do not consume sequence, reduction mutation, or subscriber credit | All current recipients admitted atomically; receipt is admission, **not** consumer ACK |
| LOSSY | Drop only the saturated recipient; continue for other recipients | Commit one topic sequence and count `accepted`/`dropped` |
| LATEST | Keep the newest *unread* delivery per recipient; replace older queued delivery, never an in-flight one | One pending slot plus at most one in-flight delivery per recipient; `start` returns `Busy` until prior processing is finished |

The source-free oracle's original three-argument `topic(name,type,group)`
retains RELIABLE as its default. The optional fourth argument selects a
policy: `topic(name,type,group,policy)`, with `topicInGroup(group,name,type,policy)`.
An already-registered topic with a different policy yields `TopicPolicyMismatch`.
Unknown policy returns `InvalidPolicy`. LATEST requires subscription
`capacity=1` (otherwise `InvalidCapacity`).

Receipts now additionally carry `accepted`, `dropped`, `coalesced`, and
`policy`; the existing `sequence` and `recipients` continue to work.
`recipients` is the number of eligible recipient edges, including LOSSY
drops. Counting multiple independent subscription edges is intentional, even
when the same actor appears through overlapping groups.

`topicStats(topic)` returns a **detached, frozen** host diagnostic snapshot
with `policy`, `sequence`, `published`, `accepted`, `dropped`, and
`coalesced`. Counters are decimal strings to avoid JavaScript number overflow.
No delivery payload or subscription capability is returned. Rejected RELIABLE
fan-out leaves these counts unchanged.

## Membership monitors (OTP pg analogue)

`monitorGroup(group, liveMembershipGrant, capacity=32)` atomically returns an
opaque monitor and an immutable snapshot of actor incarnation keys. Subsequent
`pollGroupMonitor(monitor, sameGrant)` returns only join/leave events:
`{kind, group_id, actor_key}`. The event stream is **not** a DATA Topic and
never carries arbitrary actor payloads.

- Monitoring requires an **exact current immutable membership grant**.
  Possession of a leaked monitor token alone is insufficient to read it.
- Repeated joins do not produce duplicate join events because AttoLang v1
  membership is idempotent. This intentionally differs from Erlang `pg`:
  repeated Erlang joins require matching leaves.
- A bounded monitor never silently drops topology events. If the queue fills,
  it invalidates the incremental delta stream and returns `MonitorOverflow`
  on every poll until `resyncGroupMonitor(monitor, sameGrant)` is called.
  Resync atomically provides a fresh snapshot and clears old deltas.
- `unmonitorGroup` reclaims quota and revokes the token. Owner leave, actor
  retirement, group close and broker close also revoke it. Group retirement
  never stops other group members.
- `maxGroupMonitors` bounds active monitors per broker. `maxGroupMonitorsPerActor` independently limits monitors across an actor's groups (default 16). `maxGroupMonitorQueueCapacity` limits queued changes per watcher (default 256); oversized requests fail closed. Monitor handles
  cannot be serialized as Sendable DATA, and group names do not grant
  membership or monitoring authority.

### Monotone revision cursors (proposed extension)

Every accepted join/leave transition increments a group-local arbitrary-precision
revision. `monitorGroup` and `resyncGroupMonitor` return `revision` as a
canonical decimal string alongside an immutable member snapshot; each join/leave
delta carries that same `revision`. A second group has its own clock.
Idempotent duplicate joins, rejected operations, monitor creation and topic
DATA events never increment membership revision.

`pollGroupMonitor(monitor,grant,afterRevision)` optionally enforces a strict
expected predecessor cursor. It accepts only canonical bounded decimal strings;
the next queued event must have `revision = afterRevision + 1`. If not, it
returns `RevisionMismatch` and leaves the queue untouched. Malformed cursors
return `InvalidRevision` without consuming anything. Overflow forces an
atomic snapshot/resync, never incremental delivery past missing events. A
monitor is immediately stale if its owning grant leaves, even with queued deltas.

This is a **local, single-threaded reference contract**. Real concurrent
backends must synchronize group mutations, monitor registration/snapshot and
resync under a single linearizable admission boundary. They must define
bounded counter rollover or an explicit epoch/key rotation and test it before
claiming production guarantees. Do not use this as proof of distributed `pg`
convergence, exactly-once delivery, or consumer handler acknowledgement.

This reference model is strictly **local**. Erlang `pg` offers distributed
membership with eventually consistent views. A distributed AttoLang provider
would need explicit membership epochs, gap detection, resnapshot, and security
domains; these guarantees cannot be inferred from this local oracle.

## Future AttoLang guest surface (illustrative; NOT compiler syntax proof)

Prefer ordinary typed methods and snake_case. Do **not** introduce
`publisher` or `subscriber` actor keywords. Potential typed APIs:

```text
ActorGroup<Event>.topic<Event>(name, policy)
Topic<Event>.subscribe(capacity) -> Result<Subscription<Event>, SubscribeError>
Topic<Event>.try_publish(shared_event) -> Result<PublishReceipt, PublishError>
Subscription<Event>.read_async() -> Event<Event>
ActorGroup<Event>.monitor_membership(capacity) -> Result<GroupMonitor, MonitorError>
GroupMonitor.resync() -> Result<GroupSnapshot, MonitorError>
```

These are **design signatures**, not runnable AttoLang source. Group monitor
ownership should remain actor-incarnation- and tenant-scoped. Await/suspend
operations must be borrow-checked; a `Topic`, `Subscription`, join grant or
monitor token is a non-Sendable authority unless the compiler proves an
explicit safe transfer. Supervisor CONTROL notices remain on a separate,
non-interceptable priority path.

## Test ledger and backend acceptance

Reference tests:
- `tests/actor-pubsub-qos-policies-20261109.test.mjs`
- `tests/actor-pubsub-group-monitor-20261109.test.mjs`
- `tests/actor-pubsub-monitor-revisions-20261109.test.mjs`
- `tests/actor-pubsub-hidden-native-slots-20261109.test.mjs`
- Existing 26 portable vectors and original quota/leave/rejoin tests

At commit `2ce371c888d90735f5106014e64d47cee665236b`, a separate V8
evaluation with a simulated `node:util.types` interface passed **11/11 new
test cases and 26/26 original vectors**. This is not native Node execution,
not an executable backend guest, and not a concurrency proof. **Exact GitHub
Actions Node/JUnit/native jobs remain required.** Future edits require new
exact-head validation.

Every backend (Java/GraalVM, LLVM native, Wasm/Workers, .NET NativeAOT,
Forge independent runtime and any Cranelift-specific backend) is currently
`NOT_VERIFIED` for this extension. Do not count a host JavaScript, C++, or
.NET reference surface as guest lowering or full AOT. A pass needs:

1. Compiler/type-checker negative tests for non-Sendable topics, monitor
   tokens, stale capabilities, wrong tenant, private/isolated actor boundary.
2. Real executable guest tests with group overlap, policy disagreement,
   concurrent publish/start/finish, bounded overflow/resync, and close/rejoin.
3. Adversarial real-scheduler tests for RELIABLE atomic reservation,
   loss/coalescing metrics, cancellation, unsigned u64 wrap, teardown without
   callbacks under registry locks, and watchdog/supervisor isolation.
4. Exact commit SHA, test selection, workflow/job/attempt, nonzero executed
   steps, individual test counts, and independent security approval.

Do **not** export private AttoLang source to another GitHub owner to acquire
Actions minutes while the private-source incident hold remains active.
