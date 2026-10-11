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
4. RESTART must **reserve the FINALIZED generation first**, moving the
   child to RESTARTING and returning a single-use host-side permit. A second
   restart, STOP, or replayed permit cannot overtake that reservation.
5. Outside the registry lock, the trusted host spawns and admits a genuinely
   new actor. On success, commit the permit and advance the logical
   incarnation to ACTIVE. On any admission failure, clean up the spawned
   actor before aborting the permit back to FINALIZED. A fresh permit is
   required for any later retry.
6. Reject old physical actor identities (including A → B → A), stale permit
   nonces, cross-owner child IDs, and duplicate lifecycle decisions.
   Java keeps a capped used-ActorId ledger; native keeps a bounded
   per-slot scheduler generation high-water mark.
7. Never hold the registry mutex while invoking guest callbacks or while
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


## Audit validation and evidence

Funded, exact Git-blob verification:
https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/38179365985

- Java standalone host registry source: `bfaf3e1b1a89db52b721c74b3f2b33ff7175039f`
  compiled and passed a targeted reservation/race/rollback probe using
  minimal test-only ActorRuntime identifier stand-ins.
- Native C++20 registry source: `13939c7b51fda05aa4ca26cae358739cac249f3a`
  compiled under strict warnings and passed the mirrored regression source
  `ff83a47006577afc7f1994005af44cb2c251b686` normally and with
  ASan/UBSan. The native scheduler header was pinned independently.

**Evidence limitations:** This is focused, standalone registry verification;
it is not a full JUnit/Maven suite, full LLVM CMake/CTest, guest
`on_panic`/`await` execution, production lifecycle integration, or an
authoritative host restart effect. Reservation timeouts and cleanup of
orphaned replacement actors are duties of the future owning lifecycle
coordinator, not the standalone registry.


## Runtime wiring: spawn, finalization, and STOP acknowledgement

The Java ActorGroup now owns a trusted registry for its managed and
structured inherited children. Child admission records the logical child
before it can be used as a supervised actor; failed spawn/adoption rolls
back its registry association. A detached active worker loses the old
supervisor's registry authority without authorizing a restart.

At physical actor finalization, Java transitions the exact captured
`(logicalChild, ActorId, incarnation)` from ACTIVE to FINALIZED
**before** publishing its terminal CONTROL notice. The immutable notice
carries optional `logicalChild` and `incarnation` fields, while legacy
unbound host notices remain explicitly distinct. A failed barrier is
recorded as undelivered and may not emit a finalized Failure.
Clean exits transition through STOPPED and retire the record.

The opt-in Java STOP-only source plan now calls a trusted host effect
callback and **only after its successful acknowledgement** records a
STOPPED disposition for that exact finalized incarnation. A throwing
sink leaves its identity FINALIZED and its lifecycle effect ambiguous.
STOP replays and mismatched actor/incarnation tokens fail closed.

The native typed-panic bridge now registers children with its
`SupervisorChildRegistry`, updates exact-generation finalization after
the scheduler's physical completion proof, and appends process-scoped
`logical_child_id` and `logical_incarnation` to the copied terminal
envelope. A trusted `acknowledge_finalized_stop` checks the original
actor slot, scheduler generation, and logical incarnation. Scheduler-
sealed clean exits retire logical child records without guest callbacks.

**Scope limitation:** These are host lifecycle identity/disposition
transactions, not durable externally replicated commit receipts and
not guest execution of general `on_panic` bodies. Host sinks still
provide their own actual effects and acknowledge on return. Neither
backend currently compiles source `f.child` expressions, performs a
real actor restart, or lowers general `await`, `defer`, or `recover` in
the supervisor hook. The newer integration tests must pass exact-source
CI before any feature-completion claim.


## Focused restart reservation audit — final verification

The latest exact-blob funded verification passed both jobs:
https://github.com/gha-indie-worker/gha-indie-worker-docs/actions/runs/38179674429

- Java registry: `bfaf3e1b1a89db52b721c74b3f2b33ff7175039f`.
  A real compiler failure in an intermediate mirror exposed duplicate
  `detachActive` implementations from overlapping edits. The duplicate
  was removed; the corrected Java source compiled and passed the host
  race, permit rollback, STOP, identity ABA and admission detach probe.
- Native registry: `717bc17e5e6a5d677c837c041f910aab249aa175`.
  Exact native test blob `9e69092327116666fcbfa5e4e0c2a6df0bcb552e`
  passed strict C++20, normal execution, and ASan/UBSan with the
  native scheduler header hash checked independently.

These checks establish *standalone registry* invariants, not the
correctness of the newer Java ActorGroup integration, asynchronous STOP
continuations, or the native terminal panic bridge. Those integrations
were added separately and need their own exact-source full tests.


## Restricted source `f.child` STOP-only projection

The opt-in Java/GraalVM and LLVM STOP-only source paths now recognize
`self.stop(f.child); return;` when `f` is exactly the typed parameter of
`on_panic(f: Failure)`. This is a compiler-validated projection of the
**current** failure's supervisor-owned logical child, not general guest
property access. Both backend paths reject renamed, nested, or unrelated
expressions and continue rejecting general supervisor source compilation.

The Java runtime requires the failure notice to be bound to a logical
child before emitting this STOP request. The native opt-in policy
requires both nonzero `logical_child_id` and `logical_incarnation`
on a typed PANIC envelope. The authoritative STOP acknowledgment is
generation-checked by the host child registry after physical finalization.

This does not implement `self.restart(f.child)`, a general `Failure`
object evaluator, or general async `on_panic` code. The newer source
fixtures and runtime tests must be executed at their **exact final**
Git SHAs; prior focused CI only covers earlier revisions.
