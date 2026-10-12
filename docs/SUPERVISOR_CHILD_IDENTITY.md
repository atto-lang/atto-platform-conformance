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


## Audit hardening: exclusive STOP lease (2026-10-11)

A `FINALIZED` check is not sufficient to protect a lifecycle effect.
Between that check and a host STOP callback, a concurrent trusted RESTART
could reserve the same logical child generation. Both Java and native host
registries now admit a generation-scoped **STOPPING** reservation before
performing external effects. STOP and RESTART therefore compete atomically
on the finalized generation, and only one may win.

The Java source STOP-only synchronous and restricted awaited installers
claim STOP before entering the host callback/CompletionStage; the native
`NativeSupervisorPanicBridge.reserve_finalized_stop(...)` performs the
equivalent host reservation. Commit requires the same child, incarnation
and reservation identity/CONTROL turn. No host callback executes while
holding the registry mutex. A STOP callback that throws, a failed or
ambiguous asynchronous acknowledgment, or shutdown during an await leaves
the child **STOPPING**, not `FINALIZED` or `STOPPED`.

STOPPING is an explicit unresolved state: the runtime must not retry the
effect, restart the child, or silently retire its reservation. Future
authoritative lifecycle reconciliation must establish the external outcome
before any transition. This work does not implement such reconciliation
or durable distributed effect receipts. It also does not enable general
guest supervisor execution, RESTART, or ESCALATE.

The Java worker-transfer path now retires its logical registry binding
before clearing ownership so a failed detachment does not silently
orphan the old supervisor's authority. Native PANIC-specific STOP
acknowledgment rejects forged cancellation and normal-stop envelope kinds.

**Verification boundary:** new STOPPING race and negative tests were added
to both drafts, but source workflows must run at their exact new Git SHAs
and pass before these changes can be treated as release-ready.


## Receipt transition audit: native/Java parity and crash-pending recovery

Native direct `record_stop_applied` accepts **PENDING only**. A STOP
receipt classified `UNCERTAIN` must not be promoted to APPLIED through a
direct host acknowledgment; that classification means the original result
was not established. It may transition to ACKNOWLEDGED only after a
trusted independent verifier confirms the **same** child, physical actor
generation, logical incarnation and CONTROL turn. The verifier runs
outside the registry mutex; the terminal state transition and receipt
acknowledgment run together under a second, exact-turn check.

A process can also close after reserving STOP but before classifying its
host effect. The native `reconcile_unresolved_stop` entrypoint admits
either PENDING or UNCERTAIN, **only with the same independent proof**;
negative, throwing and missing proof leave STOPPING quarantined. The
older `reconcile_uncertain_stop` entrypoint remains restricted to
UNCERTAIN for compatibility. Neither entrypoint retries an effect or
treats the absence of an acknowledgment as proof of non-execution.

Both backends reject inconsistent receipt and registry owner fields.
Java stages the reservation, receipt and STOPPING snapshot before map
publication, and restores the previous FINALIZED snapshot if any
publication step fails. Native rejects an existing receipt at STOP claim
time and rolls back its newly created reservation key on insertion
failure. No guest-issued ID is an authority token.

**Verification status:** These are committed, unverified exact-head
changes. The latest source GitHub Actions jobs have previously reported
null runner ID and zero executed steps. The private alternate-organization
mirror remains incomplete; its older matching blobs do not prove that
these changes compile or pass. Keep supervisor drafts unmerged pending
successful exact-source Maven, CMake/CTest and sanitizer execution.


## RESTART physical-refinement implementation gate (2026-10-11)

Java PR #657 and native PR #196 now stage each replacement actor by its
original restart reservation and **exact next logical incarnation**.
Commit rejects an unadmitted candidate; abort refuses to release a
reservation for a spawned/admitted candidate until trusted physical
cleanup has been acknowledged. Host readiness/cleanup probes execute
outside registry locks; the original reservation is revalidated under
the lock before publishing a state change.

Java `ActorGroup.closeFromRuntime` first calls
`childRegistry.closeRestartAdmission()`; a concurrent late readiness
callback cannot reactivate a closed group. LLVM exposes
`close_restart_admission()` and the native supervisor bridge fences
admission on teardown. Native `admit_verified_replacement` calls the
**real** `NativeActorScheduler::poll_ready` equivalent for the candidate
and publishes both the registry incarnation and bridge PANIC-routing
index while holding the bridge lock; a later generation-specific PANIC
must continue to reach the same supervisor. Native
`abort_cleaned_replacement` verifies `poll_done` before releasing
the reservation.

**Shared trace**:
`fixtures/supervision/v1/verified-restart-trace.json` defines 11
deterministic transitions and negative cases. Focused JVM JUnit and
native CTest emit an identically named
`SUPERVISOR_RESTART_TRACE_V1=` marker. After obtaining **actual**
exact-head runtime test logs, the following strict comparator must pass:

```sh
node bin/compare-supervisor-restart-traces.mjs \
  fixtures/supervision/v1/verified-restart-trace.json \
  /path/to/java-test.log /path/to/native-test.log
```

The comparator rejects missing, duplicated, malformed or disagreeing
runtime markers. Its Node self-tests are **only harness checks**, and
cannot substitute fabricated stdout for the real JUnit/CTest logs.
Log artifacts must include Java/LLVM commit SHA and verified exact
compiler source blobs; their relation to the fixture must be recorded.

The safety boundary remains **trusted host**: a BooleanSupplier or
`std::function<bool()>` returning true is not cryptographic physical
admission evidence. Java's scheduler-bound restart operation, native
external message routing before publication, and full actor-cancellation
races still require implementation-level testing. No general guest
`await self.restart(f.child)` or `self.escalate(f)` is enabled by these
changes. The source repos' Actions jobs still need allocated runners,
and the formal-only funded CI cannot prove source runtime parity.


## RESTART audit: identity retirement and closure (2026-10-11)

A physical replacement identity must be permanently consumed at its first
trusted stage, even when physical admission, logical publication, or
cleanup-backed RESTART ultimately fails. Java maintains the monotonic
`seenActors` ledger across stage, abort and failed index publication;
native retains the highest used scheduler generation per physical slot,
including after failed initial registration and aborted staging. Clearing
the outstanding slot claim after confirmed cleanup is **not** permission
to re-register the same physical slot+generation.

The native registry's lock-free `require_candidate` helper was made
private and explicitly lock-required. Java RESTART reservations now
preconstruct immutable state and restore the original FINALIZED snapshot
if registry-map publication fails. The native bridge additionally
rejects ready actors after supervisor CONTROL becomes unhealthy or closed,
and rechecks CONTROL/scheduler readiness immediately before publication.

**Outstanding atomicity:** native `poll_ready` is only a snapshot. A
concurrent `stop`, scheduler retirement or group closure may still race
the final check and registry publication; there is no scheduler-issued,
linearizable physical admission lease binding readiness to logical
publication. General guest RESTART must stay disabled until that lease
is designed and validated under fault injection. Java's trusted
`BooleanSupplier` callbacks have an equivalent proof-authority
assumption until integrated with scheduler-owned, fenced tickets.

Regression tests now exercise closed CONTROL with a still-live native
bridge, cleanup-before-abort, aborted candidate reuse, and per-slot
generation ABA. These code-level tests have been committed but are
**not verified green at the newest source heads**: source Actions jobs
still show no allocated runner and zero executed steps.

The separate funded formal/conformance run
[38189635155](https://github.com/3fa-app-test/account-recovery-security/actions/runs/38189635155)
passed **18 exact Git blob checks, 13 Node tests, two TLC safety models
(3,698 and 17,712 distinct states) and six expected unsafe mutations**.
It proves the checked contract/model scope, *not* full Java/LLVM
runtime execution or absence of the above scheduler lease race.


## Scheduler-gated RESTART publication prototype (2026-10-11)

Native draft PR #196 now introduces a scheduler-issued, thread-affine
`OresNativeRestartLease` for **unpublished** replacement actor lanes.
`spawn_unpublished` allocates a physical incarnation without allowing
ordinary send, legacy index submission, or CONTROL delivery to reach it.
`poll_ready` remains a physical readiness observation; the separate
`poll_published` probe is required for initial child registration.

During `NativeSupervisorPanicBridge::admit_verified_replacement`, the
scheduler publication gate is acquired for the exact actor domain, slot,
generation, and single-use nonce. The bridge then stages, verifies, and
commits its registry and future PANIC-routing index before publishing
normal scheduler routing. The guard is released on **every** exception
path. STOP and global scheduler retirement coordinate on the same gate,
so a successful physical readiness observation cannot become invalid
in the middle of the identity transaction. A failed replacement must
still reach physical DONE before the existing restart reservation is
released.

This first implementation deliberately uses a **single scheduler-wide
host publication mutex**. It is a correctness-first prototype and can
block native STOP/retirement callers while a host publication is running.
A future per-slot or nonblocking admission mechanism is needed before
claiming bounded-carrier or real-time scheduler behavior under arbitrary
host callbacks. Do not call stop/retire from the lease-owning thread.
No guest callback is invoked while holding the scheduler's *internal*
mutex; registry transitions occur while the separate publication gate
is held and must remain bounded and free of callbacks.

**Important remaining blockers:**

- Java/GraalVM still uses an observational BooleanSupplier admission
  contract. Its actor-cell routing and shutdown must implement an
  equivalent continuous scheduler-backed publication guard.
- The native bridge now enters
  `SupervisorProcess::with_healthy_restart_transaction` **before**
  acquiring the scheduler admission lease. The process decision fence
  and process mutex remain held during bounded registry/routing
  publication, so CONTROL closure and terminal failure classification
  cannot invalidate the owner mid-commit. Standalone CONTROL-close
  concurrency tests passed in a separately pinned funded mirror, but
  a full real native bridge integration test and lock-order stress
  review are still mandatory release gates.
- The existing native preallocated scheduler cannot reincarnate
  arbitrary actor slots. A restart candidate must use a fresh slot;
  physical capacity exhaustion and long-term recycling policy remain.
- The host publication gate is thread-affine. A stolen or replayed lease
  must never unlock another host's gate; a failed release is fatal
  instead of silently continuing with inconsistent authority.
- Full native source CMake/CTest, bridge integration, Java Maven/native
  image, TSan/jcstress, actual dual-backend trace comparison, crash
  recovery, and guest source `self.restart(f.child)` are still release
  gates, not established by a focused scheduler-only pass.

**Executable evidence:** exact native scheduler header/C source/test
were mirrored into private funded runner
`3fa-app-test/account-recovery-security`, with `git hash-object`
comparison before compilation. [Focused funded run #38192217815](https://github.com/3fa-app-test/account-recovery-security/actions/runs/38192217815)
passed GCC strict builds (25 race runs) and Clang ASan/UBSan
(10 race runs) on that checked revision. Subsequent hardening has
different source hashes and requires an additional green exact-blob run.

The separate bounded TLA+ `SupervisorAdmissionLease.tla` models
lease publication competing with STOP and shutdown and has deliberately
unsafe unleased-publication and retire-through-lease actions. The model
assumes its publication transaction is infallible and does not prove
Java/native refinement, progress under a blocked gate, or native
supervisor CONTROL-close atomicity.

All PRs remain draft; no general source RESTART/ESCALATE execution is enabled.
