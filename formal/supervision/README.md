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

The JSON document must have schemaVersion 1, backend java or llvm, the
exact 40-character lowercase sourceSha, and nonempty events. Every event
has contiguous seq beginning at one. Each child action carries immutable
child and supervisor identities and the exact generation. Registration
uses generation 1 and a previously unseen physical actor identity.

The recognized actions are: register, cleanup, finalize, control.acquire,
stop.reserve, restart.reserve, restart.abort, restart.commit, stop.invoke,
stop.applied, stop.uncertain, stop.proof, stop.ack and supervisor.close.
CONTROL actions include an increasing turn; restart.commit also needs a
newActor and newGeneration. Independent stop.proof requires an evidenceId.
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
