# Supervisor STOP lifecycle: bounded formal verification

The `SupervisorStop.tla` safety model specifies **trusted host**
execution of lifecycle operations for two independent logical children,
two CONTROL turns and up to two actor incarnations per child. TLC explores
every enabled interleaving under these finite bounds; neither source backend
is substituted for a model checker.

## Run

```bash
bash formal/supervision/check-tlc.sh
```

The runner downloads a **digest-pinned** Java TLC executable and checks its
SHA-256 before executing. A clean model must complete with no invariant
violation, and the deliberate `UnsafeReplay` mutant must produce the
`NoDoubleEffect` counterexample. CI copies the exact Git blobs to a private
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

[Private TLC run 38185059504](https://github.com/3fa-app-test/account-recovery-security/actions/runs/38185059504):
10,020 generated states; 3,698 distinct states; full graph depth 14;
no invariant violations; deliberately unsafe replay produced the expected
`NoDoubleEffect` counterexample.
