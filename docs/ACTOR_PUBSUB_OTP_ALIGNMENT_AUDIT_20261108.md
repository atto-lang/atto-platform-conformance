# ActorGroup / PubSub / OTP alignment audit — 2026-11-08

**Status:** source-free reference-model hardening, stacked on conformance draft #305 at `570bdfb430b854c9c2386cbada7d714b355a9581`. No compiled AttoLang guest, native runtime, runner, or distributed cluster has been executed by this change. The Node test file is authored but currently **NOT_EXECUTED**.

## Semantic boundaries

- `ActorGroup` membership is scoped cooperation, routing eligibility, and capability admission. An actor can belong to several groups without transferring lifecycle, allocator, supervisor, or private-state ownership.
- `Topic<T>` is a typed event namespace; `Subscription<T>` is an independent revocable delivery edge. Joining a group alone neither subscribes to topics nor grants publishing rights to another group.
- A publisher may publish without subscribing. A group-scoped publication requires the exact live group membership authorization and actor-turn authority at the eventual guest-runtime boundary. A topic name or actor ID is never a sufficient credential.
- Two distinct subscriptions, e.g. to two groups sharing one actor, remain distinct delivery edges. Do not silently deduplicate across independently authorized subscriptions.
- `ActorRef.send` is direct mailbox messaging; `ActorGroup` discovery is not a broker; `PubSub.try_publish` is atomic per-topic bounded multi-recipient admission, not consumer ACK, replay, or delivery processing success.
- Unsubscribe cancels queued-not-started deliveries; an already-started delivery must quiesce before `get_done()`. This differs deliberately from `Channel<T>` close/drain semantics.

## Erlang/OTP parallels and non-equivalences

Erlang `pg` offers scoped process discovery and monitored membership changes. It does **not** automatically subscribe a process to arbitrary events. Erlang repeated joins are reference-counted and distributed membership views can be temporarily divergent; AttoLang v1 intentionally uses idempotent affine group grants, authenticated local admission, and exact actor-incarnation fencing. Any Erlang-compatible refcounted adapter must be a separately versioned facade, not a covert change to core ActorGroup semantics.

Erlang process monitors deliver `DOWN` independently of ordinary events. An eventual AttoLang `GroupMembershipMonitor` should therefore be a separately authorized CONTROL/metadata subscription with generation-tagged snapshots/deltas and bounded registration. A topic publication must not impersonate actor STOP, supervisor panic, or monitor notifications. A distributed `pg` provider may offer eventual discovery but must never be represented as consensus authorization or as a substitute for locally validated subscription/publish grants.

Erlang `gen_event` employs an event-manager/handler model; AttoLang does not invoke user code synchronously inside pub/sub admission or teardown locks. Delivery is scheduled through existing actor turns, ownership and supervisor rules.

Sources: https://www.erlang.org/docs/29/apps/kernel/pg.html ; https://www.erlang.org/doc/system/ref_man_processes.html ; https://www.erlang.org/docs/22/man/gen_event.html

## Audited concrete defect and fix

Before this branch, `PubSubReference.close()` cleared `#memberships` without revoking the corresponding `#grantStates` WeakMap entries. Although publication was blocked by the closed-broker guard, a caller retaining an old frozen `GroupMembership` could still invoke `leave(oldGrant)` and obtain success. This violates the capability-revocation invariant: merely dropping an index is not equivalent to invalidating issued grants.

Fix: mark **every** held membership entry `active=false` before clearing the registry. The added regression creates one actor with two group memberships and two scoped topics, starts an in-flight delivery, closes the broker, and checks stale leave denial, no new admission, queued cancellation, and post-close in-flight quiescence. A second broker with the same names and actor incarnation remains unaffected, and its active grant cannot be substituted by the stale foreign grant.

This proves a **deterministic reference-model invariant only once executed**, not concurrent atomicity, runtime isolation, compiler lowering, or backend certification.

## Separate Java runtime finding

[Java issue #2708](https://github.com/ores-truffle-oreslang/oreslang-source.java/issues/2708) tracks a source-inspection risk: draft Java `ProcessGroupRegistry` invokes group retirement from inside its registry monitor, while ActorGroup/EventBus channel teardown can settle Future callbacks. Require a two-phase detach-under-lock / close-after-lock protocol and a pending-reader reentrancy regression before relying on the `pg` facade in a concurrent runtime. Related source draft #1700 and teardown draft #1230 are not certified by this reference-only change.

## Release verification (fail closed)

1. Run `node --test tests/actor-pubsub-broker-close-grants-20261108.test.mjs` plus the existing reference-model, quota, and evidence tests at this exact PR head. Capture runner, workflow/run/job IDs and nonzero steps. Until then report **NOT_EXECUTED**.
2. Reconcile this fix with #305 and its stacked multi-group churn tests #613, with no changes to PS001–PS026 normative expectations unless versioned.
3. Prove source-level authority, `Sendable` / `rt share`, atomic RELIABLE admission, cancellation, quiescence, per-topic sequence, and generation fences using compiled guest fixtures and real concurrent stress on each backend. Backend-local host and parser checks are evidence of only those layers.
4. Check Java/GraalVM, LLVM native, Wasm/worker, .NET NativeAOT, and independent Cranelift individually. **Forge is a separate backend** requiring its own verification and cannot be counted as Cranelift by renaming. Do not advance release certification from reference-model tests.
5. Keep exact-head/private-source tree evidence and source-org security controls; zero-step Actions runs remain **NOT_EXECUTED / NOT_CERTIFIED**, and no private-source mirroring is authorized by this document.
