# Supervisor STOP lifecycle: bounded formal verification

`SupervisorStop.tla` models trusted STOP receipts and late host completions.
`SupervisorLifecycle.tla` separately models CONTROL ownership, physical
cleanup, STOP/RESTART competition and supervisor shutdown. Both use two
logical children and bounded actor generations/turns. TLC explores
every enabled interleaving under these finite bounds; neither source backend
is substituted for a model checker.

## Run

```bash
bash formal/supervision/check-tlc.sh
```

The runner downloads a **digest-pinned** Java TLC executable and checks its
SHA-256 before executing. A clean model must complete with no invariant
violation, and deliberate mutants must produce counterexamples for duplicate host
STOP, premature RESTART, false ACK and duplicate lifecycle effects.
The positive models and negative controls are checked separately. CI copies the exact Git blobs to a private
funded repository for verification, without copying private Oreslang source
to a public repository.

## Java-to-TLA+ abstraction map

| Java implementation | TLA+ action/state |
| --- | --- |
| `SupervisorChildRegistry.beginStop` | `Reserve`; establishes the STOPPING ownership fence |
| Trusted STOP sink invocation | `StartEffect`; tracks at most one initiation per incarnation |
| `markStopApplied` | `MarkApplied` |
| `markStopUncertain` | `HostFailure` |
| `acknowledgeReservedStopEffect` | `HostSuccess` and `LateHostSuccess` |
| Independent verifier and `reconcileConfirmedStop` | `VerifyEvidence`, `Reconcile` |
| `SupervisorProcess.close` or CONTROL shutdown | `Close`; does not clear STOP ownership |
| `beginRestart`, `replace`, next physical failure | `Restart`, `NewFailure` |

Checked invariants:

- `TypeOK`: all state values belong to finite, explicit domains.
- `NoDoubleEffect`: a single actor incarnation never starts host STOP twice.
- `NoDoubleAck`: one incarnation never commits two separate terminal ACKs.
- `NoStaleIncarnation`: an admitted STOP ticket retains its incarnation.
- `NoRestartUnderStop`: unresolved STOP owns the incarnation exclusively.
- `NoInvalidAck`: an ACK requires an initiated effect plus either actual
  successful completion or independently verified evidence.
- `NoUnownedTicket`: only a reserved STOP can own a CONTROL turn.

## Assumptions and proof boundary

TLC's success establishes these invariants **for every execution of the
formal transition system within the configured bounds**. It does not prove
that arbitrary Java/C++ code implements every action correctly. Production
race/JUnit tests, exact SHA verification, full Maven, native ASan/UBSan and
GraalVM AOT must still test the refinement boundary.

`VerifyEvidence` assumes the trusted host supplies **truthful,
independent positive proof** of the existing STOP effect; the model does
not certify that integration's evidence. The actor-generation and host
initiation checks represent trusted runtime guards. Malicious callbacks,
lost dispatch, panics, cancellation and out-of-process crashes need separate
refinement/fault-injection tests. The receipt ledger currently lives in
memory; this model does not imply disk durability.

This is a **safety** model. It intentionally does not assert unconditional
liveness: an unresolved STOP can remain PENDING after shutdown if no trusted
acknowledgment/evidence ever arrives. A future liveness proof must state
fairness and evidence-availability assumptions explicitly.

## Verified evidence

[Private combined TLC run 38185363925](https://github.com/3fa-app-test/account-recovery-security/actions/runs/38185363925):

- STOP receipt model: **10,020 generated**, **3,698 distinct** states;
  depth **14**; no invariant violation.
- CONTROL/cleanup/restart model: **18,964 generated**, **7,552 distinct**
  states; depth **29**; no invariant violation.
- Four expected mutation counterexamples: `NoDoubleEffect`,
  `NoRestartUnderStop`, `NoInvalidAck`, and
  `NoDuplicateEffects`.

The conformance workflow `.github/workflows/supervisor-formal.yml`
runs these checks on formal-model changes; while source-organization
Actions have no runner allocation, an exact-Git-blob private CI mirror
provides executable evidence without exposing private source.


## Bounded explorer and mutation regression

`formal/supervision/explore.mjs` has a separate JavaScript exhaustive
transition explorer; `test/supervisor-lifecycle.test.mjs` integrates it
into the repository's `npm test` command. It checks phase coherence,
per-supervisor CONTROL ownership, physical-cleanup ordering, generation
fencing, receipt proof, replay, and shutdown quarantine.

In-process execution of the exported explorer function in the current
tool runtime yielded **536** states / **966** transitions for two
children sharing one supervisor, and **2,704** states / **6,760**
transitions for children in two independent supervisors, with no
invariant violations. An unsafe host-effect replay yielded a seven-step
`NoDuplicateEffects` counterexample.

During initial exploration a stricter invariant flagged a
RESTARTING child after supervisor close released CONTROL. The
corrected contract treats that as a **quarantined** reservation, not an
authorized late RESTART: `CommitRestart` now requires an open supervisor
and the original CONTROL owner. Runtime implementations still need
separate proof that shutdown cannot publish a new actor after closing.

The funded TLC run documented above verifies its own exact checked
Git blobs, not arbitrary future edits to this model, the JS test runner,
or the Java/LLVM implementations. Always refresh exact-source evidence
after changes.

## Expanded reincarnation scope

Two additional finite TLC configurations use one logical child, three
incarnations and three CONTROL turns:
`SupervisorStopABA.cfg` and `SupervisorLifecycleABA.cfg`. They test
the same safety invariants through a longer generation sequence; they
do **not** prove a physical ActorId will never be recycled or that the
Java implementation refines the TLA+ generation map.

[Expanded private CI run 38185549392](https://github.com/3fa-app-test/account-recovery-security/actions/runs/38185549392)
passed both original models, both three-incarnation configurations and
all four expected negative-control counterexamples. The extra STOP
configuration explored **190 distinct states**; the extra CONTROL
configuration explored **78 distinct states**.


## Trace-level safety refinement obligation

bin/verify-supervisor-trace.mjs checks an *observed sequence* of runtime
linearization events against SupervisorLifecycle.tla's intended action order.
Its synthetic adversarial tests live in test/supervisor-trace.test.mjs.
This is neither a TLA+ refinement proof nor a substitute for TLC.

Run: node bin/verify-supervisor-trace.mjs path/to/trace.json

The JSON document must have schemaVersion 2, backend java or llvm, the
exact 40-character lowercase sourceSha, and nonempty events. Every event
has contiguous seq beginning at one. Each child action carries immutable
child and supervisor identities and the exact generation. Registration
uses generation 1 and a previously unseen physical actor identity.

The recognized actions are: register, cleanup, finalize, control.acquire,
stop.reserve, restart.reserve, restart.spawn, restart.admit,
restart.cleanup, restart.abort, restart.commit, stop.invoke,
stop.applied, stop.uncertain, stop.proof, stop.ack, supervisor.close
and the mandatory final trace.end marker.
CONTROL actions include an increasing turn; every RESTART reservation gets a
unique permitId, and the subsequent stage/admit/cleanup/abort/commit actions
must present that exact one-shot permit. A spawn records a globally distinct
newActor and newGeneration, admission binds that identity to a host-issued
admissionId, and abort requires prior cleanupId if a physical replacement
was spawned. The trace.end action requires a matching recordedEvents count
and a completed or quarantined status. Incomplete prefixes only pass
programmatic checks with allowPrefix:true (never the default CLI mode).
Independent stop.proof requires evidenceId plus a trusted verifyProof
callback that verifies the original actor, generation, CONTROL turn, host
receipt and external evidence. The standalone CLI intentionally rejects
proof-based reconciliation without that callback.
Unknown operations fail closed.

The oracle rejects premature finalization, duplicate host STOP invocation,
conflicting STOP and RESTART reservations, reused ActorIds, generation or
CONTROL-turn replay, acknowledgment without applied receipt or independent
positive proof, and late restart commit after closure. It permits a
post-shutdown reconciliation of already-started, independently proven STOP.

IMPORTANT: a passing *synthetic* trace only proves that the particular
sequence satisfied the checker. Neither the sourceSha JSON field nor a
stop.proof event is itself cryptographic attestation or trustworthy evidence.
A trusted host verifier must assert that independent proof reflects the
actual host effect. Runtime producers must emit COMPLETE records at the
real linearization points and bind them to a separately checked build digest.
No Java/GraalVM or native LLVM runtime refinement claim is made until
those backends emit trusted actual execution traces and pass the checker.

Further formal work: genuine temporal safety/refinement checks, ghost
history variables for callbacks and ACK, and conditional liveness properties
with explicit scheduler fairness/evidence availability assumptions.


## RESTART admission and abort refinement audit

The earlier lifecycle model let `CommitRestart` jump directly from
RESTARTING to ACTIVE and `AbortRestart` jump back to FINALIZED.
That hid two safety-critical physical obligations. The hardened model
now requires:

- `SpawnReplacement` before `AdmitReplacement`, recording a distinct
  new actor incarnation; a successful admission records that exact
  generation in `readyGeneration`.
- `CommitRestart` only after `Admitted` with the matching next
  generation, open supervisor, and the same CONTROL owner.
- `CleanupReplacement` before `AbortRestart` if a replacement has been
  spawned (including an admitted actor). After shutdown, a live
  replacement remains quarantined until trusted physical cleanup.
- No RESTART reservation at the model's maximal actor generation.

The `NoOrphanReplacement` and `NoUnreadyActiveIncarnation` safety
invariants are checked by `SupervisorLifecycle.cfg`. Two deliberate
TLC mutant configurations must fail on those *specific* invariants:
`SupervisorLifecycleUnsafeAbort.cfg` and
`SupervisorLifecycleUnsafeCommit.cfg`.

The committed bounded JS explorer (exact blob
`cb52455410fe210272713e813f8546bd2fbb1faf` at the time of this
audit) explored **1,228** reachable states / **2,212** transitions for
two children sharing CONTROL, and **6,400** states / **17,120**
transitions for independent supervisors, without safety violations.
It produced a seven-step live-replacement abort counterexample, a
six-step premature-commit counterexample, and the existing seven-step
duplicate host-effect counterexample. These results were executed
directly against that model blob; the dedicated Node test files still
need their own CI execution.

**Runtime refinement obligations**: Java and LLVM registry
`beginRestart`/`begin_restart` are reservations, not physical spawn
proof. The trusted caller must fence the actual replacement, verify
admission/readiness before `replace`, and finish physical cleanup
before `abortRestart`/`abort_restart`. No late callback may publish
the new actor after the supervisor's CONTROL lane closes. Until
implementation-level traces, fault injection and exact-head CI verify
this, real guest `self.restart(f.child)` remains gated.

The prior funded TLC green run is **not** proof of these newly modified
TLA+ blobs. They have been mirrored to the private funded test branch
`3fa-app-test/account-recovery-security:test/supervisor-source-await-20261011`
with exact Git blob matches; a fresh completed TLC job for those
particular revisions is still required before claiming formal TLC success.


## Verified exact-blob funded proof (latest checked model)

The 2026-10-11 private funded test run
[38188797535](https://github.com/3fa-app-test/account-recovery-security/actions/runs/38188797535)
allocated and executed actual Ubuntu runner steps on private draft
[CI mirror PR #12](https://github.com/3fa-app-test/account-recovery-security/pull/12).
It validated **18 exact conformance Git blobs** before executing:

- Node model-explorer and strict trace-comparator self-tests:
  **12 passed**, no failures
- TLC trusted STOP receipt model: **10,020 generated**, **3,698 distinct**
  states, no safety invariant violation
- TLC expanded CONTROL/cleanup/restart model: **45,548 generated**,
  **17,712 distinct** states, no safety invariant violation
- Three-incarnation ABA configurations: **190** STOP distinct states and
  **136** lifecycle distinct states, no violations
- Six deliberately unsafe transitions each generated the *expected*
  invariant counterexample: `NoDoubleEffect`,
  `NoRestartUnderStop`, `NoInvalidAck`,
  `NoDuplicateEffects`, `NoOrphanReplacement`, and
  `NoUnreadyActiveIncarnation`

The private repository's independent harness CI
[38188797624](https://github.com/3fa-app-test/account-recovery-security/actions/runs/38188797624)
also passed.

This is **not** proof of Java or LLVM compiler/runtime behavior. Those
source trees were not completely mirrored into the funded test repository,
and the Java Maven, native CMake/CTest, sanitizer, and real-log cross-backend
trace comparison gates are still open.

## October 11 hardening: one-shot permit and proof trust boundary

A prior verifier accepted a direct reserve-to-commit RESTART without actual
replacement spawn and admission events. It also treated a string evidenceId
as positive independent host evidence. Both have been tightened: the
schemaVersion 2 verifier requires spawn, admission, one-shot permit binding,
cleanup-before-abort, explicit terminal trace markers, and fail-closed
trusted host verification for proof-based STOP reconciliation.

A new focused bounded TLA+ model, SupervisorPermit.tla, explicitly explores
abort/re-reserve ABA retries in one supervisor CONTROL turn. The
SupervisorPermitMutant.cfg configuration must find a stale-permit commit
counterexample to NoStalePermitCommit. This is distinct from the existing
SupervisorLifecycle.tla model, which checks physical replacement lifecycle.

[Exact-blob funded private CI run 38188877214](https://github.com/3fa-app-test/account-recovery-security/actions/runs/38188877214)
passed 10 synthetic trace regression tests and TLC checks on the pinned
pre-external-proof-gate revision, including 17,712 lifecycle distinct states,
94 permit states, and 7 expected mutant counterexamples. Newer proof-callback
changes require their own exact-blob CI evidence. The runtime producers and
trusted verifier are NOT implemented by this formal checking, and neither
Java nor LLVM is certified to refine the model yet.

## Actual registry journal parity: funded Java 25 and native sanitizer execution

Both source backends now capture a bounded, read-only journal of committed
supervisor-child registry mutations under each registry's own lock. Events
include monotonic sequence, operation, child/actor snapshot and (where needed)
restart permit, STOP turn and physical replacement identity. Failed operations
do not appear as committed. A dropped journal event permanently invalidates
the audit read. Recording never calls external code while locked.

The comparator bin/compare-supervisor-registry-transitions.mjs reads exactly
one SUPERVISOR_REGISTRY_TRANSITIONS_V1 marker from each actual test run.
It rejects missing, repeated, malformed, or mismatched runtime logs. Its
11-action fixture exercises register, asserted finalize, restart reserve,
asserted spawn, verified admission, commit, second finalize, retry reserve,
asserted spawn, verified cleanup, and abort.

Funded exact-blob CI run:
https://github.com/3fa-app-test/account-recovery-security/actions/runs/38190035951

The run verified seven exact source blobs, compiled the actual Java registry
under JDK 25 using an identity-only ActorRuntime compile scaffold, ran all
19 original Java registry JUnit cases successfully, compiled/executed the
actual native registry regression test under ASan/UBSan, passed the five
comparator self-tests, and verified the two execution-emitted logs matched.

LIMITS: This tests real registry code, NOT real full Java interpreter or
LLVM guest execution, nor formal refinement of either. The compile scaffold
does not substitute for the real ActorRuntime. A registry cannot itself
attest external CONTROL scheduling, physical finalization, host STOP effects
or independent STOP proof. Those external owners must emit truthful events
at their real linearization points and bind a complete schema-v2 trace to
the tested binary/source identity. Do not fabricate events to fill gaps.
All three PRs remain draft until runtime integration and stronger CI pass.

## Registry-journal authority and evidence-correlation audit

Additional runtime hardening prevents Java guest-visible public audit access:
the journal Transition type and accessors are package-private, retaining
physical ActorId and lifecycle nonce information inside trusted host code.
STOP entries do not misuse the restartPermit slot. Instead Java records
a separate stopPermit nonce tied to the original StopReservation; reserve,
uncertain, and reconciled ACK tests prove that it remains the same.

The native restart.abort event now retains the exact cleaned physical
replacement ActorRef before erasing the staging maps, so an emitted audit
record can correlate cleanup and abort to the same actor incarnation.
Native regression tests reject missing or mismatched discarded candidates.

The runtime marker comparator now rejects trace tokens embedded in log
diagnostics, echoed shell commands, leading ANSI decorators, and duplicate
markers, rather than upgrading arbitrary text to a runtime-produced trace.
Standalone self-tests exercise all these failure modes.

Fresh exact-blob execution evidence (all gates green):
https://github.com/3fa-app-test/account-recovery-security/actions/runs/38191439882

The funded workflow checked seven exact Java/native/conformance blob SHAs,
ran actual Java 25 registry and its 20 JUnit tests (20 passed), executed
the actual native C++ registry test under ASan/UBSan, passed 7 comparator
self-tests, and matched all 11 observed registry transitions across both
executions. This replaces earlier partial/in-between CI results whose
pin checks intentionally failed until every source revision was mirrored.

This is still REGISTRY-level verification, not a proof of completed
supervisor source lowering, host STOP effect correctness, external
admission/cleanup truthfulness, actual Java ActorRuntime integration,
native routing publication, or complete schema-v2 refinement. The next
milestone is to instrument the scheduler and host boundaries with
independently authenticated event provenance and rerun full source builds.


## Atomic initial-child admission and scheduler lease model (October 2026)

`SupervisorInitialAdmission.tla` separately checks **initial child
registration**, not only logical RESTART publication. The bounded model
has two independent physical actors, up to three physical generations,
a scheduler-owned registration lease, asynchronous STOP requests,
actual physical retirement, and supervisor close that cannot linearize
while a registration lease remains held. It checks that:

- An initial logical child is registered only with an exact physical
  admission proof from the current generation.
- A physical STOP cannot retire a registered candidate while its
  admission lease is held.
- The registered generation must equal the physical scheduler generation
  (no actor-slot ABA / stale callback registration).
- Closing a supervisor does not leave an outstanding publication lease.

The checker is `bash formal/supervision/check-initial-tlc.sh`. Three
deliberately unsafe actions must produce their intended counterexamples:
unleased registration, STOP through a held gate, and stale-generation
registration.

[Six-blob funded TLC run 38197144529](https://github.com/3fa-app-test/account-recovery-security/actions/runs/38197144529)
verified exact source blob identities and passed the positive bounded
model plus all three expected mutation counterexamples. This verifies
the **model**, not a machine-checked refinement of the native bridge or
Java actor scheduler.

### Java/GraalVM implementation-level boundary

In draft [Java PR #657](https://github.com/ores-truffle-oreslang/oreslang-source.java/pull/657),
`ActorGroup.spawnUnpublishedRestartCandidate` creates a real ActorCell
with a hidden routing/initialization flag; mail, continuations, early
`ready()`, and `beginTurn` cannot run it before publication.
`commitUnpublishedRestart` coordinates physical `lifecycleLock`,
group `authorityLock`, and `SupervisorChildRegistry` publication.
The physical actor cannot stop across that critical section. The
post-commit routing flip is an allocation-free boolean publication.
`pendingRestartCandidates` makes group close cancel physically owned
but unpublished candidates. A rejected candidate is only released by
`abortCleanedUnpublishedRestart` after its physical DONE barrier,
and the logical ActorId is never reused. The earlier BooleanSupplier
registry testing hook is **not** a substitute for this runtime lease.

[Funded Java exact 403-blob full Maven run 38196942944](https://github.com/zed-pkg-test/java-app/actions/runs/38196942944)
passed the selected real ActorRuntime/supervisor regressions and full
Maven verify for the source revision tested by that run. Subsequent
DONE-backed cleanup changes require a fresh green mirror check;
native-image AOT/hybrid are separate release gates.

Neither this model nor the Java host-only admission methods enable
general guest `await self.restart(f.child)` or ESCALATE. Real source
lowering, bounded-carrier liveness, mixed shutdown interleavings,
actual cross-backend lifecycle trace comparison, and physical native
slot reincarnation/capacity policy remain release blockers.
