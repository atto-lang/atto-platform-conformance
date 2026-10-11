# Logical supervisor child identity (draft host contract)

The supervisor must distinguish three identities. None is a guest-usable lifecycle authority by itself.

| Scope | Java host | Native host | Meaning |
|---|---|---|---|
| Supervisor | `SupervisorId` + `ActorGroupId` | supervisor ID + runtime domain | Owner namespace |
| Logical child | `SupervisorChildRegistry.ChildId` | `SupervisorChildRegistry::ChildRef` | Stable reference across replacements |
| Incarnation | `ActorId` plus logical generation | `OresNativeActorRef` plus logical generation | Exact actor that failed |

The logical generation is a strictly increasing number starting at 1,
independent of the scheduler's generation or Java actor UUID. A native
replacement may occupy another actor slot whose scheduler generation is
1, while the logical child generation still advances.

## Required trusted host lifecycle protocol

1. Register a live, admitted actor under its supervising owner; mint an
   opaque logical child ID with logical incarnation 1.
2. Await actual physical finalization before marking the exact old
   `(child, actor, incarnation)` FINALIZED. Reject stale finalizers.
3. STOP consumes only the currently FINALIZED generation, marking it
   STOPPED. The host can retire the stopped record to bound memory; a
   retired child ID can never reactivate.
4. RESTART first creates/admit a genuinely new actor under the same
   supervisor with failure rollback. Only then may the owning runtime
   commit the replacement identity, atomically advancing its logical
   generation from FINALIZED to ACTIVE.
5. Competing terminal decisions must be generation-fenced so only one
   consumes a finalized incarnation.
6. Never hold the registry mutex while invoking guest callbacks or while
   waiting for spawn, cleanup, or lifecycle effects.

The registries do not themselves spawn actors, observe the physical
finalization barrier, provide durable effect receipts, or confer guest
restart authority. Their mutation APIs are exclusively host responsibilities.

## Proposed immutable Failure fields

- `f.child`: supervisor-scoped, stable logical child identity.
- `f.actor`: exact failed physical actor incarnation.
- `f.incarnation`: logical generation of the failed incarnation.
- `f.cause`: bounded typed terminal failure cause.
- `f.spawned_by`: optional actor lineage.

`self.restart(f.child)` will require the runtime-owned supervisor CONTROL
context, finalization proof, matching current FINALIZED generation, and
authoritative commit semantics. It cannot revive the old `f.actor`.
Returning from `on_panic` without a lifecycle decision must fail closed.

Supervisor CONTROL is implicitly single-flight. No `using self.control`
mutex or source-visible locking annotation is needed. At `await`, release
the physical worker but retain logical CONTROL ownership; actual
continuation lowering still needs independent proof.

## Current implementation and explicit limitations

The draft Java and native source branches now contain standalone
host-only logical-child registries and tests for stale generations,
cross-owner identities, stopped-child retirement, and competing
replacements. They are **not yet wired** into production failure
publication or real actor spawning. The current `self.stop(f)` restricted
source lowering does not expose `f.child`; general RESTART and ESCALATE
remain unimplemented. The native scheduler does not yet implement
source-level reincarnation.

Before enabling `f.child`, wire identity to trusted spawn registration,
actual physical finalization, exact generation-fenced CONTROL delivery,
replacement rollback, authoritative lifecycle commit and replay tests.
